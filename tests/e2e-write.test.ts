/**
 * Live write path: the agent creates elements and a fake browser peer must
 * receive them as SCENE_UPDATE, decryptable with the room key.
 *
 * Opt in with EXCALIDRAW_E2E=1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";
import { loadConfig } from "../src/config.ts";
import { hardClose, RoomClient } from "../src/client/room-client.ts";
import { decrypt } from "../src/client/crypto.ts";
import { buildElements } from "../src/scene/elements.ts";
import { applyPatch } from "../src/scene/mutations.ts";

const enabled = process.env.EXCALIDRAW_E2E === "1";
const KEY = "AAAAAAAAAAAAAAAAAAAAAA";

interface Received {
  type: string;
  elements: { id: string; type: string; version: number; text?: string }[];
}

function fakeBrowser(
  relayUrl: string,
  roomId: string,
  received: Received[],
  onInit?: () => void,
): Socket {
  const socket = io(relayUrl, {
    transports: ["websocket"],
    extraHeaders: { Origin: "http://127.0.0.1" },
  });
  socket.on("init-room", () => socket.emit("join-room", roomId));
  socket.on("first-in-room", () => onInit?.());
  socket.on("client-broadcast", async (cipher: ArrayBuffer, iv: Uint8Array) => {
    const message = await decrypt<{ type: string; payload: { elements: Received["elements"] } }>(
      KEY,
      new Uint8Array(iv),
      cipher,
    );
    received.push({ type: message.type, elements: message.payload?.elements ?? [] });
  });
  return socket;
}

test("an added element reaches the peer as a decryptable SCENE_UPDATE", { skip: !enabled }, async (t) => {
  const config = loadConfig();
  const roomId = Array.from({ length: 20 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  const received: Received[] = [];

  // The browser is here first, so the agent's join triggers "new-user" on it.
  const browser = fakeBrowser(config.relayUrl, roomId, received);
  t.after(() => hardClose(browser));
  await new Promise<void>((resolve) => browser.on("connect", () => resolve()));
  browser.emit("join-room", roomId);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const client = new RoomClient({ ...config, agentName: "pi-test" });
  t.after(async () => client.leave());
  await client.join(`${roomId},${KEY}`);

  const { elements } = buildElements([{ type: "rectangle", x: 10, y: 20, text: "Gateway" }], {
    lastIndex: client.lastIndex(),
  });
  await client.apply(elements);
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.ok(received.length > 0, "the peer received nothing");
  const shape = elements[0]!;
  const update = received.filter((message) => message.type === "SCENE_UPDATE").at(-1);
  assert.ok(update, "no SCENE_UPDATE reached the peer");
  const sent = update.elements.find((element) => element.id === shape.id);
  assert.ok(sent, "the shape was not in the update");
  assert.equal(sent.type, "rectangle");
  assert.equal(sent.version, shape.version);

  // A local edit must arrive bumped, or peers discard it.
  const changed = applyPatch(
    client.sceneMap() as never,
    shape.id,
    { x: 300, y: 400 },
  );
  await client.apply(changed);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const afterMove = received.filter((message) => message.type === "SCENE_UPDATE").at(-1)!;
  const moved = afterMove.elements.find((element) => element.id === shape.id)!;
  assert.equal(moved.version, shape.version + 1);
});
