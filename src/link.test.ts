import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRoomLink, parseRoomLink, redactLink } from "./link.ts";

const ROOM_ID = "aa11bb22cc33dd44ee55";
const ROOM_KEY = "AAAAAAAAAAAAAAAAAAAAAA";

test("parses a local collaboration URL", () => {
  const link = parseRoomLink(`http://127.0.0.1/#room=${ROOM_ID},${ROOM_KEY}`);
  assert.equal(link.roomId, ROOM_ID);
  assert.equal(link.roomKey, ROOM_KEY);
  assert.equal(link.baseUrl, "http://127.0.0.1/");
});

test("parses a bare id,key pair with no frontend", () => {
  const link = parseRoomLink(` ${ROOM_ID},${ROOM_KEY} `);
  assert.equal(link.roomId, ROOM_ID);
  assert.equal(link.baseUrl, null);
});

test("rejects a key that is not 22 characters", () => {
  assert.throws(() => parseRoomLink(`http://x/#room=${ROOM_ID},tooshort`), /room key/);
});

test("rejects input that is not a collaboration link", () => {
  assert.throws(() => parseRoomLink("http://127.0.0.1/"), /not a collaboration link/);
  assert.throws(() => parseRoomLink(""), /empty/);
});

test("round-trips through formatRoomLink", () => {
  const link = parseRoomLink(`http://127.0.0.1/#room=${ROOM_ID},${ROOM_KEY}`);
  const url = formatRoomLink("http://127.0.0.1", link);
  assert.equal(url, `http://127.0.0.1/#room=${ROOM_ID},${ROOM_KEY}`);
  assert.deepEqual(parseRoomLink(url), link);
});

test("redaction keeps the room id and hides the key", () => {
  const redacted = redactLink(parseRoomLink(`${ROOM_ID},${ROOM_KEY}`));
  assert.match(redacted, new RegExp(ROOM_ID));
  assert.ok(!redacted.includes(ROOM_KEY));
});
