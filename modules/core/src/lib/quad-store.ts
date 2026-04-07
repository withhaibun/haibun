/**
 * QuadStore - In-memory quad store with optional backing store routing
 *
 * Stores quads as Subject-Predicate-Object-namedGraph with timestamps and optional properties.
 * Backing stores can be registered for specific named graphs — writes route to the owning store,
 * reads merge across all stores.
 * Methods return Promises (via Promise.resolve) to satisfy the async IQuadStore interface.
 */

import type { IQuadStore, TQuad, TQuadPattern } from "./quad-types.js";

export class QuadStore implements IQuadStore {
	private quads: TQuad[] = [];
	private backingStores = new Map<string, IQuadStore>();
	private registeredGraphs = new Set<string>();

	/** Register a backing store for specific named graphs. Writes route to it, reads merge. */
	registerStore(store: IQuadStore, namedGraphs: string[]): void {
		for (const ng of namedGraphs) {
			this.backingStores.set(ng, store);
			this.registeredGraphs.add(ng);
		}
	}

	private storeFor(namedGraph: string): IQuadStore | undefined {
		return this.backingStores.get(namedGraph);
	}

	private get allStores(): IQuadStore[] {
		return [...new Set(this.backingStores.values())];
	}

	set(subject: string, predicate: string, object: unknown, namedGraph: string, properties?: Record<string, unknown>): Promise<void> {
		const backing = this.storeFor(namedGraph);
		if (backing) return backing.set(subject, predicate, object, namedGraph, properties);
		this.quads = this.quads.filter((q) => !(q.subject === subject && q.predicate === predicate && q.namedGraph === namedGraph));
		this.quads.push({ subject, predicate, object, namedGraph, timestamp: Date.now(), ...(properties ? { properties } : {}) });
		return Promise.resolve();
	}

	get(subject: string, predicate: string, namedGraph?: string): Promise<unknown | undefined> {
		if (namedGraph) {
			const backing = this.storeFor(namedGraph);
			if (backing) return backing.get(subject, predicate, namedGraph);
		}
		// Search local first
		for (let i = this.quads.length - 1; i >= 0; i--) {
			const q = this.quads[i];
			if (q.subject === subject && q.predicate === predicate && (namedGraph === undefined || q.namedGraph === namedGraph)) return Promise.resolve(q.object);
		}
		// Then search backing stores if no namedGraph filter
		if (namedGraph === undefined) {
			return this.getFromBackingStores(subject, predicate);
		}
		return Promise.resolve(undefined);
	}

	private async getFromBackingStores(subject: string, predicate: string): Promise<unknown | undefined> {
		for (const store of this.allStores) {
			const result = await store.get(subject, predicate);
			if (result !== undefined) return result;
		}
		return undefined;
	}

	add(quad: Omit<TQuad, "timestamp">): Promise<void> {
		const backing = this.storeFor(quad.namedGraph);
		if (backing) return backing.add(quad);
		this.quads.push({ ...quad, timestamp: Date.now() });
		return Promise.resolve();
	}

	async query(pattern: TQuadPattern): Promise<TQuad[]> {
		if (pattern.namedGraph) {
			const backing = this.storeFor(pattern.namedGraph);
			if (backing) return backing.query(pattern);
			return this.localQuery(pattern);
		}
		// No namedGraph filter — merge local + all backing stores
		const local = this.localQuery(pattern);
		const backingResults = await Promise.all(this.allStores.map((s) => s.query(pattern)));
		return [...local, ...backingResults.flat()].sort((a, b) => a.timestamp - b.timestamp);
	}

	private localQuery(pattern: TQuadPattern): TQuad[] {
		return this.quads.filter((q) => {
			if (pattern.subject !== undefined && q.subject !== pattern.subject) return false;
			if (pattern.predicate !== undefined && q.predicate !== pattern.predicate) return false;
			if (pattern.object !== undefined && q.object !== pattern.object) return false;
			if (pattern.namedGraph !== undefined && q.namedGraph !== pattern.namedGraph) return false;
			return true;
		});
	}

