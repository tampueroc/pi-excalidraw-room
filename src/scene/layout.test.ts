import { test } from "node:test";
import assert from "node:assert/strict";
import { layeredLayout, type LayoutEdge, type LayoutNode } from "./layout.ts";

function nodes(...ids: string[]): LayoutNode[] {
  return ids.map((id) => ({ id, width: 160, height: 80 }));
}

test("a chain lays out in one direction, one layer per hop", () => {
  const layout = layeredLayout(nodes("a", "b", "c"), [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ]);
  assert.deepEqual(layout.layers, [["a"], ["b"], ["c"]]);
  const [a, b, c] = ["a", "b", "c"].map((id) => layout.positions.get(id)!);
  if (!a || !b || !c) throw new Error("a layer is missing");
  assert.ok(b.x > a.x && c.x > b.x, "columns are not ordered left to right");
  assert.equal(a.y, b.y);
});

test("siblings share a column and are spread down it", () => {
  const layout = layeredLayout(nodes("root", "left", "right"), [
    { from: "root", to: "left" },
    { from: "root", to: "right" },
  ]);
  assert.deepEqual(layout.layers[1], ["left", "right"]);
  const left = layout.positions.get("left")!;
  const right = layout.positions.get("right")!;
  assert.equal(left.x, right.x);
  assert.ok(right.y >= left.y + 80, "siblings overlap");
});

test("a node takes the deepest layer that reaches it", () => {
  // a → b → d and a → d: d must sit after b, not beside it.
  const layout = layeredLayout(nodes("a", "b", "d"), [
    { from: "a", to: "b" },
    { from: "b", to: "d" },
    { from: "a", to: "d" },
  ]);
  assert.deepEqual(layout.layers, [["a"], ["b"], ["d"]]);
});

test("a cycle terminates instead of spinning", () => {
  const layout = layeredLayout(nodes("a", "b"), [
    { from: "a", to: "b" },
    { from: "b", to: "a" },
  ]);
  assert.equal(layout.positions.size, 2);
  assert.ok([...layout.positions.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test("edges naming unknown nodes are ignored", () => {
  const layout = layeredLayout(nodes("a"), [{ from: "a", to: "ghost" }]);
  assert.equal(layout.positions.size, 1);
});

test("an isolated node still gets a position", () => {
  const layout = layeredLayout(nodes("solo"), []);
  assert.deepEqual(layout.positions.get("solo"), { x: 0, y: 0 });
});

test("direction down stacks layers vertically", () => {
  const layout = layeredLayout(
    nodes("a", "b"),
    [{ from: "a", to: "b" }],
    { direction: "down" },
  );
  const a = layout.positions.get("a")!;
  const b = layout.positions.get("b")!;
  assert.equal(a.x, b.x);
  assert.ok(b.y > a.y);
});

test("the reported size covers the placed nodes", () => {
  const layout = layeredLayout(nodes("a", "b"), [{ from: "a", to: "b" }], {
    x: 100,
    y: 50,
    layerGap: 100,
  });
  const a = layout.positions.get("a")!;
  const b = layout.positions.get("b")!;
  assert.ok(a.x >= 100 && a.y >= 50);
  assert.ok(b.x + 160 <= 100 + layout.width + 1);
  assert.ok(layout.height >= 80);
});

test("edges keep deterministic order, so repeated runs agree", () => {
  const graph: LayoutEdge[] = [
    { from: "a", to: "b" },
    { from: "a", to: "c" },
  ];
  const first = layeredLayout(nodes("a", "b", "c"), graph);
  const second = layeredLayout(nodes("a", "b", "c"), graph);
  assert.deepEqual([...first.positions.entries()], [...second.positions.entries()]);
});
