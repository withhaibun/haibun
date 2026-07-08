/**
 * QuadStore Types for Core
 *
 * Property graph quad model — each quad can carry optional properties,
 * aligning with a property-graph backing store's vertex properties for seamless persistence.
 * All methods are async to support both in-memory and database-backed stores.
 */
import { z } from "zod";
import type { AccessLevel } from "./resources.js";
import { ellipsize } from "./util/index.js";

/**
 * Named graph holding stepper variables (feature-variables projection of TStepValue).
 * Declared here so quad-store can reference it without a cycle through feature-variables.
 */
export const SHARED_GRAPH = "variables";

// --- Graph query schema (core domain, used by any graph/quad query UI) ---

export const DOMAIN_GRAPH_QUERY = "graph-query";

export const SearchConditionSchema = z
	.object({
		predicate: z.string().min(1),
		operator: z.enum(["eq", "contains", "gt", "lt", "gte", "lte", "between"]),
		value: z.string(),
		value2: z.string().optional(),
	})
	.strict();

export const GraphQuerySchema = z
	.object({
		label: z.string().optional(),
		filters: z.array(SearchConditionSchema).default([]),
		textQuery: z.string().optional(),
		sortBy: z.string().optional(),
		sortOrder: z.enum(["asc", "desc"]).default("desc"),
		limit: z.number().int().positive().default(50),
		offset: z.number().int().nonnegative().default(0),
		accessLevel: z.enum(["private", "public", "opened", "all"]).default("private"),
		fields: z.array(z.string()).optional(),
		explain: z.boolean().default(false),
		/** When true, skip the separate total-count query; `total` returns the page length only. */
		skipCount: z.boolean().default(false),
	})
	.strict();
export type TGraphQuery = z.infer<typeof GraphQuerySchema>;

export { type ResourceRels, buildResourceRels, parseTimestampValue } from "./hypermedia.js";

export interface TQuad {
	subject: string;
	predicate: string;
	object: unknown;
	namedGraph: string;
	/** For edge quads: the declared type (range) of the target node. Lets a renderer resolve an edge to the exact (type, id) node instead of guessing by id — necessary when one id exists under several types (e.g. a DID that is both a Principal and an Issuer). */
	objectType?: string;
	timestamp: number;
	properties?: Record<string, unknown>;
}

export interface TQuadPattern {
	subject?: string;
	predicate?: string;
	object?: unknown;
	namedGraph?: string;
}

/** The most of a string value a quad OBSERVATION carries. Events carry references and previews, never payloads:
 *  an emitted body would otherwise ride into every event buffer and SSE frame (a first-time index of a large
 *  mailbox measured in gigabytes). The store keeps the full value; a consumer that needs it dereferences. */
export const OBSERVATION_VALUE_MAX = 512;

/** Emit a quadObservation event via an event logger. Canonical envelope for all quad emissions; string values are
 *  bounded to OBSERVATION_VALUE_MAX and marked `preview: true` (the store holds the payload — a consumer that needs
 *  it dereferences deliberately, and a merge can prefer a full value over a preview). Untruncated quads pass by
 *  reference — no per-emission clone on the write path. */
export function emitQuadObservation(logger: { emit: (e: Record<string, unknown>) => void }, id: string, quad: TQuad): void {
	const bounded = typeof quad.object === "string" && quad.object.length > OBSERVATION_VALUE_MAX;
	const observed = bounded ? { ...quad, object: ellipsize(quad.object as string, OBSERVATION_VALUE_MAX), properties: { ...quad.properties, preview: true } } : quad;
	logger.emit({
		id,
		timestamp: quad.timestamp,
		source: "haibun",
		level: "debug",
		kind: "artifact",
		artifactType: "json",
		mimetype: "application/json",
		json: { quadObservation: observed },
	});
}

/** Extract quadObservation quads from haibun event log entries. */
export function extractQuadsFromEvents(events: Record<string, unknown>[]): TQuad[] {
	const quads: TQuad[] = [];
	for (const e of events) {
		if (e.kind !== "artifact" || e.artifactType !== "json") continue;
		const json = e.json as { quadObservation?: TQuad } | undefined;
		const q = json?.quadObservation;
		if (q?.subject && q.predicate && q.namedGraph) {
			quads.push({
				subject: q.subject,
				predicate: q.predicate,
				object: q.object,
				namedGraph: q.namedGraph,
				objectType: q.objectType,
				timestamp: q.timestamp ?? (e.timestamp as number) ?? Date.now(),
				properties: q.properties,
			});
		}
	}
	return quads;
}

/**
 * Whether a batch of events carries a data change relevant to a view scoped to `label` — the single relevance test a
 * live view applies before re-deriving itself from the graph. True when the batch yields at least one quad and, if a
 * `label` is given, at least one quad in that named graph; with no `label` any quad is relevant (an unscoped view).
 * A caller that only refreshes when scoped (e.g. label-specific filter values) guards the no-label case itself.
 */
export function eventsAffectLabel(events: Record<string, unknown>[], label?: string): boolean {
	const quads = extractQuadsFromEvents(events);
	if (quads.length === 0) return false;
	return !label || quads.some((q) => q.namedGraph === label);
}

