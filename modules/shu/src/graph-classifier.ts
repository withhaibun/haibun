/**
 * Property classifier + graph-view options for the quad → graph projection.
 *
 * `classify` sorts a quad's predicate into name / identifier / edge / content / internal / scalar by its declared
 * hypermedia rel, never guessed from the value. The browser builds a classifier from rels-cache; the server can build
 * one from world.domains. Consumed by the SVG render and the topology projector (graph-topology).
 */
import { LinkRelations, edgeRel as coreEdgeRel, getRelRange } from "@haibun/core/lib/resources.js";
import { STORED_TYPE_PROP } from "./consts.js";

export type TPropKind = "name" | "identifier" | "edge" | "content" | "internal" | "scalar";

/** Dependency-injected property classification, browser uses rels-cache, server uses world.domains. */
export interface PropertyClassifier {
	classify(graph: string, predicate: string): TPropKind;
	/** Return the link relation for an edge predicate (e.g., "attributedTo", "inReplyTo"). */
	relForEdge?(graph: string, predicate: string): string | undefined;
	/** Return the link relation for ANY predicate (property or edge), for role-driven display (author, date, …). */
	rel?(graph: string, predicate: string): string | undefined;
	stepperForType?(persistedAs: string): string | undefined;
}

/** Permissive classifier for thread/product views, treats all non-internal predicates as edges except "name". */
export const THREAD_CLASSIFIER: PropertyClassifier = {
	classify: (_graph, predicate) => {
		if (predicate.startsWith("_")) return "internal";
		if (predicate === "name") return "name";
		return "edge";
	},
};

export type TGraphViewOpts = {
	layout: "TD" | "LR";
	hiddenGraphs: Set<string>;
	expandedGraphs: Set<string>;
	maxPerSubgraph: number;
	hiddenRels?: Set<string>;
	/**
	 * The sole source of a node's title: the server-computed `displayLabels` keyed by
	 * (graph, subject). Required: the view never derives a label from quads. Returns
	 * undefined only for a referenced node not in the displayed sample (e.g. an author);
	 * the caller uses the id in that case, the same terminal rule the server applies.
	 */
	displayLabel: (graph: string, subject: string) => string | undefined;
};

export const DEFAULT_MAX_PER_SUBGRAPH = 20;

/** Properties that are opaque blobs or graph-store internals, excluded from graph rendering. */
export const INTERNAL_PREDICATES = new Set(["signedDocument", "encodedList", "proofValue", "accessLevel", STORED_TYPE_PROP]);

/** URL is the only literal-ranged rel treated as an edge (URI-string targets are conventionally navigable). */
const isLiteralEdgeRel = (rel: string): boolean => rel === LinkRelations.URL.rel;

/** Check if a string looks like a URI or resolvable path. */
export function isUri(s: string): boolean {
	return /^(did:|urn:|https?:\/\/|\/)/.test(s);
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
