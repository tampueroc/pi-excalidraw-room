import { test } from "node:test";
import assert from "node:assert/strict";
import { decrypt, encryptJson, IV_LENGTH_BYTES } from "./crypto.ts";

const KEY = "AAAAAAAAAAAAAAAAAAAAAA";
const OTHER_KEY = "BBBBBBBBBBBBBBBBBBBBBB";

test("round-trips a scene payload", async () => {
  const payload = { type: "SCENE_UPDATE", payload: { elements: [{ id: "r1", x: 1 }] } };
  const { ciphertext, iv } = await encryptJson(KEY, payload);
  assert.equal(iv.length, IV_LENGTH_BYTES);
  assert.deepEqual(await decrypt(KEY, iv, ciphertext), payload);
});

test("uses a fresh IV each time", async () => {
  const a = await encryptJson(KEY, { n: 1 });
  const b = await encryptJson(KEY, { n: 1 });
  assert.notDeepEqual(a.iv, b.iv);
});

test("fails to decrypt with another room key", async () => {
  const { ciphertext, iv } = await encryptJson(KEY, { type: "SCENE_INIT", payload: { elements: [] } });
  await assert.rejects(() => decrypt(OTHER_KEY, iv, ciphertext));
});

test("produces ciphertext the relay can carry as bytes", async () => {
  const { ciphertext } = await encryptJson(KEY, { type: "MOUSE_LOCATION", payload: {} });
  assert.ok(ciphertext.byteLength > 0);
  assert.ok(ciphertext.byteLength % 1 === 0);
});
