/**
 * Scene → PNG, through Excalidraw's own exporter.
 *
 * Excalidraw 0.18 lets `exportToSvg` run without a browser by taking a
 * `document`; the result is the same SVG the app would download, roughness and
 * all. `@resvg/resvg-wasm` then rasterises it, with a system font supplied so
 * labels are not blank.
 *
 * Both heavy dependencies are loaded lazily: a session that never asks for a
 * picture never pays for them.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { SceneElement } from "../scene/types.ts";
import { ensureDom } from "./dom.ts";

export interface SnapshotOptions {
  /** Pixel width of the PNG; the scene is scaled to fit. Default 1000. */
  maxWidth?: number;
  padding?: number;
  background?: string;
  /** Font file used for labels; defaults to a common system sans. */
  fontPath?: string;
}

export interface Snapshot {
  png: Uint8Array;
  width: number;
  height: number;
  svg: string;
  fontFamily: string | null;
}

const FONT_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Supplemental/Helvetica.ttf",
  "/System/Library/Fonts/Supplemental/Verdana.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "/Library/Fonts/Arial.ttf",
  "C:\\Windows\\Fonts\\arial.ttf",
];

function findFont(explicit?: string): { buffer: Uint8Array; family: string } | null {
  const candidates = explicit ? [explicit] : [process.env.EXCALIDRAW_SNAPSHOT_FONT, ...FONT_CANDIDATES];
  for (const path of candidates) {
    if (!path) continue;
    try {
      const buffer = readFileSync(path);
      const family = path.split(/[\\/]/).pop()?.replace(/\.(ttf|otf|ttc)$/i, "") ?? "sans-serif";
      return { buffer: new Uint8Array(buffer), family };
    } catch {
      // Try the next candidate; a missing font is not fatal, text just falls back.
    }
  }
  return null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function loadExcalidraw(): Promise<any> {
  const { createJiti } = (await import("jiti")) as any;
  // jiti resolves the package's extensionless imports (`roughjs/bin/rough`),
  // which plain Node ESM refuses.
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  return jiti.import("@excalidraw/excalidraw");
}

let resvgReady: Promise<typeof import("@resvg/resvg-wasm")> | null = null;

async function loadResvg(): Promise<typeof import("@resvg/resvg-wasm")> {
  resvgReady ??= (async () => {
    const resvg = await import("@resvg/resvg-wasm");
    const require = createRequire(import.meta.url);
    const wasm = readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm"));
    await resvg.initWasm(wasm);
    return resvg;
  })();
  return resvgReady;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Excalidraw cuts an arrow's line out from under its label with an SVG mask
 * whose content is in user space, relying on the spec default. Browsers agree;
 * resvg resolves the mask region in objectBoundingBox units and drops the whole
 * masked group, which erases the arrow (and sometimes the label with it). Naming
 * the units explicitly is the same drawing, understood by both.
 */
export function forRasterizer(svg: string): string {
  return svg.replace(/<mask(?![^>]*maskUnits=)/g, '<mask maskUnits="userSpaceOnUse"');
}

/** Everything that is not an element property Excalidraw would choke on. */
function toExportElement(element: SceneElement): Record<string, unknown> {
  const { customData, ...rest } = element as Record<string, unknown>;
  void customData;
  return rest;
}

export async function renderScene(
  elements: readonly SceneElement[],
  options: SnapshotOptions = {},
): Promise<Snapshot> {
  const visible = elements.filter((element) => !element.isDeleted);
  if (visible.length === 0) throw new Error("nothing to draw: the scene has no visible elements");

  ensureDom();
  const excalidraw = await loadExcalidraw();
  const background = options.background ?? "#ffffff";

  const svgElement = await excalidraw.exportToSvg({
    elements: visible.map(toExportElement),
    appState: { exportBackground: true, viewBackgroundColor: background },
    files: null,
    exportPadding: options.padding ?? 24,
  });

  const serializer = new (globalThis as unknown as {
    XMLSerializer: new () => { serializeToString(node: unknown): string };
  }).XMLSerializer();
  const svg = forRasterizer(serializer.serializeToString(svgElement));

  const font = findFont(options.fontPath);
  const resvg = await loadResvg();
  const image = new resvg.Resvg(svg, {
    fitTo: { mode: "width", value: options.maxWidth ?? 1000 },
    background,
    font: font
      ? { fontBuffers: [font.buffer], defaultFontFamily: font.family, sansSerifFamily: font.family }
      : { loadSystemFonts: true },
  }).render();

  return {
    png: image.asPng(),
    width: image.width,
    height: image.height,
    svg,
    fontFamily: font?.family ?? null,
  };
}
