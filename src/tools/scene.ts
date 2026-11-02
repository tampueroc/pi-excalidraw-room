import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RoomClient } from "../client/room-client.ts";
import { summarizeScene } from "../scene/describe.ts";
import { buildElements, type BuiltElement, type ElementSpec } from "../scene/elements.ts";
import { applyPatch, markDeleted, MutationError, translate } from "../scene/mutations.ts";

const NOT_IN_ROOM = "Not in a room. Call excalidraw_join with the collaboration link first.";

function requireRoom(client: RoomClient): string | null {
  return client.status().connected ? null : NOT_IN_ROOM;
}

function asSceneMap(client: RoomClient): Map<string, BuiltElement> {
  return client.sceneMap() as unknown as Map<string, BuiltElement>;
}

function dedupe(elements: BuiltElement[]): BuiltElement[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  return [...byId.values()];
}

function describeChanged(elements: BuiltElement[]): string {
  return elements
    .map((element) => {
      const text = typeof element.text === "string" && element.text.trim() ? ` ${JSON.stringify(element.text)}` : "";
      return `${element.type} ${element.id}${text}${element.isDeleted ? " (deleted)" : ""}`;
    })
    .join("\n");
}

export function registerSceneTools(pi: ExtensionAPI, client: RoomClient): void {
  pi.registerTool({
    name: "excalidraw_read",
    label: "Read Excalidraw Scene",
    description:
      "Read the collaboration room's current elements: type, id, label, position, size, plus scene bounds. Use it before editing so you keep what people drew.",
    promptSnippet: "Read the live Excalidraw scene: elements, labels, positions, bounds",
    promptGuidelines: [
      "Use excalidraw_read before excalidraw_update, excalidraw_delete or excalidraw_connect so element ids and positions come from the real scene.",
    ],
    parameters: Type.Object({
      ids: Type.Optional(
        Type.Array(Type.String(), { description: "Only these element ids (default: the whole scene)" }),
      ),
      includeDeleted: Type.Optional(
        Type.Boolean({ description: "Include elements marked deleted (default false)" }),
      ),
      limit: Type.Optional(Type.Number({ description: "Maximum elements to list (default 200)" })),
      full: Type.Optional(
        Type.Boolean({ description: "Also return raw element JSON in details (default false)" }),
      ),
    }),
    async execute(_toolCallId, params) {
      const blocked = requireRoom(client);
      if (blocked) {
        return { content: [{ type: "text", text: blocked }], details: { ok: false } as Record<string, unknown> };
      }

      const status = client.status();
      const all = client.elements(true);
      const ids = params.ids ?? [];
      const selected = ids.length ? all.filter((el) => ids.includes(el.id)) : all;
      const summary = summarizeScene(selected, params.limit ?? 200);
      const missing = ids.filter((id) => !all.some((el) => el.id === id));
      const header = [
        `room ${status.roomId}`,
        `${status.peers.length} peer(s)`,
        `scene source ${status.source ?? "unknown"}`,
      ].join(" · ");
      const missingLine = missing.length ? `\nunknown ids: ${missing.join(", ")}` : "";

      const details: Record<string, unknown> = {
        ok: true,
        roomId: status.roomId,
        elementCount: summary.elementCount,
        bounds: summary.bounds,
        missing,
      };
      if (params.full) details.elements = client.elements(params.includeDeleted ?? false);

      return {
        content: [{ type: "text", text: `${header}\n${summary.text}${missingLine}` }],
        details,
      };
    },
  });

  pi.registerTool({
    name: "excalidraw_add",
    label: "Add Excalidraw Elements",
    description:
      "Create elements in the live room: rectangles, ellipses, diamonds and text, each optionally labelled. They appear in the browser immediately.",
    promptSnippet: "Draw rectangles, ellipses, diamonds and text in the live Excalidraw room",
    promptGuidelines: [
      "Use excalidraw_add to create shapes in the room instead of describing them; pass text to label a shape.",
      "Use excalidraw_connect, not excalidraw_add, to draw arrows between existing elements.",
    ],
    parameters: Type.Object({
      elements: Type.Array(
        Type.Object({
          type: Type.Union([
            Type.Literal("rectangle"),
            Type.Literal("ellipse"),
            Type.Literal("diamond"),
            Type.Literal("text"),
          ]),
          x: Type.Number({ description: "Left edge in canvas coordinates" }),
          y: Type.Number({ description: "Top edge in canvas coordinates" }),
          width: Type.Optional(Type.Number()),
          height: Type.Optional(Type.Number()),
          text: Type.Optional(
            Type.String({ description: "Label: centred inside a shape, or the content of a text element" }),
          ),
          backgroundColor: Type.Optional(
            Type.String({ description: "CSS colour, e.g. #a5d8ff; default transparent" }),
          ),
          strokeColor: Type.Optional(Type.String()),
        }),
        { description: "Elements to create, in draw order" },
      ),
    }),
    async execute(_toolCallId, params) {
      const blocked = requireRoom(client);
      if (blocked) {
        return { content: [{ type: "text", text: blocked }], details: { ok: false } as Record<string, unknown> };
      }
      try {
        const { elements, touched } = buildElements(params.elements as ElementSpec[], {
          lastIndex: client.lastIndex(),
          existing: asSceneMap(client),
        });
        const changed = dedupe([...touched, ...elements]);
        await client.apply(changed);
        return {
          content: [
            {
              type: "text",
              text: `added ${elements.length} element(s):\n${describeChanged(elements)}`,
            },
          ],
          details: { ok: true, added: elements.map((el) => ({ id: el.id, type: el.type })) },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `add failed: ${(err as Error).message}` }],
          details: { ok: false } as Record<string, unknown>,
        };
      }
    },
  });

  pi.registerTool({
    name: "excalidraw_update",
    label: "Update Excalidraw Elements",
    description:
      "Change one element: move it, resize it, recolour it or replace its text. Labels and versions are kept consistent so the browser accepts the change.",
    promptSnippet: "Move, resize, recolour or relabel an element in the live room",
    parameters: Type.Object({
      id: Type.String({ description: "Element id, as reported by excalidraw_read" }),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
      width: Type.Optional(Type.Number()),
      height: Type.Optional(Type.Number()),
      text: Type.Optional(Type.String({ description: "New label or text content" })),
      backgroundColor: Type.Optional(Type.String()),
      strokeColor: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params) {
      const blocked = requireRoom(client);
      if (blocked) {
        return { content: [{ type: "text", text: blocked }], details: { ok: false } as Record<string, unknown> };
      }
      const { id, ...patch } = params;
      try {
        const changed = applyPatch(asSceneMap(client), id, patch);
        await client.apply(changed);
        return {
          content: [{ type: "text", text: `updated:\n${describeChanged(changed)}` }],
          details: { ok: true, changed: changed.map((el) => el.id) },
        };
      } catch (err) {
        const message = err instanceof MutationError ? err.message : (err as Error).message;
        return {
          content: [{ type: "text", text: `update failed: ${message}` }],
          details: { ok: false } as Record<string, unknown>,
        };
      }
    },
  });

  pi.registerTool({
    name: "excalidraw_delete",
    label: "Delete Excalidraw Elements",
    description:
      "Mark elements deleted in the live room. Text bound to a deleted shape goes with it, as in the browser.",
    promptSnippet: "Delete elements from the live Excalidraw room",
    parameters: Type.Object({
      ids: Type.Array(Type.String(), { description: "Element ids to delete" }),
    }),
    async execute(_toolCallId, params) {
      const blocked = requireRoom(client);
      if (blocked) {
        return { content: [{ type: "text", text: blocked }], details: { ok: false } as Record<string, unknown> };
      }
      try {
        const changed = markDeleted(asSceneMap(client), params.ids);
        await client.apply(changed);
        return {
          content: [{ type: "text", text: `deleted:\n${describeChanged(changed)}` }],
          details: { ok: true, changed: changed.map((el) => el.id) },
        };
      } catch (err) {
        const message = err instanceof MutationError ? err.message : (err as Error).message;
        return {
          content: [{ type: "text", text: `delete failed: ${message}` }],
          details: { ok: false } as Record<string, unknown>,
        };
      }
    },
  });

  pi.registerTool({
    name: "excalidraw_move",
    label: "Move Excalidraw Elements",
    description:
      "Move elements by a delta. Labels follow their shape and arrows bound to a moved element are re-anchored, so the diagram stays connected.",
    promptSnippet: "Move elements by dx/dy, keeping labels and bound arrows attached",
    parameters: Type.Object({
      ids: Type.Array(Type.String(), { description: "Element ids to move" }),
      dx: Type.Number({ description: "Horizontal delta in canvas units" }),
      dy: Type.Number({ description: "Vertical delta in canvas units" }),
    }),
    async execute(_toolCallId, params) {
      const blocked = requireRoom(client);
      if (blocked) {
        return { content: [{ type: "text", text: blocked }], details: { ok: false } as Record<string, unknown> };
      }
      try {
        const changed = translate(asSceneMap(client), params.ids, params.dx, params.dy);
        await client.apply(changed);
        return {
          content: [
            {
              type: "text",
              text: `moved ${changed.length} element(s) by ${params.dx},${params.dy}:\n${describeChanged(changed)}`,
            },
          ],
          details: { ok: true, changed: changed.map((el) => el.id) },
        };
      } catch (err) {
        const message = err instanceof MutationError ? err.message : (err as Error).message;
        return {
          content: [{ type: "text", text: `move failed: ${message}` }],
          details: { ok: false } as Record<string, unknown>,
        };
      }
    },
  });

  pi.registerTool({
    name: "excalidraw_snapshot",
    label: "Snapshot Excalidraw Scene",
    description:
      "Render the room's scene to a PNG and return it as an image, so you can see the diagram the way a person does: layout, spacing, overlaps, unlabelled shapes.",
    promptSnippet: "Render the live scene to a PNG image you can look at",
    promptGuidelines: [
      "Use excalidraw_snapshot when the answer depends on how the diagram looks rather than on its topology, and after a batch of edits to check the result.",
    ],
    parameters: Type.Object({
      maxWidth: Type.Optional(Type.Number({ description: "PNG width in pixels (default 1000)" })),
      padding: Type.Optional(Type.Number({ description: "Margin around the scene (default 24)" })),
      background: Type.Optional(Type.String({ description: "CSS background colour (default #ffffff)" })),
    }),
    async execute(_toolCallId, params) {
      const blocked = requireRoom(client);
      if (blocked) {
        return { content: [{ type: "text", text: blocked }], details: { ok: false } as Record<string, unknown> };
      }
      try {
        const { renderScene } = await import("../view/snapshot.ts");
        const snapshot = await renderScene(client.elements(), {
          maxWidth: params.maxWidth,
          padding: params.padding,
          background: params.background,
        });
        const kb = Math.round(snapshot.png.byteLength / 1024);
        return {
          content: [
            {
              type: "text",
              text: `rendered ${client.elements().length} element(s) to a ${snapshot.width}×${snapshot.height} PNG (${kb} KB, labels drawn with ${snapshot.fontFamily ?? "a fallback font"})`,
            },
            {
              type: "image",
              data: Buffer.from(snapshot.png).toString("base64"),
              mimeType: "image/png",
            },
          ],
          details: {
            ok: true,
            width: snapshot.width,
            height: snapshot.height,
            bytes: snapshot.png.byteLength,
          },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `snapshot failed: ${(err as Error).message}` }],
          details: { ok: false } as Record<string, unknown>,
        };
      }
    },
  });

  pi.registerTool({
    name: "excalidraw_connect",
    label: "Connect Excalidraw Elements",
    description:
      "Draw an arrow between two elements and bind both ends, so the arrow follows the shapes when they move.",
    promptSnippet: "Draw a bound arrow between two elements in the live room",
    parameters: Type.Object({
      from: Type.String({ description: "Element id the arrow starts at" }),
      to: Type.String({ description: "Element id the arrow points at" }),
    }),
    async execute(_toolCallId, params) {
      const blocked = requireRoom(client);
      if (blocked) {
        return { content: [{ type: "text", text: blocked }], details: { ok: false } as Record<string, unknown> };
      }
      const scene = asSceneMap(client);
      if (!scene.get(params.from) || !scene.get(params.to)) {
        const missing = [params.from, params.to].filter((id) => !scene.get(id));
        return {
          content: [{ type: "text", text: `no such element(s): ${missing.join(", ")}` }],
          details: { ok: false } as Record<string, unknown>,
        };
      }
      try {
        const { elements, touched } = buildElements(
          [{ type: "arrow", from: params.from, to: params.to }],
          { lastIndex: client.lastIndex(), existing: scene },
        );
        const changed = dedupe([...touched, ...elements]);
        await client.apply(changed);
        const arrow = elements.find((el) => el.type === "arrow");
        return {
          content: [
            {
              type: "text",
              text: `connected ${params.from} → ${params.to} with arrow ${arrow?.id ?? "?"}`,
            },
          ],
          details: { ok: true, arrowId: arrow?.id, changed: changed.map((el) => el.id) },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `connect failed: ${(err as Error).message}` }],
          details: { ok: false } as Record<string, unknown>,
        };
      }
    },
  });
}
