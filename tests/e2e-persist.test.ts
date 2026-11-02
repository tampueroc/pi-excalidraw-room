/**
 * Live persistence: what the agent draws must come back when nobody's browser
 * is open, through the deployment's storage backend.
 *
 * Opt in with EXCALIDRAW_E2E=1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { RoomClient } from "../src/client/room-client.ts";
import { buildElements } from "../src/scene/elements.ts";

const enabled = process.env.EXCALIDRAW_E2E === "1";
const KEY = "AAAAAAAAAAAAAAAAAAAAAA";

function randomRoomId(): string {
  return Array.from({ length: 20 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
}

test("a scene written by the agent survives an empty room", { skip: !enabled }, async (t) => {
  const config = loadConfig();
  assert.ok(config.storageUrl, "set EXCALIDRAW_STORAGE_URL to run this test");
  const roomId = randomRoomId();
  const link = `${roomId},${KEY}`;

  const first = new RoomClient({ ...config, agentName: "pi-writer" });
  await first.join(link);
  const { elements } = buildElements(
    [
      { type: "rectangle", x: 20, y: 20, text: "Persisted" },
      { type: "ellipse", x: 320, y: 20 },
    ],
    { lastIndex: first.lastIndex() },
  );
  await first.apply(elements);
  await first.flushPersist();
  const written = first.status();
  assert.equal(written.persisted, true, `not persisted: ${written.persistError}`);
  await first.leave();

  // A brand new client, no browser anywhere: everything must come from storage.
  const second = new RoomClient({ ...config, agentName: "pi-reader" });
  t.after(async () => second.leave());
  const status = await second.join(link);

  assert.equal(status.elementCount, 3, "the stored scene did not come back");
  assert.equal(status.source, "storage");
  const labels = second
    .elements()
    .map((el) => el.text)
    .filter(Boolean);
  assert.deepEqual(labels, ["Persisted"]);
  const types = second.elements().map((el) => el.type).sort();
  assert.deepEqual(types, ["ellipse", "rectangle", "text"]);
});

test("a change after the first save is written too", { skip: !enabled }, async (t) => {
  const config = loadConfig();
  const roomId = randomRoomId();
  const link = `${roomId},${KEY}`;

  const client = new RoomClient({ ...config, agentName: "pi-two-writes" });
  await client.join(link);
  const { elements } = buildElements([{ type: "rectangle", x: 0, y: 0 }], { lastIndex: null });
  await client.apply(elements);
  await client.flushPersist();

  const { applyPatch } = await import("../src/scene/mutations.ts");
  const moved = applyPatch(client.sceneMap() as never, elements[0]!.id, { x: 500, y: 500 });
  await client.apply(moved);
  await client.flushPersist();
  await client.leave();

  const reader = new RoomClient({ ...config, agentName: "pi-reader-2" });
  t.after(async () => reader.leave());
  await reader.join(link);
  const restored = reader.elements()[0]!;
  assert.equal(restored.x, 500);
  assert.equal(restored.y, 500);
});

test("a newer stored scene is adopted, not overwritten", { skip: !enabled }, async (t) => {
  const config = loadConfig();
  assert.ok(config.storageUrl);
  const roomId = randomRoomId();
  const link = `${roomId},${KEY}`;

  const client = new RoomClient({ ...config, agentName: "pi-race" });
  t.after(async () => client.leave());
  await client.join(link);

  const { elements } = buildElements([{ type: "rectangle", x: 0, y: 0 }], { lastIndex: null });
  await client.apply(elements);
  await client.flushPersist();
  const mine = client.status();
  assert.equal(mine.persisted, true, `not persisted: ${mine.persistError}`);

  // A person's browser writes a later scene behind our back.
  const { saveRoom, loadRoom } = await import("../src/storage/http-storage.ts");
  const browserElement = {
    id: "browser-only",
    type: "ellipse",
    x: 500,
    y: 0,
    width: 80,
    height: 80,
    version: 9,
    versionNonce: 5,
    updated: 2,
    isDeleted: false,
    index: "a9",
  };
  const theirVersion = 999;
  await saveRoom(config.storageUrl, roomId, KEY, [browserElement], theirVersion);

  // Our next write must notice the newer copy and adopt it.
  const { applyPatch } = await import("../src/scene/mutations.ts");
  const moved = applyPatch(client.sceneMap() as never, elements[0]!.id, { x: 40 });
  await client.apply(moved);
  await client.flushPersist();

  assert.ok(
    client.elements().some((el) => el.id === "browser-only"),
    "the browser's element was not adopted",
  );
  const stored = await loadRoom(config.storageUrl, roomId, KEY);
  assert.equal(stored?.version, theirVersion, "the stored copy was overwritten");
  assert.ok((stored?.elements as { id: string }[]).some((el) => el.id === "browser-only"));
});
