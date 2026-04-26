import type { TQuad } from "@haibun/core/lib/quad-types.js";

export type GraphNode = { id: string; type: string };
export type GraphEdge = { from: string; to: string; predicate: string; graph: string };
export type GraphModel = { nodes: GraphNode[]; edges: GraphEdge[] };

type BuildGraphModelOptions = {
  ignoreInternalPredicates?: boolean;
  requireObjectSubject?: boolean;
};

const DEFAULT_OPTIONS: Required<BuildGraphModelOptions> = {
  ignoreInternalPredicates: true,
  requireObjectSubject: true,
};

/** Build a normalized graph model from quads for graph visualizers. */
export function buildGraphModelFromQuads(quads: TQuad[], options: BuildGraphModelOptions = {}): GraphModel {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const nodeMap = new Map<string, GraphNode>();
  for (const q of quads) {
    if (typeof q.subject !== "string" || q.subject.length === 0) continue;
    if (!nodeMap.has(q.subject)) nodeMap.set(q.subject, { id: q.subject, type: q.namedGraph });
  }

  const edges: GraphEdge[] = [];
  for (const q of quads) {
    if (typeof q.subject !== "string" || typeof q.object !== "string") continue;
    if (q.subject === q.object) continue;
    if (opts.ignoreInternalPredicates && q.predicate.startsWith("_")) continue;
    if (!nodeMap.has(q.subject)) continue;
    if (opts.requireObjectSubject && !nodeMap.has(q.object)) continue;
    edges.push({ from: q.subject, to: q.object, predicate: q.predicate, graph: q.namedGraph });
  }

  const dedup = new Map<string, GraphEdge>();
  for (const e of edges) dedup.set(`${e.graph}|${e.from}|${e.predicate}|${e.to}`, e);
  return { nodes: Array.from(nodeMap.values()), edges: Array.from(dedup.values()) };
}
