/**
 * A dropped socket must not cost presence or the scene.
 *
 * Opt in with EXCALIDRAW_E2E=1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";
import { loadConfig } from "../src/config.ts";
import { hardClose, RoomClient } from "../src/client/room-client.ts";
import { decrypt, encryptJson } from "../src/client/crypto.ts";

const enabled = process.env.EXCALIDRAW_E2E === "1";
const KEY = "AAAAAAAAAAAAAAAAAAAAAA";

interface Counters {
  presence: number;
  sceneRequests: number;
}

/** A browser peer: hands over a scene when someone arrives, and listens. */
function fakeBrowser(relayUrl: string, roomId: string, counters: Counters): Socket {
  const socket = io(relayUrl, {
    transports: ["websocket"],
    extraHeaders: { Origin: "http://127.0.0.1" },
  });
  socket.on("init-room", () => socket.emit("join-room", roomId));
  socket.on("new-user", async () => {
    counters.sceneRequests += 1;
    const { ciphertext, iv } = await encryptJson(KEY, {
      type: "SCENE_INIT",
      payload: {
        elements: [
          {
            id: "browser-rect",
            type: "rectangle",
            x: 0,
            y: 0,
            width: 100,
            height: 60,
            version: 4,
            versionNonce: 11,
            updated: 1,
            isDeleted: false,
          },
        ],
      },
    });
    socket.emit("server-broadcast", roomId, ciphertext, iv);
  });
  socket.on("client-broadcast", async (cipher: ArrayBuffer, iv: Uint8Array) => {
    const message = await decrypt<{ type: string }>(KEY, new Uint8Array(iv), cipher);
    if (message.type === "MOUSE_LOCATION" || message.type === "IDLE_STATUS") counters.presence += 1;
  });
  return socket;
}

test("presence and the scene survive a dropped connection", { skip: !enabled }, async (t) => {
  const config = loadConfig();
  const roomId = Array.from({ length: 20 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  const counters: Counters = { presence: 0, sceneRequests: 0 };

  const browser = fakeBrowser(config.relayUrl, roomId, counters);
  t.after(() => hardClose(browser));
  await new Promise<void>((resolve) => browser.on("connect", () => resolve()));
  browser.emit("join-room", roomId);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const client = new RoomClient({ ...config, agentName: "pi-reconnect" });
  t.after(async () => client.leave());
  await client.join(`${roomId},${KEY}`);
  await new Promise((resolve) => setTimeout(resolve, 600));

  const presenceBefore = counters.presence;
  const scenesBefore = counters.sceneRequests;
  assert.ok(presenceBefore > 0, "the agent never announced itself");
  assert.equal(client.elements().length, 1, "the browser scene never arrived");

  // Simulate the relay dropping us: socket.io should reconnect and rejoin.
  client.dropConnection();
  await new Promise((resolve) => setTimeout(resolve, 2500));

  assert.equal(client.status().connected, true, "the client did not reconnect");
  assert.ok(counters.presence > presenceBefore, "presence did not resume after the reconnect");
  assert.ok(counters.sceneRequests > scenesBefore, "the agent did not rejoin, so no scene was resent");
  assert.equal(client.elements().length, 1, "the scene was lost across the reconnect");
});
