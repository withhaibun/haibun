/**
 * Shared mermaid graph renderer — converts quads to mermaid source text.
 *
 * Used by both the browser-side <shu-graph-view> component and the server-side
 * `get graph diagnostics` step. Environment-specific property classification is
 * injected via the PropertyClassifier interface.
 */
import { LinkRelations, BODY_LABEL, edgeRel as coreEdgeRel, getRelRange, isReplyEdge } from "@haibun/core/lib/resources.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { colorForType } from "./type-colors.js";
import { STORED_TYPE_PROP } from "./consts.js";
import { formatDate } from "./util.js";

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
	/** Return the link relation for ANY predicate (property or edge), for role-driven display (author, date, …). */
	rel?(graph: string, predicate: string): string | undefined;
	stepperForType?(persistedAs: string): string | undefined;
}

export type TGraphViewOpts = {
	layout: "TD" | "LR";
	hiddenGraphs: Set<string>;
	expandedGraphs: Set<string>;
	maxPerSubgraph: number;
	hiddenRels?: Set<string>;
	/** Per-node display title from the store's hypermedia label derivation (the same `displayLabels` the column views use), keyed by (graph, subject). */
	displayLabel?: (graph: string, subject: string) => string | undefined;
};

/** Per-edge-candidate render outcome — why an edge-classified quad did or didn't draw. */
export type TEdgeDiagnostic = {
	source: string;
	namedGraph: string;
	predicate: string;
	object: string;
	objectType?: string;
	drawn: boolean;
	/** Present when not drawn: object-not-string | self-loop | target-absent | no-objectType | target-type-hidden | target-type-mismatch | rel-hidden. */
	reason?: string;
};

/** Render diagnostics — what the renderer saw and decided, so a missing edge can be explained instead of guessed. */
export type TGraphDiagnostics = {
	totalQuads: number;
	visibleQuads: number;
	graphs: { name: string; subjects: number }[];
	edgesDrawn: number;
	edges: TEdgeDiagnostic[];
};

export type TBuildResult = { source: string; nodeMap: Map<string, { graph: string; subject: string }>; diagnostics: TGraphDiagnostics; drawnEdges: { from: string; to: string }[] };

export const DEFAULT_MAX_PER_SUBGRAPH = 20;

/** Properties that are opaque blobs or graph-store internals — excluded from graph rendering. */
export const INTERNAL_PREDICATES = new Set(["signedDocument", "encodedList", "proofValue", "accessLevel", STORED_TYPE_PROP]);

/** Rels whose value is a timestamp — rendered as a friendly date line (via the shared query-view formatter), not a raw prop. */
const TEMPORAL_RELS = new Set<string>([LinkRelations.GENERATED_AT_TIME.rel, LinkRelations.PUBLISHED.rel, LinkRelations.UPDATED.rel, LinkRelations.VALID_FROM.rel]);
/** Rels that are graph plumbing/metadata, not a node's significant props. */
const SUPPRESSED_PROP_RELS = new Set<string>([LinkRelations.MEDIA_TYPE.rel]);

/** An opaque machine id (urn:uuid or a bare uuid) — not worth a node identifier line. */
function isOpaqueId(s: string): boolean {
	return /^urn:uuid:/.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(s);
}

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
		.replace(/\s+/g, " ") // collapse whitespace runs: a literal newline would split the single-line ["..."] label and break mermaid
		.replace(/"/g, "#quot;")
		.replace(/[[\](){}|<>]/g, " ");
}

export function sanitizeId(s: string): string {
	return s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
}

/** Truncate a value for a mermaid node/edge label: escape FIRST (so a cut can't split a `#quot;` entity and the label
 *  stays mermaid-safe), then cap length. Distinct from util.ts `truncate`, which is plain text with no escaping. */
function truncateLabel(s: string, max = 30): string {
	const str = esc(String(s));
	return str.length > max ? `${str.slice(0, max)}...` : str;
}

/** Check if a string looks like a URI or resolvable path. */
export function isUri(s: string): boolean {
	return /^(did:|urn:|https?:\/\/|\/)/.test(s);
}

