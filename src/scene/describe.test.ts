import { test } from "node:test";
import assert from "node:assert/strict";
import { labelOf, summarizeScene } from "./describe.ts";
import type { SceneElement } from "./types.ts";

function el(id: string, extra: Partial<SceneElement> = {}): SceneElement {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    version: 1,
    versionNonce: 1,
    updated: 0,
    isDeleted: false,
    ...extra,
  };
}

test("reads a shape's own text", () => {
  const text = el("t1", { type: "text", text: "hello" });
  assert.equal(labelOf(text, new Map([["t1", text]])), "hello");
});

test("reads the text element bound to a shape as its container", () => {
  const shape = el("s1");
  const label = el("t1", { type: "text", text: "API Gateway", containerId: "s1" });
  assert.equal(labelOf(shape, new Map([["s1", shape], ["t1", label]])), "");
  // Upstream binds both ways; the container also lists the label.
  const bound = el("s2", { boundElements: [{ id: "t2", type: "text" }] });
  const boundLabel = el("t2", { type: "text", text: "Queue", containerId: "s2" });
  assert.equal(labelOf(bound, new Map([["s2", bound], ["t2", boundLabel]])), "Queue");
});

test("summarises visible elements, bounds and deletions", () => {
  const summary = summarizeScene([
    el("a", { x: 0, y: 0, width: 100, height: 50 }),
    el("b", { x: 200, y: 100, width: 100, height: 50 }),
    el("gone", { isDeleted: true }),
  ]);
  assert.equal(summary.elementCount, 2);
  assert.equal(summary.deletedCount, 1);
  assert.deepEqual(summary.bounds, { x: 0, y: 0, width: 300, height: 150 });
  assert.match(summary.text, /2 visible element\(s\)/);
  assert.match(summary.text, /1 deleted/);
});

test("an empty scene has no bounds", () => {
  const summary = summarizeScene([]);
  assert.equal(summary.bounds, null);
  assert.equal(summary.elementCount, 0);
});

test("truncates long scenes and says how many were hidden", () => {
  const many = Array.from({ length: 5 }, (_, i) => el(`e${i}`));
  const summary = summarizeScene(many, 2);
  assert.match(summary.text, /3 more element\(s\)/);
  assert.equal(summary.elementCount, 5);
});
