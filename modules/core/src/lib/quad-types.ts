/**
 * QuadStore Types for Core
 *
 * Property graph quad model — each quad can carry optional properties,
 * aligning with AGE's vertex properties for seamless PG persistence.
 * All methods are async to support both in-memory and database-backed stores.
 */
import { z } from "zod";

// --- Graph query schema (core domain, used by any graph/quad query UI) ---

export const DOMAIN_GRAPH_QUERY = "graph-query";

export const SearchConditionSchema = z.object({
	predicate: z.string().min(1),
	operator: z.enum(["eq", "contains", "gt", "lt", "gte", "lte", "between"]),
	value: z.string(),
	value2: z.string().optional(),
});

export const GraphQuerySchema = z.object({
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
});
export type TGraphQuery = z.infer<typeof GraphQuerySchema>;

export { type ResourceRels, buildResourceRels, parseTimestampValue } from "./resource-rels.js";

export interface TQuad {
	subject: string;
	predicate: string;
	object: unknown;
	namedGraph: string;
	timestamp: number;
	properties?: Record<string, unknown>;
}

export interface TQuadPattern {
	subject?: string;
	predicate?: string;
	object?: unknown;
	namedGraph?: string;
}

/** Emit a quadObservation event via an event logger. Canonical envelope for all quad emissions. */
export function emitQuadObservation(logger: { emit: (e: Record<string, unknown>) => void }, id: string, quad: Omit<TQuad, "properties">): void {
	logger.emit({
		id, timestamp: quad.timestamp, source: "haibun", level: "debug", kind: "artifact", artifactType: "json", mimetype: "application/json",
		json: { quadObservation: quad },
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
			quads.push({ subject: q.subject, predicate: q.predicate, object: q.object, namedGraph: q.namedGraph, timestamp: q.timestamp ?? (e.timestamp as number) ?? Date.now(), properties: q.properties });
		}
	}
	return quads;
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

	/** Vertex operations — convenience over quads. namedGraph = vertex label. */
	upsertVertex(label: string, data: unknown): Promise<string>;
	getVertex<T = Record<string, unknown>>(label: string, id: string): Promise<T | undefined>;
	deleteVertex(label: string, id: string): Promise<void>;
	queryVertices<T = Record<string, unknown>>(
		label: string,
		filters?: Record<string, unknown>,
		options?: { limit?: number; offset?: number },
	): Promise<T[]>;
	distinctPropertyValues(label: string, property: string): Promise<string[]>;
}
