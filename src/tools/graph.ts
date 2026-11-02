import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RoomClient } from "../client/room-client.ts";
import { buildElements, measureText, type BuiltElement } from "../scene/elements.ts";
import { layeredLayout } from "../scene/layout.ts";
import { markDeleted } from "../scene/mutations.ts";

const NOT_IN_ROOM = "Not in a room. Call excalidraw_join with the collaboration link first.";

function requireRoom(client: RoomClient): string | null {
  return client.status().connected ? null : NOT_IN_ROOM;
}

function dedupe(elements: BuiltElement[]): BuiltElement[] {
  return [...new Map(elements.map((element) => [element.id, element])).values()];
}

type Shape = "rectangle" | "ellipse" | "diamond";
interface GraphNode {
  id?: string;
  label: string;
  shape?: Shape;
  backgroundColor?: string;
}
interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

/** Nodes may be named by their id or by their label, whichever is easier to write. */
function resolver(nodes: readonly GraphNode[]): (key: string) => string | null {
  const byKey = new Map<string, string>();
  nodes.forEach((node, index) => {
    const key = node.id ?? `n${index}`;
    byKey.set(key, key);
    byKey.set(node.label, key);
  });
  return (key) => byKey.get(key) ?? null;
}

export function registerGraphTools(pi: ExtensionAPI, client: RoomClient): void {
  pi.registerTool({
    name: "excalidraw_draw_graph",
    label: "Draw Architecture Graph",
    description:
      "Draw a diagram from nodes and edges: the layout is computed, so you describe the topology instead of inventing coordinates. Shapes are labelled, arrows bound and labelled.",
    promptSnippet: "Draw a labelled diagram from a node/edge list, with automatic layout",
    promptGuidelines: [
      "Use excalidraw_draw_graph instead of excalidraw_add when drawing a diagram with more than two connected boxes; pass nodes and edges, not coordinates.",
    ],
    parameters: Type.Object({
      nodes: Type.Array(
        Type.Object({
          id: Type.Optional(Type.String({ description: "Key used by edges; defaults to n<index>" })),
          label: Type.String({ description: "Text shown in the box; edges may also refer to this" }),
          shape: Type.Optional(
            Type.Union([Type.Literal("rectangle"), Type.Literal("ellipse"), Type.Literal("diamond")]),
          ),
          backgroundColor: Type.Optional(Type.String()),
        }),
        { description: "Boxes, in reading order (siblings are laid out in this order)" },
      ),
      edges: Type.Optional(
        Type.Array(
          Type.Object({
            from: Type.String({ description: "Node id or label" }),
            to: Type.String({ description: "Node id or label" }),
            label: Type.Optional(Type.String({ description: "Text drawn on the arrow" })),
          }),
        ),
      ),
      direction: Type.Optional(
        Type.Union([Type.Literal("right"), Type.Literal("down")], {
          description: "Layering direction (default right)",
        }),
      ),
      origin: Type.Optional(
        Type.Object({
          x: Type.Optional(Type.Number()),
          y: Type.Optional(Type.Number()),
        }),
      ),
      layerGap: Type.Optional(Type.Number({ description: "Space between layers (default 120)" })),
      nodeGap: Type.Optional(Type.Number({ description: "Space between siblings (default 40)" })),
      replace: Type.Optional(
        Type.Boolean({ description: "Delete the current scene before drawing (default false)" }),
      ),
    }),
    async execute(_toolCallId, params) {
      const blocked = requireRoom(client);
      if (blocked) {
        return { content: [{ type: "text", text: blocked }], details: { ok: false } as Record<string, unknown> };
      }

      const nodes = params.nodes as GraphNode[];
      const edges = (params.edges ?? []) as GraphEdge[];
      const keyed = nodes.map((node, index) => ({ ...node, key: node.id ?? `n${index}` }));
      const resolve = resolver(nodes);

      const unknown = edges.filter((edge) => !resolve(edge.from) || !resolve(edge.to));
      if (unknown.length) {
        return {
          content: [
            {
              type: "text",
              text: `unknown edge endpoint(s): ${unknown.map((e) => `${e.from}→${e.to}`).join(", ")}. Node keys are: ${keyed.map((n) => n.key).join(", ")}`,
            },
          ],
          details: { ok: false } as Record<string, unknown>,
        };
      }

      try {
        if (params.replace) {
          const visible = client.elements().map((element) => element.id);
          if (visible.length) await client.apply(markDeleted(client.sceneMap() as never, visible));
        }

        // Boxes are sized from their label so text never overflows.
        const sized = keyed.map((node) => {
          const text = measureText(node.label);
          return {
            ...node,
            width: Math.max(160, text.width + 48),
            height: Math.max(80, text.height + 32),
          };
        });

        const layout = layeredLayout(
          sized.map((node) => ({ id: node.key, width: node.width, height: node.height })),
          edges.map((edge) => ({ from: resolve(edge.from)!, to: resolve(edge.to)! })),
          {
            x: params.origin?.x ?? 0,
            y: params.origin?.y ?? 0,
            direction: params.direction ?? "right",
            layerGap: params.layerGap,
            nodeGap: params.nodeGap,
          },
        );

        const shapes = buildElements(
          sized.map((node) => {
            const position = layout.positions.get(node.key)!;
            return {
              type: node.shape ?? ("rectangle" as Shape),
              x: position.x,
              y: position.y,
              width: node.width,
              height: node.height,
              text: node.label,
              backgroundColor: node.backgroundColor,
              id: node.key,
            };
          }),
          { lastIndex: client.lastIndex() },
        );

        const scene = new Map<string, BuiltElement>([
          ...(client.sceneMap() as unknown as Map<string, BuiltElement>),
          ...shapes.elements.map((element) => [element.id, element] as const),
        ]);
        const arrows = buildElements(
          edges.map((edge) => ({
            type: "arrow" as const,
            from: resolve(edge.from)!,
            to: resolve(edge.to)!,
            text: edge.label,
          })),
          { lastIndex: shapes.elements.at(-1)?.index ?? client.lastIndex(), existing: scene },
        );

        await client.apply(dedupe([...shapes.touched, ...shapes.elements, ...arrows.touched, ...arrows.elements]));

        const lines = [
          `drew ${sized.length} node(s) and ${edges.length} edge(s) in ${layout.layers.length} layer(s)`,
          ...layout.layers.map((layer, index) => `layer ${index}: ${layer.join(", ")}`),
        ];
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: {
            ok: true,
            nodeIds: sized.map((node) => node.key),
            arrowIds: arrows.elements.filter((el) => el.type === "arrow").map((el) => el.id),
            layers: layout.layers,
          },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `draw failed: ${(err as Error).message}` }],
          details: { ok: false } as Record<string, unknown>,
        };
      }
    },
  });

  pi.registerTool({
    name: "excalidraw_frame",
    label: "Frame Excalidraw Elements",
    description:
      "Put a named frame around elements (or at explicit geometry). Frames are how a diagram shows layers or boundaries, and children move with the frame.",
    promptSnippet: "Wrap elements in a named frame to show a layer or boundary",
    parameters: Type.Object({
      name: Type.String({ description: "Frame title, e.g. Services" }),
      elementIds: Type.Optional(
        Type.Array(Type.String(), { description: "Elements to frame; bounds are computed from them" }),
      ),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
      width: Type.Optional(Type.Number()),
      height: Type.Optional(Type.Number()),
      padding: Type.Optional(Type.Number({ description: "Margin around the framed elements (default 32)" })),
    }),
    async execute(_toolCallId, params) {
      const blocked = requireRoom(client);
      if (blocked) {
        return { content: [{ type: "text", text: blocked }], details: { ok: false } as Record<string, unknown> };
      }

      const children = params.elementIds ?? [];
      const members = children.map((id) => client.element(id)).filter((element) => element !== undefined);
      const missing = children.filter((id) => !client.element(id));
      if (children.length && members.length === 0) {
        return {
          content: [{ type: "text", text: `none of these ids are in the scene: ${children.join(", ")}` }],
          details: { ok: false } as Record<string, unknown>,
        };
      }

      const padding = params.padding ?? 32;
      const geometry =
        members.length > 0
          ? {
              x: Math.min(...members.map((el) => el.x)) - padding,
              y: Math.min(...members.map((el) => el.y)) - padding - 24,
              width: Math.max(...members.map((el) => el.x + el.width)) - Math.min(...members.map((el) => el.x)) + padding * 2,
              height: Math.max(...members.map((el) => el.y + el.height)) - Math.min(...members.map((el) => el.y)) + padding * 2 + 24,
            }
          : { x: params.x ?? 0, y: params.y ?? 0, width: params.width ?? 400, height: params.height ?? 200 };

      try {
        const { elements, touched } = buildElements(
          [{ type: "frame", name: params.name, ...geometry, children }],
          {
            lastIndex: client.lastIndex(),
            existing: client.sceneMap() as unknown as Map<string, BuiltElement>,
          },
        );
        await client.apply(dedupe([...touched, ...elements]));
        const frame = elements[0]!;
        const note = missing.length ? `\nignored unknown id(s): ${missing.join(", ")}` : "";
        return {
          content: [
            {
              type: "text",
              text: `framed ${touched.length} element(s) as ${JSON.stringify(params.name)} (frame ${frame.id})${note}`,
            },
          ],
          details: { ok: true, frameId: frame.id, children: touched.map((el) => el.id) },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `frame failed: ${(err as Error).message}` }],
          details: { ok: false } as Record<string, unknown>,
        };
      }
    },
  });
}