	clear(namedGraph?: string): Promise<void> {
		if (namedGraph) {
			// Don't clear persistent backing stores — only clear ephemeral (local) data
			if (this.registeredGraphs.has(namedGraph)) return Promise.resolve();
			this.quads = this.quads.filter((q) => q.namedGraph !== namedGraph);
		} else {
			// Clear ephemeral only
			this.quads = [];
		}
		return Promise.resolve();
	}

	remove(pattern: TQuadPattern): Promise<void> {
		if (pattern.namedGraph) {
			const backing = this.storeFor(pattern.namedGraph);
			if (backing) return backing.remove(pattern);
		}
		this.quads = this.quads.filter((q) => {
			if (pattern.subject !== undefined && q.subject !== pattern.subject) return true;
			if (pattern.predicate !== undefined && q.predicate !== pattern.predicate) return true;
			if (pattern.object !== undefined && q.object !== pattern.object) return true;
			if (pattern.namedGraph !== undefined && q.namedGraph !== pattern.namedGraph) return true;
			return false;
		});
		return Promise.resolve();
	}

	async all(): Promise<TQuad[]> {
		const local = [...this.quads];
		const backingResults = await Promise.all(this.allStores.map((s) => s.all()));
		return [...local, ...backingResults.flat()].sort((a, b) => a.timestamp - b.timestamp);
	}

	// --- Vertex operations: route to backing store or local emulation ---

	private idFields: Record<string, string> = {};
	private schemas: Record<string, import("zod").ZodType> = {};

	registerVertexType(label: string, schema: import("zod").ZodType, idField: string): void {
		this.schemas[label] = schema;
		this.idFields[label] = idField;
	}

	async upsertVertex(label: string, data: unknown): Promise<string> {
		const backing = this.storeFor(label);
		if (backing) return backing.upsertVertex(label, data);
		const schema = this.schemas[label];
		const validated = (schema ? schema.parse(data) : data) as Record<string, unknown>;
		const idField = this.idFields[label] ?? "id";
		const id = String(validated[idField]);
		if (!id) throw new Error(`Missing identity field "${idField}" for ${label}`);
		await this.remove({ subject: id, namedGraph: label });
		for (const [key, value] of Object.entries(validated)) {
			if (value !== undefined && value !== null) {
				await this.add({ subject: id, predicate: key, object: value, namedGraph: label });
			}
		}
		return id;
	}

	async getVertex<T = Record<string, unknown>>(label: string, id: string): Promise<T | undefined> {
		const backing = this.storeFor(label);
		if (backing) return backing.getVertex<T>(label, id);
		const quads = await this.query({ subject: id, namedGraph: label });
		if (quads.length === 0) return undefined;
		const result: Record<string, unknown> = {};
		for (const q of quads) result[q.predicate] = q.object;
		return result as T;
	}

	async deleteVertex(label: string, id: string): Promise<void> {
		const backing = this.storeFor(label);
		if (backing) return backing.deleteVertex(label, id);
		await this.remove({ subject: id, namedGraph: label });
	}

	async queryVertices<T = Record<string, unknown>>(label: string, filters?: Record<string, unknown>, options?: { limit?: number; offset?: number }): Promise<T[]> {
		const backing = this.storeFor(label);
		if (backing) return backing.queryVertices<T>(label, filters, options);
		const allQuads = await this.query({ namedGraph: label });
		const subjects = [...new Set(allQuads.map((q) => q.subject))];
		let vertices: Record<string, unknown>[] = [];
		for (const subject of subjects) {
			const vertex = await this.getVertex(label, subject);
			if (vertex) vertices.push(vertex);
		}
		if (filters) {
			for (const [key, value] of Object.entries(filters)) {
				vertices = vertices.filter((v) => v[key] === value);
			}
		}
		const offset = options?.offset ?? 0;
		const limit = options?.limit ?? vertices.length;
		return vertices.slice(offset, offset + limit) as T[];
	}

	async distinctPropertyValues(label: string, property: string): Promise<string[]> {
		const backing = this.storeFor(label);
		if (backing) return backing.distinctPropertyValues(label, property);
		const quads = await this.query({ predicate: property, namedGraph: label });
		return [...new Set(quads.map((q) => String(q.object)))].sort();
	}
}
