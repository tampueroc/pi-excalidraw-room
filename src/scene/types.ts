/**
 * Element shapes and scene arithmetic.
 *
 * The reconciliation rule is upstream's (packages/excalidraw/data/reconcile.ts,
 * MIT) minus the "element currently being edited" checks, which only matter
 * inside a browser session: per id keep the higher version, and on a tie the
 * lower versionNonce, so every peer resolves a conflict the same way.
 */

export interface Bindable {
  id: string;
  type: string;
}

export interface SceneElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  version: number;
  versionNonce: number;
  updated: number;
  isDeleted: boolean;
  index?: string | null;
  text?: string;
  containerId?: string | null;
  boundElements?: Bindable[] | null;
  [key: string]: unknown;
}

export interface ElementLike {
  id: string;
  version: number;
  versionNonce: number;
  index?: string | null;
}
