import { test } from "node:test";
import assert from "node:assert/strict";
import { buildElements, measureText, randomId, type BuiltElement } from "./elements.ts";

test("a rectangle carries every field Excalidraw renders from", () => {
  const { elements } = buildElements([{ type: "rectangle", x: 100, y: 200 }], { lastIndex: null });
  const rect = elements[0] as BuiltElement;
  for (const field of [
    "id",
    "type",
    "x",
    "y",
    "width",
    "height",
    "angle",
    "strokeColor",
    "backgroundColor",
    "fillStyle",
    "strokeWidth",
    "strokeStyle",
    "roughness",
    "opacity",
    "groupIds",
    "frameId",
    "roundness",
    "seed",
    "version",
    "versionNonce",
    "isDeleted",
    "boundElements",
    "updated",
    "link",
    "locked",
    "index",
  ]) {
    assert.ok(field in rect, `missing field ${field}`);
  }
  assert.equal(rect.width, 160);
  assert.equal(rect.height, 80);
  assert.equal(rect.isDeleted, false);
  assert.equal(rect.index, "a0");
});

test("a labelled shape gets a bound text element, and both link to each other", () => {
  const { elements } = buildElements([{ type: "rectangle", x: 0, y: 0, text: "API Gateway" }], {
    lastIndex: null,
  });
  const [shape, label] = elements as [BuiltElement, BuiltElement];
  assert.equal(shape.boundElements?.[0]?.id, label.id);
  assert.equal(label.containerId, shape.id);
  assert.equal(label.text, "API Gateway");
  assert.ok(shape.width >= label.width);
  assert.ok(shape.height >= label.height);
  // The label sits inside the shape.
  assert.ok(label.x >= shape.x && label.x + label.width <= shape.x + shape.width + 1);
});

test("text elements have no roundness and are left aligned", () => {
  const { elements } = buildElements([{ type: "text", x: 10, y: 20, text: "hello" }], { lastIndex: null });
  const text = elements[0] as BuiltElement;
  assert.equal(text.roundness, null);
  assert.equal(text.textAlign, "left");
  assert.equal(text.fontFamily, 1);
  assert.equal(text.originalText, "hello");
});

test("each element gets a fresh index after the last one", () => {
  const { elements } = buildElements(
    [
      { type: "rectangle", x: 0, y: 0 },
      { type: "rectangle", x: 200, y: 0 },
    ],
    { lastIndex: "a0" },
  );
  const indexes = elements.map((el) => el.index) as string[];
  assert.deepEqual([...indexes].sort(), indexes);
  assert.ok(indexes.every((index) => index > "a0"));
});

test("an arrow binds both ends and records itself on each shape", () => {
  const first = buildElements([{ type: "rectangle", x: 0, y: 0 }], { lastIndex: null, now: 1 });
  const second = buildElements([{ type: "rectangle", x: 400, y: 0 }], { lastIndex: null, now: 1 });
  const scene = new Map([...first.elements, ...second.elements].map((el) => [el.id, el]));
  const from = first.elements[0]!.id;
  const to = second.elements[0]!.id;

  const { elements, touched } = buildElements([{ type: "arrow", from, to }], {
    lastIndex: "a0",
    existing: scene,
  });

  const arrow = elements[0] as BuiltElement;
  assert.equal(arrow.type, "arrow");
  assert.equal((arrow.startBinding as { elementId: string }).elementId, from);
  assert.equal((arrow.endBinding as { elementId: string }).elementId, to);
  assert.equal(arrow.endArrowhead, "arrow");
  assert.equal(touched.length, 2);
  for (const shape of touched) {
    assert.ok(shape.boundElements?.some((bound) => bound.id === arrow.id));
    assert.equal(shape.version, 2);
  }
  // The arrow leaves the first shape's right edge and enters the second's left.
  assert.equal(arrow.x, 164);
  assert.equal(arrow.width, 232);
});

test("ids are unique and URL-safe", () => {
  const ids = new Set(Array.from({ length: 50 }, () => randomId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9]{20}$/);
});

test("text metrics grow with line count and length", () => {
  const short = measureText("a");
  const long = measureText("aaaaaaaa");
  const multiline = measureText("a\nb");
  assert.ok(long.width > short.width);
  assert.ok(multiline.height > short.height);
});
