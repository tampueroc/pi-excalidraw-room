/**
 * Live integration test against the local Excalidraw stack.
 *
 * Opt in with EXCALIDRAW_E2E=1. A fake browser peer joins the same room over
 * the relay and broadcasts a scene, so the join path, decryption, presence and
 * reconciliation all run against real services.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";
import { loadConfig } from "../src/config.ts";
import { hardClose, RoomClient } from "../src/client/room-client.ts";
import { encryptJson } from "../src/client/crypto.ts";

const enabled = process.env.EXCALIDRAW_E2E === "1";

async function waitFor<T>(probe: () => T | null, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`nothing after ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
const KEY = "AAAAAAAAAAAAAAAAAAAAAA";

function fakeBrowser(relayUrl: string, roomId: string): Socket {
  const socket = io(relayUrl, {
    transports: ["websocket"],
    extraHeaders: { Origin: "http://127.0.0.1" },
  });
  let announced = false;
  // A browser sends its scene when a peer arrives, and falls back to the stored
  // scene when nobody hands it one — mirroring excalidraw-app's collab logic.
  const announce = () => {
    announced = true;
    void send();
  };
  const fallback = setTimeout(() => {
    if (!announced) announce();
  }, 3000);
  socket.on("init-room", () => socket.emit("join-room", roomId));
  socket.on("new-user", announce);
  socket.on("disconnect", () => clearTimeout(fallback));
  async function send() {
    const { ciphertext, iv } = await encryptJson(KEY, {
      type: "SCENE_INIT",
      payload: {
        elements: [
          {
            id: "browser-rect",
            type: "rectangle",
            x: 40,
            y: 60,
            width: 160,
            height: 80,
            version: 7,
            versionNonce: 1234,
            updated: 1,
            isDeleted: false,
            backgroundColor: "#a5d8ff",
            boundElements: [{ id: "browser-label", type: "text" }],
          },
          {
            id: "browser-label",
            type: "text",
            x: 70,
            y: 85,
            width: 100,
            height: 25,
            version: 3,
            versionNonce: 99,
            updated: 1,
            isDeleted: false,
            text: "Gateway",
            containerId: "browser-rect",
          },
        ],
      },
    });
    socket.emit("server-broadcast", roomId, ciphertext, iv);
  }
  return socket;
}

test("joins the local relay, receives a browser scene and reads it", { skip: !enabled }, async (t) => {
  const config = loadConfig();
  const roomId = Array.from({ length: 20 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  const link = `${roomId},${KEY}`;
  const client = new RoomClient({ ...config, agentName: "pi-test" });

  const browser = fakeBrowser(config.relayUrl, roomId);
  t.after(async () => {
    hardClose(browser);
    await client.leave();
  });

  const status = await client.join(link);
  assert.equal(status.connected, true);
  assert.equal(status.roomId, roomId);

  // The fake browser sends SCENE_INIT when it sees the agent arrive; the relay
  // occasionally needs a moment, and the client rejoins once by itself.
  const elements = await waitFor(() => (client.elements().length ? client.elements() : null), 12_000);
  assert.equal(elements.length, 2, `expected the browser scene, got ${JSON.stringify(elements)}`);

  const rect = elements.find((el) => el.id === "browser-rect");
  assert.equal(rect?.type, "rectangle");

  // A second join in the same process must replace the first room cleanly.
  const again = await client.join(`${roomId},${KEY}`);
  assert.equal(again.roomId, roomId);
  assert.equal(client.status().connected, true);
});