/**
 * Content of a node's smallest linked Body sub-resource — the concise summary (a Comment's text, an attestation's
 * attributes) rather than a large signed or encoded blob — for a node with no inline name or content of its own.
 */
function linkedBodyContent(subjectQuads: TQuad[], byGraph: Map<string, Map<string, TQuad[]>>): string | undefined {
	let best: string | undefined;
	for (const q of subjectQuads) {
		if (typeof q.object !== "string" || q.objectType !== BODY_LABEL) continue;
		const content = byGraph
			.get(BODY_LABEL)
			?.get(q.object)
			?.find((b) => b.predicate === "content")?.object;
		const s = typeof content === "string" ? content.trim() : "";
		if (s && (best === undefined || s.length < best.length)) best = s;
	}
	return best;
}

/**
 * A node's contents, driven by hypermedia rel ROLES (not field names): title, identifier (skipping opaque uuids),
 * author (ATTRIBUTED_TO), a friendly date, then any remaining scalars. Each value shows once.
 */
function nodeContents(
	graph: string,
	subject: string,
	subjectQuads: TQuad[],
	opts: TGraphViewOpts,
	classifier: PropertyClassifier,
	byGraph: Map<string, Map<string, TQuad[]>>,
): string {
	const kind = (q: TQuad) => classifier.classify(graph, q.predicate);
	const nameQuad = subjectQuads.find((q) => kind(q) === "name");
	const contentQuad = subjectQuads.find((q) => kind(q) === "content");
	const idQuad = subjectQuads.find((q) => kind(q) === "identifier");
	const title =
		opts.displayLabel?.(graph, subject) ?? (nameQuad ? String(nameQuad.object) : contentQuad ? String(contentQuad.object) : (linkedBodyContent(subjectQuads, byGraph) ?? subject));
	const lines = [truncateLabel(title, 40)];
	const seen = new Set([String(title).trim()]);
	const add = (s: string) => {
		const v = s.trim();
		if (v && !seen.has(v)) {
			seen.add(v);
			lines.push(truncateLabel(v, 38));
		}
	};
	if (contentQuad) add(String(contentQuad.object));
	if (idQuad) {
		const v = String(idQuad.object);
		if (v !== String(title) && !isOpaqueId(v)) add(v);
	}
	const authorQuad = subjectQuads.find((q) => typeof q.object === "string" && classifier.rel?.(graph, q.predicate) === LinkRelations.ATTRIBUTED_TO.rel);
	if (authorQuad) add(`by ${opts.displayLabel?.(String(authorQuad.objectType ?? ""), String(authorQuad.object)) ?? String(authorQuad.object)}`);
	const dateQuad = subjectQuads.find((q) => {
		const r = classifier.rel?.(graph, q.predicate);
		return r !== undefined && TEMPORAL_RELS.has(r);
	});
	if (dateQuad) add(formatDate(String(dateQuad.object)));
	// Show every remaining scalar property as `predicate: value` — including those with no recognized rel — so node
	// labels carry their full content, not just the title. Skip the role quads already shown and graph-plumbing metadata.
	for (const q of subjectQuads) {
		if (kind(q) !== "scalar" || q === nameQuad || q === contentQuad || q === idQuad || q === authorQuad || q === dateQuad) continue;
		// Drop only structural keys (JSON-LD @keywords, _internal, the stored type handle); keep the node's real properties.
		if (q.predicate.startsWith("@") || q.predicate.startsWith("_") || q.predicate === STORED_TYPE_PROP) continue;
		const r = classifier.rel?.(graph, q.predicate);
		if (r !== undefined && (TEMPORAL_RELS.has(r) || SUPPRESSED_PROP_RELS.has(r))) continue;
		add(`${esc(q.predicate)}: ${String(q.object)}`);
	}
	// `<br/>` (htmlLabels) — not a literal newline, which mermaid's flowchart parser rejects inside `["…"]`.
	return lines.join("<br/>");
}

