/**
 * A minimal browser environment for Excalidraw's exporter.
 *
 * `exportToSvg` accepts `config.environment.document`, so it can run outside a
 * browser — but the module itself still reaches for canvas text metrics and the
 * CSS font loading API. Those two are stubbed just far enough for export: the
 * shapes, arrows and roughness come from Excalidraw itself, only glyph advance
 * widths are approximated here.
 *
 * Installing these globals is deliberately opt-in and happens the first time a
 * snapshot is requested, so a Pi session pays nothing until it wants a picture.
 */
import { JSDOM } from "jsdom";

let installed = false;

function stubCanvasContext(): void {
  // Excalidraw measures text with a canvas 2d context; jsdom has no canvas.
  const proto = (globalThis as unknown as {
    HTMLCanvasElement?: { prototype: Record<string, unknown> };
  }).HTMLCanvasElement?.prototype;
  if (!proto) return;
  proto.getContext = () => ({
    font: "20px sans-serif",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    measureText: (text: string) => ({
      width: String(text).length * 11,
      actualBoundingBoxAscent: 15,
      actualBoundingBoxDescent: 4,
    }),
    save() {},
    restore() {},
    scale() {},
    translate() {},
    rotate() {},
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    rect() {},
    fill() {},
    stroke() {},
    fillText() {},
    strokeText() {},
    drawImage() {},
    setTransform() {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData() {},
    createLinearGradient: () => ({ addColorStop() {} }),
  });
}

export function ensureDom(): void {
  if (installed) return;
  installed = true;

  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const window = dom.window as unknown as Record<string, unknown>;
  const global = globalThis as unknown as Record<string, unknown>;

  global.window = window;
  global.document = window.document;
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

  for (const key of [
    "HTMLElement",
    "HTMLCanvasElement",
    "Image",
    "XMLSerializer",
    "Node",
    "Element",
    "SVGElement",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "MutationObserver",
    "Blob",
    "FileReader",
    "DOMParser",
    "Text",
    "CustomEvent",
    "Event",
    "localStorage",
    "ResizeObserver",
  ]) {
    if (window[key] && !global[key]) global[key] = window[key];
  }

  global.devicePixelRatio = 1;
  global.matchMedia = () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  });
  if (!global.ResizeObserver) {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  // Excalidraw preloads its fonts through the CSS Font Loading API during export.
  // Excalidraw reads these off the face when it inlines @font-face rules into
  // the exported SVG; the values only need to be well-formed, since the raster
  // step supplies its own font.
  global.FontFace = class {
    family: string;
    status = "loaded";
    style = "normal";
    weight = "400";
    stretch = "normal";
    unicodeRange = "U+0000-10FFFF";
    featureSettings = "normal";
    variationSettings = "normal";
    display = "swap";
    ascentOverride = "normal";
    descentOverride = "normal";
    lineGapOverride = "normal";
    constructor(family: string) {
      this.family = family;
    }
    load(): Promise<unknown> {
      return Promise.resolve(this);
    }
  };
  const fontSet = {
    add() {},
    delete() {},
    has: () => true,
    check: () => true,
    ready: Promise.resolve(),
    forEach() {},
    values: () => [],
    [Symbol.iterator]: function* () {},
  };
  Object.defineProperty((window.document as unknown as Record<string, unknown>), "fonts", {
    value: fontSet,
    configurable: true,
  });

  stubCanvasContext();
}
