/**
 * Element builders.
 *
 * Excalidraw renders from the element object itself, so every field it reads
 * has to be present with the right type: a missing `seed` or `versionNonce`
 * gives a shape that draws once and then disappears on the next reconcile.
 * Fields and defaults follow upstream's newElement/newTextElement at 0.18.
 */
import { generateKeyBetween } from "fractional-indexing";

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const FONT_SIZE = 20;
const LINE_HEIGHT = 1.25;
/** Upstream binds arrows to shapes with a small gap so they do not overlap. */
export const BINDING_GAP = 4;

export type ShapeType = "rectangle" | "ellipse" | "diamond";
export type ElementType = ShapeType | "text" | "arrow";

export interface Binding {
  elementId: string;
  focus: number;
  gap: number;
}

export interface BuiltElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  version: number;
  versionNonce: number;
  updated: number;
  isDeleted: boolean;
  index: string;
  text?: string;
  originalText?: string;
  containerId?: string | null;
  boundElements?: { id: string; type: string }[] | null;
  startBinding?: Binding | null;
  endBinding?: Binding | null;
  [key: string]: unknown;
}

export interface ShapeSpec {
  type: ShapeType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  strokeColor?: string;
  backgroundColor?: string;
  id?: string;
}

export interface TextSpec {
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize?: number;
  strokeColor?: string;
  id?: string;
}

export interface ArrowSpec {
  type: "arrow";
  /** Element to start at; when omitted the arrow starts at x,y. */
  from?: string;
  /** Element to end at; when omitted it ends at the arrow's own tip. */
  to?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  strokeColor?: string;
  id?: string;
}

export type ElementSpec = ShapeSpec | TextSpec | ArrowSpec;

export interface BuildContext {
  /** Fractional index of the last element in the scene, or null when empty. */
  lastIndex: string | null;
  now?: number;
  /** Elements arrows may bind to, by id. */
  existing?: Map<string, BuiltElement>;
}

export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
}

function randomInt(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/**
 * Text metrics without a DOM. Excalidraw measures with the real font; these
 * numbers only need to be close enough that the shape fits its label, since
 * the browser recomputes them the first time a person edits the text.
 */
export function measureText(text: string, fontSize = FONT_SIZE): { width: number; height: number } {
  const lines = text.split("\n");
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 1);
  return {
    width: Math.ceil(longest * fontSize * 0.55),
    height: Math.ceil(lines.length * fontSize * LINE_HEIGHT),
  };
}

function textElement(
  spec: { text: string; x: number; y: number; fontSize?: number; strokeColor?: string; id?: string },
  containerId: string | null,
  index: string,
  now: number,
): BuiltElement {
  const fontSize = spec.fontSize ?? FONT_SIZE;
  const size = measureText(spec.text, fontSize);
  return {
    id: spec.id ?? randomId(),
    type: "text",
    x: spec.x,
    y: spec.y,
    width: size.width,
    height: size.height,
    angle: 0,
    strokeColor: spec.strokeColor ?? "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,
    fontSize,
    fontFamily: 1,
    text: spec.text,
    originalText: spec.text,
    textAlign: containerId ? "center" : "left",
    verticalAlign: containerId ? "middle" : "top",
    containerId,
    lineHeight: LINE_HEIGHT,
    autoResize: true,
    index,
  };
}

function shapeElement(
  spec: ShapeSpec,
  index: string,
  now: number,
  labelId: string | null,
  size: { width: number; height: number },
): BuiltElement {
  return {
    id: spec.id ?? randomId(),
    type: spec.type,
    x: spec.x,
    y: spec.y,
    width: size.width,
    height: size.height,
    angle: 0,
    strokeColor: spec.strokeColor ?? "#1e1e1e",
    backgroundColor: spec.backgroundColor ?? "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: spec.type === "rectangle" ? { type: 3 } : spec.type === "diamond" ? { type: 2 } : null,
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    isDeleted: false,
    boundElements: labelId ? [{ type: "text", id: labelId }] : null,
    updated: now,
    link: null,
    locked: false,
    index,
  };
}

const DEFAULT_SHAPE = { width: 160, height: 80 };

/** The anchor point an arrow leaves a shape from: the side facing the target. */
export function anchorPoint(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  const tx = to.x + to.width / 2;
  const ty = to.y + to.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: dx >= 0 ? from.x + from.width + BINDING_GAP : from.x - BINDING_GAP, y: cy };
  }
  return { x: cx, y: dy >= 0 ? from.y + from.height + BINDING_GAP : from.y - BINDING_GAP };
}

