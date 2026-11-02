import { test } from "node:test";
import assert from "node:assert/strict";
import { buildElements, type BuiltElement, type ElementSpec } from "./elements.ts";
import { applyPatch, markDeleted, MutationError, rebindArrow, translate } from "./mutations.ts";

function sceneOf(...specs: ElementSpec[]): Map<string, BuiltElement> {
  const { elements } = buildElements(specs, { lastIndex: null, now: 1 });
  return new Map(elements.map((el) => [el.id, el]));
}

test("moving an element bumps its version so peers accept it", () => {
  const scene = sceneOf({ type: "rectangle", x: 0, y: 0 });
  const id = [...scene.keys()][0]!;
  const before = scene.get(id)!;
  const [changed] = applyPatch(scene, id, { x: 50, y: 60 });
  assert.equal(changed!.x, 50);
  assert.equal(changed!.y, 60);
  assert.equal(changed!.version, before.version + 1);
  assert.notEqual(changed!.versionNonce, before.versionNonce);
});

test("a padding-only patch does not touch geometry", () => {
  const scene = sceneOf({ type: "rectangle", x: 10, y: 10, width: 100, height: 50 });
  const id = [...scene.keys()][0]!;
  const [changed] = applyPatch(scene, id, { backgroundColor: "#ffc9c9" });
  assert.equal(changed!.width, 100);
  assert.equal(changed!.backgroundColor, "#ffc9c9");
});

test("re-labelling a shape updates its bound text element", () => {
  const scene = sceneOf({ type: "rectangle", x: 0, y: 0, text: "before" });
  const shape = [...scene.values()].find((el) => el.type === "rectangle")!;
  const labelId = shape.boundElements![0]!.id as string;

  const changed = applyPatch(scene, shape.id, { text: "after, and much longer" });
  const label = changed.find((el) => el.id === labelId)!;
  assert.equal(label.text, "after, and much longer");
  assert.equal(label.originalText, "after, and much longer");
  assert.ok(label.width > 0);
  assert.equal(changed.length, 2);
});

test("re-texting a text element resizes it", () => {
  const scene = sceneOf({ type: "text", x: 0, y: 0, text: "a" });
  const id = [...scene.keys()][0]!;
  const [changed] = applyPatch(scene, id, { text: "a much longer sentence" });
  assert.ok(changed!.width > 20);
  assert.equal(changed!.text, "a much longer sentence");
});

test("patching an unknown id is an error, not a no-op", () => {
  const scene = sceneOf({ type: "rectangle", x: 0, y: 0 });
  assert.throws(() => applyPatch(scene, "nope", { x: 1 }), MutationError);
});

test("deleting a shape deletes its label too", () => {
  const scene = sceneOf({ type: "rectangle", x: 0, y: 0, text: "gone" });
  const shape = [...scene.values()].find((el) => el.type === "rectangle")!;
  const changed = markDeleted(scene, [shape.id]);
  assert.equal(changed.length, 2);
  assert.ok(changed.every((el) => el.isDeleted === true));
  assert.ok(changed.every((el) => el.version === 2));
  for (const element of changed) scene.set(element.id, element);
});

test("deleting an already deleted element is refused rather than rebroadcast", () => {
  const scene = sceneOf({ type: "rectangle", x: 0, y: 0 });
  const id = [...scene.keys()][0]!;
  for (const element of markDeleted(scene, [id])) scene.set(element.id, element);
  assert.throws(() => markDeleted(scene, [id]), MutationError);
});

test("rebinding an arrow records it on each shape", () => {
  const scene = sceneOf(
    { type: "rectangle", x: 0, y: 0 },
    { type: "rectangle", x: 400, y: 0 },
  );
  const [aId, bId] = [...scene.keys()] as [string, string];
  const { elements } = buildElements([{ type: "arrow", from: aId, to: bId }], {
    lastIndex: "a0",
    existing: scene,
  });
  const arrow = elements[0]!;
  scene.set(arrow.id, arrow);

  const changed = rebindArrow(scene, arrow.id, { to: aId });
  const rebound = changed.find((el) => el.id === arrow.id)!;
  assert.equal((rebound.endBinding as { elementId: string }).elementId, aId);
  assert.ok(changed.some((el) => el.id === aId));
});