export interface IQuadStore {
	/** Set a value (upserts: replaces existing quad with same subject+predicate+namedGraph) */
	set(subject: string, predicate: string, object: unknown, namedGraph: string, properties?: Record<string, unknown>): Promise<void>;

	/** Get the most recent value for a subject-predicate pair */
	get(subject: string, predicate: string, namedGraph?: string): Promise<unknown | undefined>;

	/** Add a quad to the store (appends, does not upsert) */
	add(quad: Omit<TQuad, "timestamp">): Promise<void>;

	/** Query quads matching a pattern */
	query(pattern: TQuadPattern): Promise<TQuad[]>;

	/** Clear quads, optionally filtered by namedGraph */
	clear(namedGraph?: string): Promise<void>;

	/** Remove quads matching a pattern */
	remove(pattern: TQuadPattern): Promise<void>;

	/** Get all quads */
	all(): Promise<TQuad[]>;

	/** Individual operations — convenience over quads. namedGraph = persisted label. */
	upsertIndividual(label: string, data: unknown): Promise<string>;
	getIndividual<T = Record<string, unknown>>(label: string, id: string): Promise<T | undefined>;
	deleteIndividual(label: string, id: string): Promise<void>;
	queryIndividuals<T = Record<string, unknown>>(label: string, filters?: Record<string, unknown>, options?: { limit?: number; offset?: number }): Promise<T[]>;
	distinctPropertyValues(label: string, property: string): Promise<string[]>;

	/**
	 * Type-bounded snapshot for graph view rendering. For each requested type
	 * (or every known type if `types` is omitted), returns up to `perTypeLimit`
	 * individual's quads plus a sidecar cluster summary so the view can render an
	 * `+N more` cluster node when sampling truncates. Required: every quad store
	 * owns its bounded clustered query — there is no unbounded `all()`-then-slice
	 * fallback. At scale this must sample at the source, not load every row.
	 * `accessLevel` is the visibility ceiling, identical to every other read path:
	 * the sample, its edges, body-preview labels and the `+N more` totals are all
	 * computed under it, so the view never surfaces a node the caller can't open.
	 */
	getClusteredQuads(opts: TClusteredQuadsOpts): Promise<TClusteredQuads>;

	/**
	 * Create a single navigable edge between two individuals (graph-native stores only).
	 * Backing stores that materialize edges as first-class entities (a property-graph engine) implement
	 * this so a topology edge becomes a real, walkable relationship rather than a property
	 * column. The in-memory QuadStore models edges as quads, so callers fall back to `add`
	 * when this is absent. Idempotent per (from, edge, to) in implementations.
	 */
	createEdge?(fromLabel: string, fromId: string, edgeLabel: string, toLabel: string, toId: string): Promise<void>;
}

/**
 * Options for the clustered read. `scope` decides whether federated peers join the merge: `"federated"`
 * (the default) is an instance's OWN view — local + backing stores + every federated peer; `"own"` is
 * what it serves TO a peer — local + backing only. A federated read always asks for `"own"`: a peer is
 * authoritative for what it hosts, and serving views-of-views would recurse on any federation cycle.
 */
export type TClusteredQuadsOpts = { perTypeLimit: number; types?: string[]; accessLevel: AccessLevel; scope?: "own" | "federated" };

export interface TCluster {
	/** Persisted label this cluster represents. */
	type: string;
	/** Total individuals of this type in the store. */
	totalCount: number;
	/** Individuals included in `quads` (≤ perTypeLimit). */
	sampledCount: number;
	/** Individuals not represented in `quads` (totalCount − sampledCount). */
	omittedCount: number;
	/** Subjects for which quads are present, in sample order. */
	sampledSubjects: string[];
	/**
	 * Display label for every sampled subject — the single source of a node's title.
	 * Required and total: each producer fills one entry per `sampledSubjects` via the
	 * shared `composeDisplayLabel` (name/content rel → shortest linked-body preview →
	 * id), so views render straight from it and never compute their own label.
	 */
	displayLabels: Record<string, string>;
	/**
	 * Site principal (did:site DID) per sampled subject, for subjects served by a FEDERATED peer. A read-time
	 * store fact, never persisted on the data: which site's store served the subject. Absent for a subject
	 * served by the responding site itself — the response-level `TClusteredQuads.site` is its principal.
	 */
	sites?: Record<string, string>;
}

export interface TClusteredQuads {
	quads: TQuad[];
	clusters: TCluster[];
	/** Site principal of the responding instance — the serving site of every sampled subject not overridden in `TCluster.sites`. */
	site?: string;
}

/**
 * A federated peer's clustered read surface — the reads-first federation contract. A peer serves its
 * bounded, accessLevel-gated clustered snapshot; it is NOT a routed backing store (no raw pattern
 * queries, no writes — those arrive with capability-gated federation). `site` is the peer's unique
 * site principal, the per-subject stamp for everything it serves.
 */
export interface TFederatedGraphSource {
	site: string;
	getClusteredQuads(opts: TClusteredQuadsOpts): Promise<TClusteredQuads>;
}
