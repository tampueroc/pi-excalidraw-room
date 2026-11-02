import type { ElementLike, SceneElement } from "./types.ts";

/** True when the local copy wins over the incoming one for the same id. */
export function shouldDiscardRemote<T extends ElementLike>(
  local: T | undefined,
  remote: T,
): boolean {
  if (!local) return false;
  if (local.version > remote.version) return true;
  if (local.version === remote.version && local.versionNonce <= remote.versionNonce) return true;
  return false;
}

/** Scene order is `index` (fractional indexing); elements without one go last. */
export function orderByIndex<T extends ElementLike>(elements: readonly T[]): T[] {
  return [...elements].sort((a, b) => {
    const ai = a.index ?? null;
    const bi = b.index ?? null;
    if (ai === bi) return 0;
    if (ai === null) return 1;
    if (bi === null) return -1;
    return ai < bi ? -1 : 1;
  });
}

/**
 * Merge a remote batch into the local scene: one winner per id, local elements
 * the batch did not mention survive, and the result comes back in scene order.
 */
export function reconcile<T extends ElementLike>(local: readonly T[], remote: readonly T[]): T[] {
  const localById = new Map(local.map((el) => [el.id, el]));
  const seen = new Set<string>();
  const out: T[] = [];

  for (const remoteEl of remote) {
    if (seen.has(remoteEl.id)) continue;
    const localEl = localById.get(remoteEl.id);
    out.push(localEl && shouldDiscardRemote(localEl, remoteEl) ? localEl : remoteEl);
    seen.add(remoteEl.id);
  }
  for (const localEl of local) {
    if (!seen.has(localEl.id)) out.push(localEl);
  }

  return orderByIndex(out);
}

/** Upstream's getSceneVersion: the sum of every element's version, deleted ones included. */
export function sceneVersion(elements: readonly ElementLike[]): number {
  return elements.reduce((sum, el) => sum + el.version, 0);
}

/** Whatever arrives on the wire is untrusted: keep only element-shaped objects. */
export function isSceneElement(value: unknown): value is SceneElement {
  if (typeof value !== "object" || value === null) return false;
  const el = value as Record<string, unknown>;
  return (
    typeof el.id === "string" &&
    typeof el.type === "string" &&
    typeof el.version === "number" &&
    typeof el.versionNonce === "number" &&
    typeof el.x === "number" &&
    typeof el.y === "number"
  );
}
