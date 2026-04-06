/**
 * QuadStore Types for Core
 *
 * Minimal quad types for the unified observation model.
 * All methods are async to support both in-memory and database-backed stores.
 */

export interface TQuad {
	subject: string;
	predicate: string;
	object: unknown;
	namedGraph: string;
	timestamp: number;
}

export interface TQuadPattern {
	subject?: string;
	predicate?: string;
	object?: unknown;
	namedGraph?: string;
}

export interface IQuadStore {
	/** Set a value (upserts: replaces existing quad with same subject+predicate+namedGraph) */
	set(subject: string, predicate: string, object: unknown, namedGraph: string): Promise<void>;

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
	queryVertices<T = Record<string, unknown>>(label: string, filters?: Record<string, unknown>, options?: { limit?: number; offset?: number }): Promise<T[]>;
	distinctPropertyValues(label: string, property: string): Promise<string[]>;
}
