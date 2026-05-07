/**
 * Shared mermaid graph renderer — converts quads to mermaid source text.
 *
 * Used by both the browser-side <shu-graph-view> component and the server-side
 * exportMermaid stepper step. Environment-specific property classification is
 * injected via the PropertyClassifier interface.
 */
import { LinkRelations, edgeRel as coreEdgeRel, getRelRange, isReplyEdge } from "@haibun/core/lib/resources.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { colorForType } from "./type-colors.js";

export type TPropKind = "name" | "identifier" | "edge" | "content" | "internal" | "scalar";

/** Permissive classifier for thread/product views — treats all non-internal predicates as edges except "name". */
export const THREAD_CLASSIFIER: PropertyClassifier = {
	classify: (_graph, predicate) => {
		if (predicate.startsWith("_")) return "internal";
		if (predicate === "name") return "name";
		return "edge";
	},
};

/** Dependency-injected property classification — browser uses rels-cache, server uses world.domains. */
export interface PropertyClassifier {
	classify(graph: string, predicate: string): TPropKind;
	/** Return the link relation for an edge predicate (e.g., "attributedTo", "inReplyTo"). */
	relForEdge?(graph: string, predicate: string): string | undefined;
	stepperForType?(vertexLabel: string): string | undefined;
}

export type TGraphViewOpts = { layout: "TD" | "LR"; hiddenGraphs: Set<string>; expandedGraphs: Set<string>; maxPerSubgraph: number; hiddenRels?: Set<string> };
export type TBuildResult = { source: string; nodeMap: Map<string, { graph: string; subject: string }> };

export const DEFAULT_MAX_PER_SUBGRAPH = 20;

/** Properties that are opaque blobs or graph-store internals — excluded from graph rendering. */
export const INTERNAL_PREDICATES = new Set(["signedDocument", "encodedList", "proofValue", "accessLevel", "vertexLabel"]);

/** URL is the only literal-ranged rel rendered as an edge (URI-string targets are conventionally navigable). */
const isLiteralEdgeRel = (rel: string): boolean => rel === LinkRelations.URL.rel;

/** Mermaid arrow style per edge predicate and its resolved rel.
 * ===> thick: reply chain (IN_REPLY_TO and all sub-properties — narrate, grant, inReplyTo, etc.)
 * ---> normal: actors (ATTRIBUTED_TO — controller, delegator, issuer)
 * -.-> dotted: supporting detail (CONTEXT, ATTACHMENT — proof, status, assertionMethod) */
function arrowForEdge(predicate: string, rel: string | undefined): string {
	if (rel === LinkRelations.IN_REPLY_TO.rel || isReplyEdge(predicate)) return "==>";
	if (rel === LinkRelations.CONTEXT.rel || rel === LinkRelations.ATTACHMENT.rel) return "-.->";
	return "-->";
}