export interface BuildResult {
  elements: BuiltElement[];
  /** Elements whose `boundElements` changed, ready to broadcast as updates. */
  touched: BuiltElement[];
}

export function buildElements(specs: ElementSpec[], ctx: BuildContext): BuildResult {
  const now = ctx.now ?? Date.now();
  const elements: BuiltElement[] = [];
  const touched: BuiltElement[] = [];
  const byId = new Map<string, BuiltElement>(ctx.existing ?? []);
  let lastIndex = ctx.lastIndex;

  for (const spec of specs) {
    lastIndex = generateKeyBetween(lastIndex, null);

    if (spec.type === "text") {
      const text = textElement(spec, null, lastIndex, now);
      elements.push(text);
      byId.set(text.id, text);
      continue;
    }

    if (spec.type === "arrow") {
      const arrow = buildArrow(spec, lastIndex, now, byId);
      elements.push(arrow);
      for (const binding of [arrow.startBinding, arrow.endBinding]) {
        const bound = binding ? byId.get((binding as Binding).elementId) : undefined;
        if (bound) touched.push(attachBinding(bound, arrow.id, "arrow"));
      }
      byId.set(arrow.id, arrow);
      continue;
    }

    const label = spec.text?.trim() ? spec.text : null;
    const measured = label ? measureText(label) : null;
    const size = {
      width: Math.max(spec.width ?? DEFAULT_SHAPE.width, measured ? measured.width + 32 : 0),
      height: Math.max(spec.height ?? DEFAULT_SHAPE.height, measured ? measured.height + 24 : 0),
    };
    const labelId = label ? randomId() : null;
    const shape = shapeElement(spec, lastIndex, now, labelId, size);
    elements.push(shape);
    byId.set(shape.id, shape);

    if (label && labelId) {
      const text = textElement(
        {
          text: label,
          x: Math.round(shape.x + (size.width - (measured?.width ?? 0)) / 2),
          y: Math.round(shape.y + (size.height - (measured?.height ?? 0)) / 2),
          id: labelId,
        },
        shape.id,
        generateKeyBetween(lastIndex, null),
        now,
      );
      lastIndex = text.index;
      elements.push(text);
      byId.set(text.id, text);
    }
  }

  return { elements, touched };
}

type LinearElement = BuiltElement & {
  points: [number, number][];
  startBinding: Binding | null;
  endBinding: Binding | null;
  lastCommittedPoint: null;
};

function buildArrow(
  spec: ArrowSpec,
  index: string,
  now: number,
  byId: Map<string, BuiltElement>,
  ): LinearElement {
  const from = spec.from ? byId.get(spec.from) : undefined;
  const to = spec.to ? byId.get(spec.to) : undefined;

  const start = from
    ? anchorPoint(from, to ?? { x: spec.x ?? from.x + 200, y: spec.y ?? from.y, width: 0, height: 0 })
    : { x: spec.x ?? 0, y: spec.y ?? 0 };
  const end = to
    ? anchorPoint(to, from ?? { x: start.x, y: start.y, width: 0, height: 0 })
    : { x: start.x + (spec.width ?? 160), y: start.y + (spec.height ?? 0) };

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    id: spec.id ?? randomId(),
    type: "arrow",
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    angle: 0,
    strokeColor: spec.strokeColor ?? "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 2 },
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,
    points: [
      [start.x - x, start.y - y],
      [end.x - x, end.y - y],
    ],
    lastCommittedPoint: null,
    startBinding: from ? { elementId: from.id, focus: 0, gap: BINDING_GAP } : null,
    endBinding: to ? { elementId: to.id, focus: 0, gap: BINDING_GAP } : null,
    startArrowhead: null,
    endArrowhead: "arrow",
    index,
  };
}

/** Record an arrow on the shape it binds to, bumping the shape's version. */
export function attachBinding(
  element: BuiltElement,
  arrowId: string,
  type: "arrow",
): BuiltElement {
  const current = (element.boundElements as { id: string; type: string }[] | null) ?? [];
  if (current.some((bound) => bound.id === arrowId)) return element;
  return bump({ ...element, boundElements: [...current, { id: arrowId, type }] });
}

/** Every local mutation must bump version and refresh versionNonce, or peers drop it. */
export function bump<T extends BuiltElement>(element: T): T {
  return { ...element, version: element.version + 1, versionNonce: randomInt(), updated: Date.now() };
}
