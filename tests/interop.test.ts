/**
 * Interop guard against the deployed frontend.
 *
 * tests/fixtures/browser-scene.json was captured from the live room after
 * Excalidraw 0.18.1 (alswl fork) applied elements this package created: two
 * rectangles, a bound label and a bound arrow. If upstream changes the element
 * shape, these assertions fail here before a person sees a broken canvas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildElements, type BuiltElement } from "../src/scene/elements.ts";
import { isSceneElement } from "../src/scene/reconcile.ts";
import { labelOf, summarizeScene } from "../src/scene/describe.ts";
import type { SceneElement } from "../src/scene/types.ts";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/browser-scene.json", import.meta.url), "utf8"),
) as SceneElement[];

const byType = (type: string) => fixture.filter((el) => el.type === type);

test("the browser's scene is element shaped as far as we are concerned", () => {
  assert.equal(fixture.length, 4);
  for (const element of fixture) assert.ok(isSceneElement(element), `${element.id} not recognised`);
});

test("a shape's label is found through boundElements and containerId", () => {
  const labelled = fixture.find((el) => el.type === "rectangle" && el.text === undefined)!;
  const withLabel = byType("rectangle").find((el) => labelOf(el, new Map(fixture.map((e) => [e.id, e]))));
  assert.ok(withLabel, "no labelled rectangle in the fixture");
  assert.equal(labelOf(withLabel!, new Map(fixture.map((e) => [e.id, e]))), "API Gateway");
  assert.ok(labelled);
});

test("both arrow ends are bound to the rectangles that exist", () => {
  const arrow = byType("arrow")[0] as SceneElement & {
    startBinding: { elementId: string };
    endBinding: { elementId: string };
  };
  const ids = new Set(fixture.map((el) => el.id));
  assert.ok(ids.has(arrow.startBinding.elementId));
  assert.ok(ids.has(arrow.endBinding.elementId));
  assert.notEqual(arrow.startBinding.elementId, arrow.endBinding.elementId);
});

test("the scene summary reads like a diagram, not a dump", () => {
  const summary = summarizeScene(fixture);
  assert.equal(summary.elementCount, 4);
  assert.match(summary.text, /API Gateway/);
  assert.deepEqual(summary.bounds, { x: 100, y: 100, width: 600, height: 100 });
});

/**
 * The field set is the contract: a field we omit disappears from the drawing,
 * and one upstream adds is a change we should notice.
 */
test("our builders emit the same fields the browser persisted", () => {
  const built = buildElements(
    [
      { type: "rectangle", x: 0, y: 0, text: "square" },
      { type: "text", x: 0, y: 200, text: "free text" },
    ],
    { lastIndex: null },
  );
  const scene = new Map([...built.elements].map((el) => [el.id, el]));
  const arrow = buildElements([{ type: "arrow", from: built.elements[0]!.id, to: built.elements[0]!.id }], {
    lastIndex: "a9",
    existing: scene,
  }).elements[0]!;

  const ours: Record<string, string[]> = {
    rectangle: Object.keys(built.elements[0]!).sort(),
    text: Object.keys(built.elements[1]!).sort(),
    arrow: Object.keys(arrow).sort(),
  };

  for (const type of ["rectangle", "text", "arrow"] as const) {
    const theirs = Object.keys(byType(type)[0] as BuiltElement).sort();
    assert.deepEqual(ours[type], theirs, `${type} field set drifted from the browser`);
  }
});