/** Escape mermaid special chars in labels. */
export function esc(s: string): string {
	return String(s)
		.replace(/"/g, "#quot;")
		.replace(/[[\](){}|<>]/g, " ");
}

export function sanitizeId(s: string): string {
	return s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
}

export function truncate(s: string, max = 30): string {
	const str = esc(String(s));
	return str.length > max ? `${str.slice(0, max)}...` : str;
}

/** Check if a string looks like a URI or resolvable path. */
export function isUri(s: string): boolean {
	return /^(did:|urn:|https?:\/\/|\/)/.test(s);
}

/** Build a mermaid graph source from quads using the given property classifier. */
export function buildMermaidSource(quads: TQuad[], opts: TGraphViewOpts, classifier: PropertyClassifier): TBuildResult {
	const { layout, hiddenGraphs, expandedGraphs, maxPerSubgraph } = opts;
	const visible = quads.filter((q) => !hiddenGraphs.has(q.namedGraph));
	const entityIds = new Set(visible.map((q) => q.subject));

	// Collect external URI references (edge targets not in our entity set)
	const externalIds = new Set<string>();
	for (const q of visible) {
		if (typeof q.object === "string" && classifier.classify(q.namedGraph, q.predicate) === "edge" && !entityIds.has(q.object) && q.object !== q.subject && isUri(q.object)) {
			externalIds.add(q.object);
		}
	}

	// Group quads by named graph, then by subject
	const byGraph = new Map<string, Map<string, TQuad[]>>();
	for (const q of visible) {
		let graphMap = byGraph.get(q.namedGraph);
		if (!graphMap) {
			graphMap = new Map();
			byGraph.set(q.namedGraph, graphMap);
		}
		let subjectQuads = graphMap.get(q.subject);
		if (!subjectQuads) {
			subjectQuads = [];
			graphMap.set(q.subject, subjectQuads);
		}
		subjectQuads.push(q);
	}

	// Mermaid's `TD` / `LR` keywords don't match the visual orientation users
	// expect from this view's layout button: when the user toggles to "TD" they
	// want a top-down-looking diagram, but mermaid renders `graph TD` with
	// subgraphs side-by-side (visually horizontal). Swap the keywords so the
	// button label matches what the user sees.
	const mermaidDir = layout === "TD" ? "LR" : "TD";
	const lines: string[] = [`graph ${mermaidDir}`];
	const nodeIds = new Set<string>();
	const nodeMap = new Map<string, { graph: string; subject: string }>();
	const edges: string[] = [];
	/** Coalesces edges that collapse to the same target summary node into a single line with a count badge. */
	const collapsedEdgeTally = new Map<string, { idx: number; count: number; from: string; arrow: string; predicate: string; to: string }>();

	for (const [graph, subjects] of byGraph) {
		const graphId = sanitizeId(graph);
		const total = subjects.size;
		const expanded = expandedGraphs.has(graph);
		const collapsed = !expanded && total > maxPerSubgraph;

		if (collapsed) {
			const summaryId = sanitizeId(`${graph}__summary`);
			nodeIds.add(summaryId);
			lines.push(`  subgraph ${graphId}["${esc(graph)}"]`);
			lines.push(`    ${summaryId}[["${esc(graph)}\n${total} items"]]`);
			lines.push("  end");

			for (const [subject, subjectQuads] of subjects) {
				for (const q of subjectQuads) {
					if (typeof q.object !== "string" || classifier.classify(graph, q.predicate) !== "edge") continue;
					if (q.object === subject) continue;
					const isExternal = externalIds.has(q.object);
					if (!entityIds.has(q.object) && !isExternal) continue;
					const targetId = isExternal
						? sanitizeId(`ref_${q.object}`)
						: (() => {
								const targetGraph = visible.find((v) => v.subject === q.object)?.namedGraph ?? graph;
								if (hiddenGraphs.has(targetGraph)) return null;
								const targetSubjects = byGraph.get(targetGraph);
								const targetCollapsed = targetSubjects && !expandedGraphs.has(targetGraph) && targetSubjects.size > maxPerSubgraph;
								return targetCollapsed ? sanitizeId(`${targetGraph}__summary`) : sanitizeId(`${targetGraph}_${q.object}`);
							})();
					if (!targetId) continue;
					const rel = classifier.relForEdge?.(graph, q.predicate);
					if (opts.hiddenRels?.has(rel ?? q.predicate)) continue;
					const arrow = arrowForEdge(q.predicate, rel);
					const summaryEdgeKey = `${summaryId}|${arrow}|${q.predicate}|${targetId}`;
					const summaryTally = collapsedEdgeTally.get(summaryEdgeKey);
					if (summaryTally) {
						summaryTally.count++;
					} else {
						const idx = edges.length;
						edges.push("");
						collapsedEdgeTally.set(summaryEdgeKey, { idx, count: 1, from: summaryId, arrow, predicate: q.predicate, to: targetId });
					}
				}
			}
			continue;
		}

		lines.push(`  subgraph ${graphId}["${esc(graph)} (${total})"]`);

		for (const [subject, subjectQuads] of subjects) {
			const nodeId = sanitizeId(`${graph}_${subject}`);
			nodeIds.add(nodeId);
			nodeMap.set(nodeId, { graph, subject });

			const nameQuad = subjectQuads.find((q) => classifier.classify(graph, q.predicate) === "name");
			const displayName = nameQuad ? truncate(String(nameQuad.object), 30) : truncate(subject, 25);

			const contentQuad = subjectQuads.find((q) => classifier.classify(graph, q.predicate) === "content");
			const contentStr = contentQuad ? `\n${truncate(String(contentQuad.object), 40)}` : "";

			const props: string[] = [];
			for (const q of subjectQuads) {
				if (classifier.classify(graph, q.predicate) !== "scalar") continue;
				props.push(`${esc(q.predicate)}: ${truncate(String(q.object), 25)}`);
				if (props.length >= 3) break;
			}

			const propsStr = props.length > 0 ? `\n${props.join("\n")}` : "";
			lines.push(`    ${nodeId}["${displayName}${contentStr}${propsStr}"]`);

			for (const q of subjectQuads) {
				if (typeof q.object !== "string" || classifier.classify(graph, q.predicate) !== "edge") continue;
				if (q.object === subject) continue;
				const isExternal = externalIds.has(q.object);
				if (!entityIds.has(q.object) && !isExternal) continue;
				const targetId = isExternal
					? sanitizeId(`ref_${q.object}`)
					: (() => {
							const tg = visible.find((v) => v.subject === q.object)?.namedGraph ?? graph;
							if (hiddenGraphs.has(tg)) return null;
							const ts = byGraph.get(tg);
							const tc = ts && !expandedGraphs.has(tg) && ts.size > maxPerSubgraph;
							return tc ? sanitizeId(`${tg}__summary`) : sanitizeId(`${tg}_${q.object}`);
						})();
				if (!targetId) continue;
				const edgeRel = classifier.relForEdge?.(graph, q.predicate);
				if (opts.hiddenRels?.has(edgeRel ?? q.predicate)) continue;
				const edgeArrow = arrowForEdge(q.predicate, edgeRel);
				const edgeKey = `${nodeId}|${edgeArrow}|${q.predicate}|${targetId}`;
				const tally = collapsedEdgeTally.get(edgeKey);
				if (tally) {
					tally.count++;
				} else {
					const idx = edges.length;
					edges.push("");
					collapsedEdgeTally.set(edgeKey, { idx, count: 1, from: nodeId, arrow: edgeArrow, predicate: q.predicate, to: targetId });
				}
			}
		}

		lines.push("  end");
	}

	// Add referenced resource nodes (URIs referenced by edges but without full vertex data)
	if (externalIds.size > 0) {
		for (const uri of externalIds) {
			const refId = sanitizeId(`ref_${uri}`);
			nodeIds.add(refId);
			nodeMap.set(refId, { graph: "resource", subject: uri });
			lines.push(`  ${refId}(["${truncate(uri, 40)}"])`);
		}
	}

	for (const tally of collapsedEdgeTally.values()) {
		const labelBase = truncate(tally.predicate, 20);
		// Avoid parens in edge labels: mermaid parses them as node-shape delimiters.
		const label = tally.count > 1 ? `${labelBase} ×${tally.count}` : labelBase;
		edges[tally.idx] = `  ${tally.from} ${tally.arrow}|${label}| ${tally.to}`;
	}
	lines.push(...edges);

	// Color subgraphs by vertex type — same palette/key as the fisheye view,
	// so an "Email" subgraph in mermaid matches the colour of "Email" plates
	// in 3D. Cross-view pattern-matching depends on this consistency.
	for (const graph of byGraph.keys()) {
		const color = colorForType(graph);
		const graphId = sanitizeId(graph);
		lines.push(`  style ${graphId} fill:${color},stroke:#ccc`);
	}

	return { source: lines.join("\n"), nodeMap };
}

/** Build a PropertyClassifier from rels/edgeRanges lookup functions (browser-side pattern). */
export function buildClassifier(
	getRelsForGraph: (graph: string) => Record<string, string> | undefined,
	getEdgeRangesForGraph: (graph: string) => Record<string, string> | undefined,
	stepperForType?: (label: string) => string | undefined,
	edgeRelMap?: Record<string, string>,
): PropertyClassifier {
	return {
		classify(graph: string, predicate: string): TPropKind {
			if (predicate.startsWith("_") || INTERNAL_PREDICATES.has(predicate)) return "internal";
			const edges = getEdgeRangesForGraph(graph);
			if (edges?.[predicate]) return "edge";
			// Canonical EdgePredicates are always edges regardless of graph
			if (coreEdgeRel(predicate)) return "edge";
			const rels = getRelsForGraph(graph);
			const rel = rels?.[predicate];
			if (!rel) return "scalar";
			if (rel === LinkRelations.NAME.rel) return "name";
			if (rel === LinkRelations.IDENTIFIER.rel) return "identifier";
			if (rel === LinkRelations.CONTENT.rel) return "content";
			// Any iri-ranged rel is an edge; URL is a literal-ranged exception (URI strings are navigable).
			if (getRelRange(rel) === "iri" || isLiteralEdgeRel(rel)) return "edge";
			return "scalar";
		},
		relForEdge(_graph: string, predicate: string): string | undefined {
			return edgeRelMap?.[predicate];
		},
		stepperForType,
	};
}
