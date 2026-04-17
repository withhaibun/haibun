/**
 * Shared mermaid graph renderer — converts quads to mermaid source text.
 *
 * Used by both the browser-side <shu-graph-view> component and the server-side
 * exportMermaid stepper step. Environment-specific property classification is
 * injected via the PropertyClassifier interface.
 */
import { LinkRelations, edgeRel as coreEdgeRel } from "@haibun/core/lib/defs.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

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

/** Properties that are opaque blobs — excluded from graph rendering. */
export const INTERNAL_PREDICATES = new Set(["signedDocument", "encodedList", "proofValue", "accessLevel"]);

/** Edge-typed link relations. */
export const EDGE_RELS: Set<string> = new Set([LinkRelations.ATTRIBUTED_TO.rel, LinkRelations.AUDIENCE.rel, LinkRelations.IN_REPLY_TO.rel, LinkRelations.ATTACHMENT.rel, LinkRelations.URL.rel]);

/** Mermaid arrow style per link relation — encodes visual hierarchy from rel semantics.
 * ===> thick: narrative chain (IN_REPLY_TO — parentCapability, annotates)
 * ---> normal: actors (ATTRIBUTED_TO — controller, delegator, issuer)
 * -.-> dotted: supporting detail (CONTEXT, ATTACHMENT — proof, status, assertionMethod) */
function arrowForRel(rel: string | undefined): string {
	if (rel === LinkRelations.IN_REPLY_TO.rel) return "==>";
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

/** Pastel backgrounds for stepper-based subgraph coloring. */
const STEPPER_PALETTE = ["#fffde7", "#e8f5e9", "#e3f2fd", "#fce4ec", "#f3e5f5", "#e0f7fa", "#fff3e0", "#f1f8e9"];
const stepperColorCache = new Map<string, string>();

export function stepperColor(stepperName: string | undefined): string {
	if (!stepperName) return "#fafafa";
	let color = stepperColorCache.get(stepperName);
	if (!color) {
		color = STEPPER_PALETTE[stepperColorCache.size % STEPPER_PALETTE.length];
		stepperColorCache.set(stepperName, color);
	}
	return color;
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

	const lines: string[] = [`graph ${layout}`];
	const nodeIds = new Set<string>();
	const nodeMap = new Map<string, { graph: string; subject: string }>();
	const edges: string[] = [];

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
					const arrow = arrowForRel(rel);
					if (!edges.some((e) => e.includes(`${summaryId} ${arrow}`) && e.includes(targetId))) {
						edges.push(`  ${summaryId} ${arrow}|${truncate(q.predicate, 20)}| ${targetId}`);
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
				const edgeArrow = arrowForRel(edgeRel);
				const edgeLine = `  ${nodeId} ${edgeArrow}|${truncate(q.predicate, 20)}| ${targetId}`;
				if (!entityIds.has(q.object)) {
					if (!edges.some((e) => e.includes(`${nodeId} ${edgeArrow}`) && e.includes(targetId) && e.includes(q.predicate))) edges.push(edgeLine);
				} else {
					edges.push(edgeLine);
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

	lines.push(...edges);

	// Color subgraphs by stepper
	for (const graph of byGraph.keys()) {
		const stepper = classifier.stepperForType?.(graph);
		const color = stepperColor(stepper);
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
			if (EDGE_RELS.has(rel)) return "edge";
			return "scalar";
		},
		relForEdge(_graph: string, predicate: string): string | undefined {
			return edgeRelMap?.[predicate];
		},
		stepperForType,
	};
}
