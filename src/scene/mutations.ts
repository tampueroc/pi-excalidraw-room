/**
 * Local mutations. Every function here returns the elements that changed, all
 * of them bumped, ready to go out as a single SCENE_UPDATE.
 */
import { anchorPoint, attachBinding, bump, measureText, type Binding, type BuiltElement } from "./elements.ts";

export interface ElementPatch {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  strokeColor?: string;
  backgroundColor?: string;
}

export class MutationError extends Error {}

function labelOf(element: BuiltElement, scene: Map<string, BuiltElement>): BuiltElement | undefined {
  for (const bound of (element.boundElements as { id: string; type: string }[] | null) ?? []) {
    if (bound.type !== "text") continue;
    const child = scene.get(bound.id);
    if (child) return child;
  }
  return undefined;
}

function containerOf(element: BuiltElement, scene: Map<string, BuiltElement>): BuiltElement | undefined {
  const containerId = element.containerId as string | null | undefined;
  return containerId ? scene.get(containerId) : undefined;
}

function recenter(text: BuiltElement, container: BuiltElement): BuiltElement {
  const width = text.width;
  const height = text.height;
  return {
    ...text,
    x: Math.round(container.x + (container.width - width) / 2),
    y: Math.round(container.y + (container.height - height) / 2),
  };
}

function growToFit(container: BuiltElement, text: BuiltElement): BuiltElement {
  const width = Math.max(container.width, text.width + 32);
  const height = Math.max(container.height, text.height + 24);
  return width === container.width && height === container.height ? container : { ...container, width, height };
}

/** Patch one element, keeping a shape's label in step with it. */
export function applyPatch(
  scene: Map<string, BuiltElement>,
  id: string,
  patch: ElementPatch,
): BuiltElement[] {
  const element = scene.get(id);
  if (!element) throw new MutationError(`no element ${id} in this scene`);

  const next: BuiltElement = { ...element };
  for (const key of ["x", "y", "width", "height"] as const) {
    const value = patch[key];
    if (typeof value === "number" && Number.isFinite(value)) next[key] = value;
  }
  if (patch.strokeColor) next.strokeColor = patch.strokeColor;
  if (patch.backgroundColor) next.backgroundColor = patch.backgroundColor;

  const changed: BuiltElement[] = [];

  if (typeof patch.text === "string" && patch.text !== element.text) {
    if (element.type === "text") {
      next.text = patch.text;
      next.originalText = patch.text;
      const measured = measureText(patch.text, next.fontSize as number | undefined);
      next.width = measured.width;
      next.height = measured.height;
    } else {
      // A shape's text lives in a separate element bound to it.
      const existing = labelOf(element, scene);
      if (existing) {
        const updated = bump({
          ...existing,
          text: patch.text,
          originalText: patch.text,
          ...measureText(patch.text, existing.fontSize as number | undefined),
        });
        changed.push(updated);
        next.boundElements = element.boundElements;
      }
    }
  }

  changed.push(bump(next));
  return changed;
}

/** Delete elements and the text bound to them, the way the browser does. */
export function markDeleted(scene: Map<string, BuiltElement>, ids: string[]): BuiltElement[] {
  const changed: BuiltElement[] = [];
  const seen = new Set<string>();

  const kill = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const element = scene.get(id);
    if (!element || element.isDeleted) return;
    changed.push(bump({ ...element, isDeleted: true }));
    for (const bound of (element.boundElements as { id: string; type: string }[] | null) ?? []) {
      kill(bound.id);
    }
  };

  for (const id of ids) kill(id);
  if (changed.length === 0) throw new MutationError(`none of these ids are in the scene: ${ids.join(", ")}`);
  return changed;
}

/**
 * Re-point an arrow at two shapes. `null` unbinds that end, leaving the arrow
 * where it was; both shapes' boundElements are updated too.
 */
export function rebindArrow(
  scene: Map<string, BuiltElement>,
  arrowId: string,
  ends: { from?: string | null; to?: string | null },
): BuiltElement[] {
  const arrow = scene.get(arrowId);
  if (!arrow || arrow.type !== "arrow") throw new MutationError(`no arrow ${arrowId} in this scene`);

  const changed: BuiltElement[] = [];
  const next: BuiltElement = { ...arrow };

  for (const [key, bindingKey] of [
    ["from", "startBinding"],
    ["to", "endBinding"],
  ] as const) {
    const target = ends[key];
    if (target === undefined) continue;
    if (target === null) {
      next[bindingKey] = null;
      continue;
    }
    const shape = scene.get(target);
    if (!shape) throw new MutationError(`no element ${target} to bind to`);
    next[bindingKey] = { elementId: target, focus: 0, gap: 4 } satisfies Binding;
    changed.push(attachBinding(shape, arrow.id, "arrow"));
  }

  changed.push(bump(next));
  return changed;
}

/**
 * Move a set of elements, keeping the diagram attached to itself.
 *
 * A shape's label travels with it, and every arrow bound to a moved element is
 * re-anchored to the new facing edges — otherwise an arrow stays behind and the
 * picture stops describing what it says.
 */
export function translate(
  scene: Map<string, BuiltElement>,
  ids: readonly string[],
  dx: number,
  dy: number,
): BuiltElement[] {
  const missing = ids.filter((id) => !scene.has(id));
  if (missing.length) throw new MutationError(`no element(s) ${missing.join(", ")} in this scene`);
  if (dx === 0 && dy === 0) throw new MutationError("dx and dy are both zero: nothing to move");

  // The moved set: the ids asked for, plus the text bound inside each shape.
  const moving = new Set<string>(ids);
  for (const id of ids) {
    const element = scene.get(id)!;
    for (const bound of boundTextIds(element)) moving.add(bound);
  }

  const next = new Map<string, BuiltElement>();
  for (const id of moving) {
    const element = scene.get(id)!;
    next.set(id, { ...element, x: element.x + dx, y: element.y + dy });
  }

  // Arrows are not translated: their ends follow whatever they are bound to.
  for (const element of scene.values()) {
    if (element.type !== "arrow" || next.has(element.id)) continue;
    const start = (element.startBinding as Binding | null)?.elementId;
    const end = (element.endBinding as Binding | null)?.elementId;
    if (!start || !end) continue;
    if (!moving.has(start) && !moving.has(end)) continue;

    const from = next.get(start) ?? scene.get(start);
    const to = next.get(end) ?? scene.get(end);
    if (!from || !to) continue;
    const rerouted = reroute(element, from, to);
    if (rerouted) next.set(element.id, rerouted);
  }

  return [...next.values()].map((element) => bump(element));
}

/** Point an arrow at the facing edges of two shapes. */
export function reroute(
  arrow: BuiltElement,
  from: BuiltElement,
  to: BuiltElement,
): BuiltElement | null {
  if (arrow.type !== "arrow") return null;
  const start = anchorPoint(from, to);
  const end = anchorPoint(to, from);
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    ...arrow,
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    points: [
      [start.x - x, start.y - y],
      [end.x - x, end.y - y],
    ],
  };
}

/** Ids of the text elements bound to a container. */
export function boundTextIds(element: BuiltElement): string[] {
  return ((element.boundElements as { id: string; type: string }[] | null) ?? [])
    .filter((bound) => bound.type === "text")
    .map((bound) => bound.id);
}

export { containerOf, labelOf, growToFit, recenter };