test("unbinding an end leaves the arrow placed", () => {
  const scene = sceneOf({ type: "rectangle", x: 0, y: 0 }, { type: "rectangle", x: 400, y: 0 });
  const [aId, bId] = [...scene.keys()] as [string, string];
  const { elements } = buildElements([{ type: "arrow", from: aId, to: bId }], {
    lastIndex: "a0",
    existing: scene,
  });
  const arrow = elements[0]!;
  scene.set(arrow.id, arrow);
  const [changed] = rebindArrow(scene, arrow.id, { from: null });
  assert.equal(changed!.startBinding, null);
  assert.ok(changed!.x === arrow.x);
});

test("moving a shape takes its label and re-anchors its arrow", () => {
  const scene = sceneOf(
    { type: "rectangle", x: 0, y: 0, width: 160, height: 80, text: "API" },
    { type: "rectangle", x: 400, y: 0 },
  );
  const shapes = [...scene.values()].filter((el) => el.type === "rectangle");
  const [first, second] = shapes as [BuiltElement, BuiltElement];
  const { elements } = buildElements([{ type: "arrow", from: first.id, to: second.id }], {
    lastIndex: "a9",
    existing: scene,
  });
  const arrow = elements[0]!;
  scene.set(arrow.id, arrow);
  for (const touched of elements.slice(1)) scene.set(touched.id, touched);

  const before = scene.get(arrow.id)!;
  const changed = translate(scene, [first.id], 0, 300);
  const movedShape = changed.find((el) => el.id === first.id)!;
  const movedLabel = changed.find((el) => el.id === first.boundElements!.find((b) => b.type === "text")!.id)!;
  const movedArrow = changed.find((el) => el.id === arrow.id)!;

  assert.equal(movedShape.y, 300);
  assert.equal(movedLabel.y, first.y + 300 + (movedLabel.y - 300 - first.y));
  const labelOffsetBefore = (scene.get(movedLabel.id)!.y as number) - first.y;
  assert.equal(movedLabel.y - movedShape.y, labelOffsetBefore, "the label drifted out of its shape");
  // The far end did not move, so the bounding box grows rather than shifts.
  assert.equal(before.height, 0);
  assert.equal(movedArrow.height, 300, "the arrow did not follow the shape");
  assert.notDeepEqual(movedArrow.points, before.points);
  assert.equal((movedArrow.startBinding as { elementId: string }).elementId, first.id);
  assert.equal((movedArrow.endBinding as { elementId: string }).elementId, second.id);
});

test("moving both ends keeps the arrow between them", () => {
  const scene = sceneOf({ type: "rectangle", x: 0, y: 0 }, { type: "rectangle", x: 400, y: 0 });
  const [a, b] = [...scene.values()] as [BuiltElement, BuiltElement];
  const { elements } = buildElements([{ type: "arrow", from: a.id, to: b.id }], {
    lastIndex: "a9",
    existing: scene,
  });
  scene.set(elements[0]!.id, elements[0]!);
  const arrowBefore = elements[0]!;

  const changed = translate(scene, [a.id, b.id], 100, 0);
  const arrow = changed.find((el) => el.id === arrowBefore.id)!;
  assert.equal(arrow.x, arrowBefore.x + 100);
  assert.equal(arrow.width, arrowBefore.width);
});

test("an unknown id or a no-op delta is refused", () => {
  const scene = sceneOf({ type: "rectangle", x: 0, y: 0 });
  const id = [...scene.keys()][0]!;
  assert.throws(() => translate(scene, ["nope"], 10, 0), MutationError);
  assert.throws(() => translate(scene, [id], 0, 0), MutationError);
});
