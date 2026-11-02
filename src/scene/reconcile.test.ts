import { test } from "node:test";
import assert from "node:assert/strict";
import { isSceneElement, orderByIndex, reconcile, sceneVersion } from "./reconcile.ts";
import type { SceneElement } from "./types.ts";

function el(id: string, version: number, versionNonce = 1, extra: Partial<SceneElement> = {}): SceneElement {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version,
    versionNonce,
    updated: 0,
    isDeleted: false,
    ...extra,
  };
}

test("a newer remote version replaces the local element", () => {
  const merged = reconcile([el("a", 1)], [el("a", 2)]);
  assert.equal(merged[0]?.version, 2);
});

test("an older remote version is discarded", () => {
  const merged = reconcile([el("a", 5)], [el("a", 2)]);
  assert.equal(merged[0]?.version, 5);
});

test("on equal versions the lower versionNonce wins, on both sides", () => {
  const local = el("a", 3, 10);
  const remote = el("a", 3, 5);
  assert.equal(reconcile([local], [remote])[0]?.versionNonce, 5);
  assert.equal(reconcile([remote], [local])[0]?.versionNonce, 5);
});

test("remote elements the batch omitted survive", () => {
  const merged = reconcile([el("a", 1), el("b", 1)], [el("a", 2)]);
  assert.deepEqual(merged.map((e) => e.id).sort(), ["a", "b"]);
});

test("a deleted element stays in the scene, marked, and still reconciles", () => {
  const merged = reconcile([el("a", 1)], [el("a", 2, 1, { isDeleted: true })]);
  assert.equal(merged[0]?.isDeleted, true);
});

test("order follows index, with unindexed elements last", () => {
  const ordered = orderByIndex([el("c", 1), el("a", 1, 1, { index: "a1" }), el("b", 1, 1, { index: "a0" })]);
  assert.deepEqual(ordered.map((e) => e.id), ["b", "a", "c"]);
});

test("scene version is the sum of element versions", () => {
  assert.equal(sceneVersion([el("a", 2), el("b", 3)]), 5);
});

test("rejects payloads that are not elements", () => {
  assert.equal(isSceneElement({ id: "a", type: "rectangle" }), false);
  assert.equal(isSceneElement(null), false);
  assert.equal(isSceneElement("x"), false);
  assert.equal(isSceneElement(el("a", 1)), true);
});
