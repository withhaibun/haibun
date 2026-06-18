/**
 * Project a quad set into a renderer-agnostic `TGraph` for the overview: one node per (namedGraph, subject) grouped
 * by namedGraph, a collapsed "summary" node when a graph exceeds the per-group cap, external reference nodes for URI
 * targets outside the set, and edges resolved by the property classifier (drawn by declared range, not guessed). Node
 * titles come from the server-computed display labels; the full per-node detail rides the `hint` (hover) field. Returns
 * the `TGraph` plus a `nodeMap` (node id → {graph, subject}) the view uses to route clicks.
 */
import { LinkRelations } from "@haibun/core/lib/resources.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { colorForType } from "../type-colors.js";
import { STORED_TYPE_PROP } from "../consts.js";
import { formatDate } from "../util.js";
import { isReplyEdge } from "@haibun/core/lib/resources.js";
import { type PropertyClassifier, type TGraphViewOpts, isUri } from "../graph-classifier.js";
import type { TGraph, TGraphNode, TGraphEdge, TGraphGroup, TGraphStyle } from "./types.js";

export type GraphTopology = { graph: TGraph; nodeMap: Map<string, { graph: string; subject: string }> };

const TEMPORAL_RELS = new Set<string>([LinkRelations.GENERATED_AT_TIME.rel, LinkRelations.PUBLISHED.rel, LinkRelations.UPDATED.rel, LinkRelations.VALID_FROM.rel]);
const SUPPRESSED_PROP_RELS = new Set<string>([LinkRelations.MEDIA_TYPE.rel]);
// A delimiter/sentinel that never occurs in a type name or a subject and is valid inside an SVG attribute (unlike NUL,
// which is illegal in XML and would be mangled when the id round-trips through `data-node-id`). U+241F = ␟.
const NODE_DELIM = "\u241f";
const SUMMARY_SUFFIX = `${NODE_DELIM}summary`;
const REF_PREFIX = `ref${NODE_DELIM}`;

const isOpaqueId = (s: string): boolean => /^urn:uuid:/.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(s);
export const isSummaryId = (id: string): boolean => id.endsWith(SUMMARY_SUFFIX);
export const summaryGraphOf = (id: string): string => id.slice(0, -SUMMARY_SUFFIX.length);

/** Edge kind by reply/context/attachment role, mapped to the SVG paint's edge styles (reply bold, context dashed). */
function edgeKind(predicate: string, rel: string | undefined): TGraphEdge["kind"] {
	if (rel === LinkRelations.IN_REPLY_TO.rel || isReplyEdge(predicate)) return "reply";
	if (rel === LinkRelations.CONTEXT.rel || rel === LinkRelations.ATTACHMENT.rel) return "context";
	return undefined;
}

/** Title (single-line node label) + hint (full detail, hover tooltip): server label, then content/id/author/date/scalars. */
function nodeTitleAndHint(graph: string, subject: string, subjectQuads: TQuad[], opts: TGraphViewOpts, classifier: PropertyClassifier): { title: string; hint: string } {
	const kind = (q: TQuad) => classifier.classify(graph, q.predicate);
	const nameQuad = subjectQuads.find((q) => kind(q) === "name");
	const contentQuad = subjectQuads.find((q) => kind(q) === "content");
	const idQuad = subjectQuads.find((q) => kind(q) === "identifier");
	const title = opts.displayLabel(graph, subject) ?? subject;
	const lines = [String(title)];
	const seen = new Set([String(title).trim()]);
	const add = (s: string): void => {
		const v = s.trim();
		if (v && !seen.has(v)) {
			seen.add(v);
			lines.push(v);
		}
	};
	if (contentQuad) add(String(contentQuad.object));
	if (idQuad) {
		const v = String(idQuad.object);
		if (v !== String(title) && !isOpaqueId(v)) add(v);
	}
	const authorQuad = subjectQuads.find((q) => typeof q.object === "string" && classifier.rel?.(graph, q.predicate) === LinkRelations.ATTRIBUTED_TO.rel);
	if (authorQuad) add(`by ${opts.displayLabel(String(authorQuad.objectType ?? ""), String(authorQuad.object)) ?? String(authorQuad.object)}`);
	const dateQuad = subjectQuads.find((q) => {
		const r = classifier.rel?.(graph, q.predicate);
		return r !== undefined && TEMPORAL_RELS.has(r);
	});
	if (dateQuad) add(formatDate(String(dateQuad.object)));
	for (const q of subjectQuads) {
		if (kind(q) !== "scalar" || q === nameQuad || q === contentQuad || q === idQuad || q === authorQuad || q === dateQuad) continue;
		if (q.predicate.startsWith("@") || q.predicate.startsWith("_") || q.predicate === STORED_TYPE_PROP) continue;
		const r = classifier.rel?.(graph, q.predicate);
		if (r !== undefined && (TEMPORAL_RELS.has(r) || SUPPRESSED_PROP_RELS.has(r))) continue;
		add(`${q.predicate}: ${String(q.object)}`);
	}
	return { title: String(title), hint: lines.join("\n") };
}