/** Build a mermaid graph source from quads using the given property classifier. */
export function buildMermaidSource(quads: TQuad[], opts: TGraphViewOpts, classifier: PropertyClassifier): TBuildResult {
	const { layout, hiddenGraphs, expandedGraphs, maxPerSubgraph } = opts;
	const visible = quads.filter((q) => !hiddenGraphs.has(q.namedGraph));
	const entityIds = new Set(visible.map((q) => q.subject));

	// Collect external URI references (edge targets not in the entity set)
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

	// Mermaid's `TD` / `LR` keywords don't match this view's layout button: mermaid
	// renders `graph TD` with subgraphs side-by-side (visually horizontal), so a "TD"
	// button selection must emit `LR` for a top-down-looking diagram. Swap the keywords
	// so the rendered orientation matches the button label.
	const mermaidDir = layout === "TD" ? "LR" : "TD";
	const lines: string[] = [`graph ${mermaidDir}`];
	const nodeIds = new Set<string>();
	const nodeMap = new Map<string, { graph: string; subject: string }>();
	const edges: string[] = [];
	const edgeDiagnostics: TEdgeDiagnostic[] = [];
	/** Coalesces edges that collapse to the same target summary node into a single line with a count badge. */
	const collapsedEdgeTally = new Map<string, { idx: number; count: number; from: string; arrow: string; predicate: string; to: string }>();

	const addEdge = (from: string, arrow: string, predicate: string, to: string): void => {
		const key = `${from}|${arrow}|${predicate}|${to}`;
		const tally = collapsedEdgeTally.get(key);
		if (tally) {
			tally.count++;
			return;
		}
		const idx = edges.length;
		edges.push("");
		collapsedEdgeTally.set(key, { idx, count: 1, from, arrow, predicate, to });
	};

	/**
	 * Decide whether an edge-classified quad draws, and to which node. The target is resolved by the edge's
	 * declared range (`objectType`, the JSON-LD range), never guessed from the id — guessing is what mis-links
	 * nodes whose id is shared across types (a DID that is both a Principal and an Issuer). Returns null for a
	 * non-edge quad; otherwise a draw target or a skip reason. The reasons are the vocabulary the diagnostics
	 * report exposes and tests assert against.
	 */
	const resolveEdge = (q: TQuad, graph: string, subject: string): { draw: true; targetId: string; arrow: string } | { draw: false; reason: string } | null => {
		if (classifier.classify(graph, q.predicate) !== "edge") return null;
		if (typeof q.object !== "string") return { draw: false, reason: "object-not-string" };
		const obj = q.object;
		if (obj === subject) return { draw: false, reason: "self-loop" };
		const isExternal = externalIds.has(obj);
		if (!entityIds.has(obj) && !isExternal) return { draw: false, reason: "target-absent" };
		let targetId: string;
		if (isExternal) {
			targetId = sanitizeId(`ref_${obj}`);
		} else if (typeof q.objectType !== "string" || q.objectType.length === 0) {
			return { draw: false, reason: "no-objectType" };
		} else if (hiddenGraphs.has(q.objectType)) {
			return { draw: false, reason: "target-type-hidden" };
		} else {
			const targetSubjects = byGraph.get(q.objectType);
			if (!targetSubjects?.has(obj)) return { draw: false, reason: "target-type-mismatch" };
			const collapsedTarget = !expandedGraphs.has(q.objectType) && targetSubjects.size > maxPerSubgraph;
			targetId = collapsedTarget ? sanitizeId(`${q.objectType}__summary`) : sanitizeId(`${q.objectType}_${obj}`);
		}
		const rel = classifier.relForEdge?.(graph, q.predicate);
		if (opts.hiddenRels?.has(rel ?? q.predicate)) return { draw: false, reason: "rel-hidden" };
		return { draw: true, targetId, arrow: arrowForEdge(q.predicate, rel) };
	};

	const processEdge = (from: string, q: TQuad, graph: string, subject: string): void => {
		const r = resolveEdge(q, graph, subject);
		if (!r) return;
		const diag: TEdgeDiagnostic = { source: subject, namedGraph: graph, predicate: q.predicate, object: String(q.object), objectType: q.objectType, drawn: r.draw };
		if (!r.draw) diag.reason = r.reason;
		edgeDiagnostics.push(diag);
		if (r.draw) addEdge(from, r.arrow, q.predicate, r.targetId);
	};

	for (const [graph, subjects] of byGraph) {
		const graphId = sanitizeId(graph);
		const total = subjects.size;
		const expanded = expandedGraphs.has(graph);
		const collapsed = !expanded && total > maxPerSubgraph;

		if (collapsed) {
			const summaryId = sanitizeId(`${graph}__summary`);
			nodeIds.add(summaryId);
			lines.push(`  subgraph ${graphId}["${esc(graph)}"]`);
			// Rounded shape (not the `[[ ]]` subroutine): the subroutine/hexagon shapes route via polygon intersection
			// the server-side jsdom render can't supply, producing zero-point edges that crash edge-label placement in TD.
			lines.push(`    ${summaryId}("${esc(graph)}<br/>${total} items")`);
			lines.push("  end");

			for (const [subject, subjectQuads] of subjects) {
				for (const q of subjectQuads) processEdge(summaryId, q, graph, subject);
			}
			continue;
		}

		lines.push(`  subgraph ${graphId}["${esc(graph)} (${total})"]`);

		for (const [subject, subjectQuads] of subjects) {
			const nodeId = sanitizeId(`${graph}_${subject}`);
			nodeIds.add(nodeId);
			nodeMap.set(nodeId, { graph, subject });

			lines.push(`    ${nodeId}["${nodeContents(graph, subject, subjectQuads, opts, classifier, byGraph)}"]`);

			for (const q of subjectQuads) processEdge(nodeId, q, graph, subject);
		}

		lines.push("  end");
	}

	// Add referenced resource nodes (URIs referenced by edges but without full node data)
	if (externalIds.size > 0) {
		for (const uri of externalIds) {
			const refId = sanitizeId(`ref_${uri}`);
			nodeIds.add(refId);
			nodeMap.set(refId, { graph: "resource", subject: uri });
			lines.push(`  ${refId}(["${truncateLabel(uri, 40)}"])`);
		}
	}

	// Drawn edges in render order. The rendered SVG's edge paths follow this same order, so the client maps the nth path
	// to drawnEdges[n] for adjacency — exact node ids, never parsed back out of the (ambiguous, underscore-laden) path id.
	const drawnEdges: { from: string; to: string }[] = [];
	for (const tally of collapsedEdgeTally.values()) {
		const labelBase = truncateLabel(tally.predicate, 20);
		// Avoid parens in edge labels: mermaid parses them as node-shape delimiters.
		const label = tally.count > 1 ? `${labelBase} ×${tally.count}` : labelBase;
		edges[tally.idx] = `  ${tally.from} ${tally.arrow}|${label}| ${tally.to}`;
		drawnEdges[tally.idx] = { from: tally.from, to: tally.to };
	}
	lines.push(...edges);

	// Color subgraphs by node type — same palette/key as an external 3D viewer,
	// so an "Email" subgraph in mermaid matches the colour of "Email" plates
	// in 3D. Cross-view pattern-matching depends on this consistency.
	for (const graph of byGraph.keys()) {
		const color = colorForType(graph);
		const graphId = sanitizeId(graph);
		lines.push(`  style ${graphId} fill:${color},stroke:#ccc`);
	}

	const diagnostics: TGraphDiagnostics = {
		totalQuads: quads.length,
		visibleQuads: visible.length,
		graphs: [...byGraph.entries()].map(([name, subs]) => ({ name, subjects: subs.size })),
		edgesDrawn: edgeDiagnostics.filter((e) => e.drawn).length,
		edges: edgeDiagnostics,
	};
	return { source: lines.join("\n"), nodeMap, diagnostics, drawnEdges };
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
		rel(graph: string, predicate: string): string | undefined {
			return getRelsForGraph(graph)?.[predicate] ?? edgeRelMap?.[predicate] ?? coreEdgeRel(predicate) ?? undefined;
		},
		stepperForType,
	};
}
