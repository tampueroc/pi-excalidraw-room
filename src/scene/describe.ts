import { orderByIndex } from "./reconcile.ts";
import type { SceneElement } from "./types.ts";

/**
 * A compact, text-only view of the scene, so an agent can reason about a
 * diagram without receiving the raw element JSON of every shape.
 */
export interface SceneSummary {
  text: string;
  elementCount: number;
  deletedCount: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
}

/** The text a shape shows: its own text, or the text bound to it as a label. */
export function labelOf(element: SceneElement, byId: Map<string, SceneElement>): string {
  if (typeof element.text === "string" && element.text.trim()) return element.text.trim();
  if (element.containerId) {
    const container = byId.get(element.containerId);
    if (container && typeof container.text === "string" && container.text.trim()) {
      return container.text.trim();
    }
  }
  for (const bound of element.boundElements ?? []) {
    const child = byId.get(bound.id);
    if (child?.type === "text" && typeof child.text === "string" && child.text.trim()) {
      return child.text.trim();
    }
  }
  return "";
}

function describeElement(element: SceneElement, byId: Map<string, SceneElement>): string {
  const label = labelOf(element, byId);
  const head = `${element.type} ${element.id} v${element.version}`;
  const geometry = `${Math.round(element.x)},${Math.round(element.y)} ${Math.round(element.width)}×${Math.round(element.height)}`;
  const labelPart = label ? ` ${JSON.stringify(label)}` : "";
  return `- ${head}${labelPart} @ ${geometry}`;
}

export function summarizeScene(all: readonly SceneElement[], limit = 200): SceneSummary {
  const visible = all.filter((el) => !el.isDeleted);
  const deletedCount = all.length - visible.length;
  const ordered = orderByIndex(visible);
  const byId = new Map(all.map((el) => [el.id, el]));

  let bounds: SceneSummary["bounds"] = null;
  for (const el of ordered) {
    if (!bounds) {
      bounds = { x: el.x, y: el.y, width: el.width, height: el.height };
      continue;
    }
    const right = Math.max(bounds.x + bounds.width, el.x + el.width);
    const bottom = Math.max(bounds.y + bounds.height, el.y + el.height);
    bounds = {
      x: Math.min(bounds.x, el.x),
      y: Math.min(bounds.y, el.y),
      width: right - Math.min(bounds.x, el.x),
      height: bottom - Math.min(bounds.y, el.y),
    };
  }

  const shown = ordered.slice(0, limit).map((el) => describeElement(el, byId));
  const hidden = ordered.length - shown.length;
  const lines = [`${visible.length} visible element(s)`];
  if (deletedCount > 0) lines.push(`${deletedCount} deleted`);
  if (bounds) {
    lines.push(
      `bounds ${Math.round(bounds.x)},${Math.round(bounds.y)} → ${Math.round(bounds.x + bounds.width)},${Math.round(bounds.y + bounds.height)}`,
    );
  }
  if (shown.length) lines.push(...shown);
  if (hidden > 0) lines.push(`... ${hidden} more element(s), raise ` + "`limit` or filter by `ids`");

  return {
    text: lines.join("\n"),
    elementCount: visible.length,
    deletedCount,
    bounds,
  };
}
