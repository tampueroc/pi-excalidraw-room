/**
 * Layered layout for generated diagrams.
 *
 * An agent that invents coordinates produces diagrams that look placed by
 * accident: overlapping boxes, arrows crossing at random angles. This assigns
 * each node a layer by longest path from the roots, then lays the layers out as
 * columns (or rows), centring each one. Cycles are tolerated — a node that
 * never settles keeps the rank it reached when the relaxation budget ran out.
 */

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface LayoutOptions {
  /** Top-left of the whole diagram. */
  x?: number;
  y?: number;
  /** Gap between columns (direction "right") or rows (direction "down"). */
  layerGap?: number;
  /** Gap between siblings within a layer. */
  nodeGap?: number;
  direction?: "right" | "down";
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
  /** Node ids grouped by layer, in the order they were placed. */
  layers: string[][];
  width: number;
  height: number;
}

export function layeredLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: LayoutOptions = {},
): LayoutResult {
  const direction = options.direction ?? "right";
  const layerGap = options.layerGap ?? 120;
  const nodeGap = options.nodeGap ?? 40;
  const originX = options.x ?? 0;
  const originY = options.y ?? 0;

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const rank = new Map<string, number>(nodes.map((node) => [node.id, 0]));

  // Longest-path ranking, bounded so a cycle cannot spin forever.
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const edge of edges) {
      if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
      const candidate = (rank.get(edge.from) ?? 0) + 1;
      if (candidate > (rank.get(edge.to) ?? 0)) {
        rank.set(edge.to, candidate);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const layers: string[][] = [];
  for (const node of nodes) {
    const index = rank.get(node.id) ?? 0;
    (layers[index] ??= []).push(node.id);
  }

  // A gap in the ranking (possible with cycles) becomes an empty layer; drop it.
  const filled = layers.filter((layer) => layer.length > 0);
  const positions = new Map<string, { x: number; y: number }>();

  // Cross-axis size of each layer, so it can be centred.
  const spans = filled.map((layer) => {
    const sizes = layer.map((id) => {
      const node = byId.get(id)!;
      return direction === "right" ? node.height : node.width;
    });
    return sizes.reduce((sum, size) => sum + size, 0) + nodeGap * (layer.length - 1);
  });
  const longest = Math.max(0, ...spans);

  let cursor = direction === "right" ? originX : originY;
  for (const [layerIndex, layer] of filled.entries()) {
    const span = spans[layerIndex]!;
    let across = (direction === "right" ? originY : originX) + Math.round((longest - span) / 2);
    let depth = 0;

    for (const id of layer) {
      const node = byId.get(id)!;
      if (direction === "right") {
        positions.set(id, { x: cursor, y: across });
        across += node.height + nodeGap;
        depth = Math.max(depth, node.width);
      } else {
        positions.set(id, { x: across, y: cursor });
        across += node.width + nodeGap;
        depth = Math.max(depth, node.height);
      }
    }

    cursor += depth + layerGap;
  }

  const width = direction === "right" ? cursor - originX - layerGap : longest;
  const height = direction === "right" ? longest : cursor - originY - layerGap;
  return {
    positions,
    layers: filled,
    width: Math.max(width, 0),
    height: Math.max(height, 0),
  };
}
