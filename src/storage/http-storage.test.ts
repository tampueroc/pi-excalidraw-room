import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeRoomBody, encodeRoomBody, loadRoom, saveRoom, type FetchLike } from "./http-storage.ts";
import { decrypt } from "../client/crypto.ts";

const KEY = "AAAAAAAAAAAAAAAAAAAAAA";
const BASE = "http://127.0.0.1:8081/api/v2";

/** A stand-in for the NestJS backend: one in-memory document per room id. */
function fakeBackend(): { fetch: FetchLike; bodies: Map<string, Uint8Array>; puts: number } {
  const bodies = new Map<string, Uint8Array>();
  const state = {
    bodies,
    puts: 0,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const roomId = url.split("/rooms/")[1]!;
      if (init?.method === "PUT") {
        state.puts += 1;
        const bytes = new Uint8Array(init.body as Uint8Array);
        bodies.set(roomId, bytes);
        return new Response(JSON.stringify({ id: roomId }), { status: 201 });
      }
      const stored = bodies.get(roomId);
      if (!stored) return new Response("", { status: 404 });
      return new Response(stored.slice().buffer, { status: 200 });
    }) as unknown as FetchLike,
  };
  return state;
}

test("the body is uint32BE(sceneVersion) then iv then ciphertext", () => {
  const iv = new Uint8Array(12).fill(7);
  const ciphertext = new Uint8Array([1, 2, 3, 4]).buffer;
  const body = encodeRoomBody(42, iv, ciphertext);
  assert.equal(body.byteLength, 4 + 12 + 4);
  assert.deepEqual([...body.slice(0, 4)], [0, 0, 0, 42]);
  assert.deepEqual([...body.slice(4, 16)], new Array(12).fill(7));
  assert.deepEqual([...body.slice(16)], [1, 2, 3, 4]);

  const decoded = decodeRoomBody(body);
  assert.equal(decoded.version, 42);
  assert.deepEqual([...decoded.iv], new Array(12).fill(7));
});

test("a body shorter than the prefix is refused instead of misparsed", () => {
  assert.throws(() => decodeRoomBody(new Uint8Array(8)), /too short/);
});

test("saving then loading returns the same elements", async () => {
  const backend = fakeBackend();
  const elements = [{ id: "a", type: "rectangle", version: 1 }];
  await saveRoom(BASE, "room1", KEY, elements, 9, backend.fetch);

  const stored = await loadRoom(BASE, "room1", KEY, backend.fetch);
  assert.ok(stored);
  assert.equal(stored.version, 9);
  assert.deepEqual(stored.elements, elements);

  // The plaintext never reaches the backend.
  const raw = backend.bodies.get("room1")!;
  const asText = new TextDecoder().decode(raw);
  assert.ok(!asText.includes("rectangle"));
});

test("what the frontend wrote can be decrypted and read", async () => {
  const backend = fakeBackend();
  // Simulate the browser: same layout, encrypted with the room key.
  const { encryptJson } = await import("../client/crypto.ts");
  const { ciphertext, iv } = await encryptJson(KEY, [{ id: "browser", type: "ellipse", version: 3 }]);
  backend.bodies.set("room2", encodeRoomBody(3, iv, ciphertext));

  const stored = await loadRoom(BASE, "room2", KEY, backend.fetch);
  assert.equal(stored?.sceneVersion, 3);
  assert.equal((stored?.elements[0] as { id: string }).id, "browser");
});

test("a missing room is null, not an error", async () => {
  assert.equal(await loadRoom(BASE, "never-saved", KEY, fakeBackend().fetch), null);
});

test("a failed write surfaces as an error", async () => {
  const failing = (async () => new Response("", { status: 500 })) as unknown as FetchLike;
  await assert.rejects(() => saveRoom(BASE, "room3", KEY, [], 1, failing), /storage PUT 500/);
});

test("the body decrypts with the room key", async () => {
  const backend = fakeBackend();
  await saveRoom(BASE, "room4", KEY, [{ id: "x" }], 5, backend.fetch);
  const { version, iv, ciphertext } = decodeRoomBody(backend.bodies.get("room4")!);
  assert.equal(version, 5);
  assert.deepEqual(await decrypt(KEY, iv, ciphertext), [{ id: "x" }]);
});
