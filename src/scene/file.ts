/**
 * The `.excalidraw` file format, as the app writes it:
 *
 *   { type: "excalidraw", version: 2, source, elements, appState, files }
 *
 * Import never trusts the ids in the file: they are remapped so an imported
 * diagram cannot collide with, or overwrite, what is already in the room.
 */
import { generateKeyBetween } from "fractional-indexing";
import { bump, randomId, type BuiltElement } from "./elements.ts";
import { isSceneElement } from "./reconcile.ts";
import type { SceneElement } from "./types.ts";

export interface ExcalidrawFile {
  type: "excalidraw";
  version: number;
  source: string;
  elements: SceneElement[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

const SOURCE = "pi-excalidraw-room";

export function buildFile(
  elements: readonly SceneElement[],
  options: { viewBackgroundColor?: string; includeDeleted?: boolean } = {},
): ExcalidrawFile {
  return {
    type: "excalidraw",
    version: 2,
    source: SOURCE,
    elements: elements
      .filter((element) => options.includeDeleted === true || !element.isDeleted)
      .map((element) => ({ ...element })),
    appState: {
      gridSize: null,
      viewBackgroundColor: options.viewBackgroundColor ?? "#ffffff",
    },
    files: {},
  };
}

export function parseFile(json: string): {
  elements: SceneElement[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`not JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("not an Excalidraw file");
  const file = parsed as Partial<ExcalidrawFile>;
  if (file.type !== "excalidraw") {
    throw new Error(`not an Excalidraw file: type is ${JSON.stringify(file.type)}`);
  }
  if (!Array.isArray(file.elements)) throw new Error("the file has no elements array");

  const elements = file.elements.filter(isSceneElement);
  const dropped = file.elements.length - elements.length;
  if (elements.length === 0 && dropped > 0) throw new Error("the file has no usable elements");
  return {
    elements,
    appState: (file.appState as Record<string, unknown>) ?? {},
    files: (file.files as Record<string, unknown>) ?? {},
  };
}

const REFERENCE_KEYS = ["containerId", "frameId"] as const;

/** Fresh ids everywhere, references rewritten to match. */
export function remapIds(elements: readonly SceneElement[], newId: () => string = randomId): SceneElement[] {
  const ids = new Map<string, string>();
  for (const element of elements) ids.set(element.id, newId());

  return elements.map((element) => {
    const next: Record<string, unknown> = { ...element, id: ids.get(element.id)! };

    for (const key of REFERENCE_KEYS) {
      const value = next[key];
      if (typeof value === "string") next[key] = ids.get(value) ?? null;
    }

    for (const key of ["boundElements", "startBinding", "endBinding"] as const) {
      const value = next[key];
      if (Array.isArray(value)) {
        next[key] = value.map((bound) =>
          bound && typeof bound === "object" && typeof (bound as { id?: unknown }).id === "string"
            ? { ...bound, id: ids.get((bound as { id: string }).id) ?? (bound as { id: string }).id }
            : bound,
        );
      } else if (value && typeof value === "object") {
        const binding = value as { elementId?: unknown };
        if (typeof binding.elementId === "string") {
          next[key] = { ...binding, elementId: ids.get(binding.elementId) ?? binding.elementId };
        }
      }
    }

    return next as SceneElement;
  });
}

/** Place imported elements after everything already in the scene, bumped. */
export function appendToScene(
  elements: readonly SceneElement[],
  lastIndex: string | null,
): BuiltElement[] {
  let cursor = lastIndex;
  return elements.map((element) => {
    cursor = generateKeyBetween(cursor, null);
    return bump({ ...element, index: cursor, updated: Date.now() } as BuiltElement);
  });
}