export function buildGraphTopology(quads: TQuad[], opts: TGraphViewOpts, classifier: PropertyClassifier): GraphTopology {
	const { layout, hiddenGraphs, expandedGraphs, maxPerSubgraph } = opts;
	const visible = quads.filter((q) => !hiddenGraphs.has(q.namedGraph));
	const entityIds = new Set(visible.map((q) => q.subject));

	const externalIds = new Set<string>();
	for (const q of visible) {
		if (typeof q.object === "string" && classifier.classify(q.namedGraph, q.predicate) === "edge" && !entityIds.has(q.object) && q.object !== q.subject && isUri(q.object))
			externalIds.add(q.object);
	}

	const byGraph = new Map<string, Map<string, TQuad[]>>();
	for (const q of visible) {
		const g = byGraph.get(q.namedGraph) ?? new Map<string, TQuad[]>();
		if (!byGraph.has(q.namedGraph)) byGraph.set(q.namedGraph, g);
		const sq = g.get(q.subject) ?? [];
		if (!g.has(q.subject)) g.set(q.subject, sq);
		sq.push(q);
	}

	const nodes: TGraphNode[] = [];
	const groups: Record<string, TGraphGroup> = {};
	const styles: Record<string, TGraphStyle> = {};
	const nodeMap = new Map<string, { graph: string; subject: string }>();
	const nodeIds = new Set<string>();

	const resolveTarget = (q: TQuad, subject: string): string | null => {
		if (classifier.classify(q.namedGraph, q.predicate) !== "edge" || typeof q.object !== "string") return null;
		const obj = q.object;
		if (obj === subject) return null;
		if (externalIds.has(obj)) return `${REF_PREFIX}${obj}`;
		if (!entityIds.has(obj)) return null;
		if (typeof q.objectType !== "string" || q.objectType.length === 0 || hiddenGraphs.has(q.objectType)) return null;
		const targetSubjects = byGraph.get(q.objectType);
		if (!targetSubjects?.has(obj)) return null;
		const collapsed = !expandedGraphs.has(q.objectType) && targetSubjects.size > maxPerSubgraph;
		return collapsed ? `${q.objectType}${SUMMARY_SUFFIX}` : `${q.objectType}${NODE_DELIM}${obj}`;
	};

	const tally = new Map<string, { from: string; to: string; predicate: string; rel: string; kind: TGraphEdge["kind"]; count: number }>();
	const addEdge = (from: string, graph: string, q: TQuad, to: string): void => {
		const rel = classifier.relForEdge?.(graph, q.predicate) ?? q.predicate;
		if (opts.hiddenRels?.has(rel)) return;
		const key = `${from}|${to}|${q.predicate}`;
		const t = tally.get(key);
		if (t) t.count++;
		else tally.set(key, { from, to, predicate: q.predicate, rel, kind: edgeKind(q.predicate, rel), count: 1 });
	};

	for (const [graph, subjects] of byGraph) {
		const total = subjects.size;
		groups[graph] = { label: `${graph} (${total})` };
		styles[graph] = { fill: colorForType(graph), stroke: "#cccccc" };
		const collapsed = !expandedGraphs.has(graph) && total > maxPerSubgraph;
		if (collapsed) {
			const id = `${graph}${SUMMARY_SUFFIX}`;
			nodeIds.add(id);
			nodes.push({ id, label: graph, hint: `${total} items — click to expand`, kind: graph, group: graph });
			for (const [subject, sq] of subjects)
				for (const q of sq) {
					const to = resolveTarget(q, subject);
					if (to) addEdge(id, graph, q, to);
				}
			continue;
		}
		for (const [subject, sq] of subjects) {
			const id = `${graph}${NODE_DELIM}${subject}`;
			nodeIds.add(id);
			nodeMap.set(id, { graph, subject });
			const { title, hint } = nodeTitleAndHint(graph, subject, sq, opts, classifier);
			nodes.push({ id, label: title, hint, kind: graph, group: graph });
			for (const q of sq) {
				const to = resolveTarget(q, subject);
				if (to) addEdge(id, graph, q, to);
			}
		}
	}

	for (const uri of externalIds) {
		const id = `${REF_PREFIX}${uri}`;
		nodeIds.add(id);
		nodeMap.set(id, { graph: "resource", subject: uri });
		nodes.push({ id, label: uri, kind: "resource" });
	}

	const edges: TGraphEdge[] = [];
	for (const t of tally.values()) {
		if (!nodeIds.has(t.from) || !nodeIds.has(t.to)) continue;
		edges.push({ from: t.from, to: t.to, label: t.count > 1 ? `${t.predicate} ×${t.count}` : t.predicate, kind: t.kind, rel: t.rel });
	}

	const graph: TGraph = { nodes, edges, direction: layout === "TD" ? "TB" : "LR", groups, styles };
	return { graph, nodeMap };
}
