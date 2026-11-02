import { test } from "node:test";
import assert from "node:assert/strict";
import { appendToScene, buildFile, parseFile, remapIds } from "./file.ts";
import { buildElements } from "./elements.ts";
import type { SceneElement } from "./types.ts";

function scene() {
  const first = buildElements(
    [{ type: "rectangle", x: 0, y: 0, text: "API" }, { type: "rectangle", x: 300, y: 0 }],
    { lastIndex: null, now: 1 },
  );
  const map = new Map([...first.elements].map((el) => [el.id, el]));
  const arrow = buildElements(
    [{ type: "arrow", from: first.elements[0]!.id, to: first.elements[1]!.id }],
    { lastIndex: "a2", existing: map },
  );
  return [...first.elements, ...arrow.elements];
}

test("export writes the format the app opens", () => {
  const file = buildFile(scene());
  assert.equal(file.type, "excalidraw");
  assert.equal(file.version, 2);
  assert.equal(file.appState.viewBackgroundColor, "#ffffff");
  assert.deepEqual(file.files, {});
  assert.equal(file.elements.length, 4);
});

test("deleted elements are left out unless asked for", () => {
  const elements = scene().map((el) => ({ ...el, isDeleted: true }));
  assert.equal(buildFile(elements).elements.length, 0);
  assert.equal(buildFile(elements, { includeDeleted: true }).elements.length, 4);
});

test("export then import round-trips the elements", () => {
  const file = buildFile(scene());
  const parsed = parseFile(JSON.stringify(file));
  assert.equal(parsed.elements.length, 4);
  assert.deepEqual(
    parsed.elements.map((el) => el.type).sort(),
    ["arrow", "rectangle", "rectangle", "text"],
  );
});

test("a file that is not Excalidraw is refused with a reason", () => {
  assert.throws(() => parseFile("{}"), /type is/);
  assert.throws(() => parseFile("not json"), /not JSON/);
  assert.throws(() => parseFile('{"type":"excalidraw"}'), /no elements array/);
});

test("import remaps ids and every reference to them", () => {
  const original = scene();
  const remapped = remapIds(original);

  const oldIds = new Set(original.map((el) => el.id));
  for (const element of remapped) assert.ok(!oldIds.has(element.id), "an id was reused");

  const byOld = new Map(original.map((el) => [el.id, remapped[original.indexOf(el)]!]));

  for (const [index, element] of original.entries()) {
    const next = remapped[index]!;
    // The label still points at its shape.
    if (element.containerId) {
      assert.equal(next.containerId, byOld.get(element.containerId)!.id);
    }
    // A shape still lists the label and arrow under their new ids.
    for (const bound of element.boundElements ?? []) {
      const newBound = next.boundElements?.find((candidate) => candidate.type === bound.type);
      assert.ok(newBound, `bound ${bound.type} disappeared`);
      assert.equal(newBound!.id, byOld.get(bound.id)!.id);
    }
    // The arrow still binds the two shapes.
    const binding = element.startBinding as { elementId: string } | null | undefined;
    if (binding) {
      assert.equal((next.startBinding as { elementId: string }).elementId, byOld.get(binding.elementId)!.id);
    }
  }
});

test("imported elements land after the ones already in the scene", () => {
  const prepared = appendToScene(scene(), "a5");
  for (const element of prepared) {
    assert.ok(element.index > "a5", `${element.index} is not after a5`);
    assert.ok(element.version > 1, "imported elements must win over stale copies");
  }
  const indexes = prepared.map((el) => el.index);
  assert.deepEqual([...indexes].sort(), indexes);
});

test("junk elements inside a file are dropped, not fatal", () => {
  const json = JSON.stringify({
    type: "excalidraw",
    elements: [{ id: "x", type: "rectangle", x: 0, y: 0, version: 1, versionNonce: 1 }, { nonsense: true }],
  });
  const parsed = parseFile(json);
  assert.equal(parsed.elements.length, 1);
});

test("a file with nothing usable says so", () => {
  const json = JSON.stringify({ type: "excalidraw", elements: [{ nonsense: true }] });
  assert.throws(() => parseFile(json), /no usable elements/);
});

test("exported elements carry no reference to another package's marker", () => {
  const elements: SceneElement[] = scene();
  const file = buildFile(elements);
  for (const element of file.elements) assert.ok(!("piMarker" in element));
});
