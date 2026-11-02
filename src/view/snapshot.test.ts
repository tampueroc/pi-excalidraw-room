import { test } from "node:test";
import assert from "node:assert/strict";
import { buildElements } from "../scene/elements.ts";
import { forRasterizer, renderScene } from "./snapshot.ts";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

function diagram() {
  const first = buildElements(
    [{ type: "rectangle", x: 0, y: 0, width: 200, height: 90, text: "API", backgroundColor: "#a5d8ff" }],
    { lastIndex: null, now: 1 },
  );
  const second = buildElements([{ type: "ellipse", x: 360, y: 0, width: 200, height: 90, text: "DB" }], {
    lastIndex: "a0",
    now: 1,
  });
  const scene = new Map([...first.elements, ...second.elements].map((el) => [el.id, el]));
  const arrow = buildElements(
    [{ type: "arrow", from: first.elements[0]!.id, to: second.elements[0]!.id }],
    { lastIndex: "a2", existing: scene },
  );
  return [...first.elements, ...second.elements, ...arrow.elements];
}

test("Excalidraw's exporter renders the scene to a PNG", async () => {
  const snapshot = await renderScene(diagram(), { maxWidth: 600 });
  assert.deepEqual([...snapshot.png.slice(0, 4)], PNG_MAGIC);
  assert.equal(snapshot.width, 600);
  assert.ok(snapshot.height > 100, `unexpected height ${snapshot.height}`);
  assert.ok(snapshot.png.byteLength > 2000, "the PNG is suspiciously small");
});

test("the SVG it exported carries the shapes and the label", async () => {
  const snapshot = await renderScene(diagram(), { maxWidth: 400 });
  assert.match(snapshot.svg, /^<svg/);
  assert.match(snapshot.svg, /<path/, "Excalidraw draws shapes as rough paths");
  assert.match(snapshot.svg, /API/);
  assert.ok(snapshot.fontFamily, "no font was found for labels");
});

test("deleted elements are left out, and an empty scene is refused", async () => {
  const scene = diagram().map((el) => ({ ...el, isDeleted: true }));
  await assert.rejects(() => renderScene(scene), /nothing to draw/);
});

test("masks are given explicit units for the rasteriser", () => {
  const input = '<svg><mask id="m"><rect/></mask><mask id="n" maskUnits="x"/></svg>';
  const output = forRasterizer(input);
  assert.match(output, /<mask maskUnits="userSpaceOnUse" id="m"/);
  assert.equal(output.match(/maskUnits=/g)?.length, 2, "an existing maskUnits was duplicated");
});

test("a labelled arrow keeps its label and its line", async () => {
  const first = buildElements([{ type: "rectangle", x: 0, y: 0, width: 120, height: 60 }], { lastIndex: null, now: 1 });
  const scene = new Map(first.elements.map((el) => [el.id, el]));
  const second = buildElements([{ type: "rectangle", x: 300, y: 0, width: 120, height: 60 }], { lastIndex: "a0", now: 1 });
  for (const element of second.elements) scene.set(element.id, element);
  const arrow = buildElements(
    [{ type: "arrow", from: first.elements[0]!.id, to: second.elements[0]!.id, text: "HTTP" }],
    { lastIndex: "a1", existing: scene },
  );
  const elements = [...first.elements, ...second.elements, ...arrow.elements];
  const snapshot = await renderScene(elements, { maxWidth: 480 });
  assert.match(snapshot.svg, /<mask maskUnits="userSpaceOnUse"/);
  assert.match(snapshot.svg, /HTTP/);
  assert.ok(snapshot.png.byteLength > 2000);
});
