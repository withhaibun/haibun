/**
 * QuadStore - In-memory quad store with optional backing store routing
 *
 * Stores quads as Subject-Predicate-Object-namedGraph with timestamps and optional properties.
 * Backing stores can be registered for specific named graphs — writes route to the owning store,
 * reads merge across all stores.
 * Methods return Promises (via Promise.resolve) to satisfy the async IQuadStore interface.
 */

import { SHARED_GRAPH, type IQuadStore, type TCluster, type TClusteredQuads, type TClusteredQuadsOpts, type TFederatedGraphSource, type TQuad, type TQuadPattern } from "./quad-types.js";
import { displayLabelForQuads } from "./hypermedia.js";
import { BODY_LABEL } from "./resources.js";

export class QuadStore implements IQuadStore {
	private quads: TQuad[] = [];
	/**
	 * Named-graph → backing-store routing. Shared BY REFERENCE along a scenario/feature chain (each carried store is
	 * constructed with its predecessor's map), so a registration exists in exactly one place and `unregisterStore`
	 * removes it everywhere at once. Copying this map per store is what once let a registration outlive its engine:
	 * a closed engine's store stayed registered in earlier copies and poisoned the next feature's reads.
	 */
	private routing: Map<string, IQuadStore>;
	/**
	 * Federated peers, consulted ONLY by getClusteredQuads — reads-first federation joins at the one read
	 * surface a peer serves (bounded, accessLevel-gated), never the routing map (which owns writes and raw
	 * queries). Shared by reference along the store chain for the same reason as `routing`.
	 */
	private federated: Set<TFederatedGraphSource>;

	constructor(routing?: Map<string, IQuadStore>, federated?: Set<TFederatedGraphSource>) {
		this.routing = routing ?? new Map();
		this.federated = federated ?? new Set();
	}

	/** The routing map, for constructing the next store in a chain so it shares this one's registrations. */
	backingRouting(): Map<string, IQuadStore> {
		return this.routing;
	}

	/** The federated-peer set, carried along the store chain exactly like `backingRouting`. */
	backingFederated(): Set<TFederatedGraphSource> {
		return this.federated;
	}

	/** Merge a federated peer's clustered reads into this store's graph view. `unfederate` reverses it. */
	federate(source: TFederatedGraphSource): void {
		for (const f of this.federated) {
			if (f.site === source.site) throw new Error(`federate: a source for site ${source.site} is already registered`);
		}
		this.federated.add(source);
	}

	unfederate(source: TFederatedGraphSource): void {
		this.federated.delete(source);
	}

	/**
	 * Drop every connection to another instance — federated read sources and remote backing stores. Their lifetime is
	 * the connection's, never longer: a peer torn down at feature end must not leave a registration that the next
	 * feature's reads chase to a dead port. Local backing stores (an owned engine) are untouched.
	 */
	dropRemoteConnections(): void {
		this.federated.clear();
		for (const [ng, store] of [...this.routing]) if (store.isRemote) this.routing.delete(ng);
	}

	/** Register a backing store for specific named graphs. Writes route to it, reads merge.
	 *  Quads previously written to the in-memory layer for these graphs are migrated into
	 *  the backing as full individual upserts so subsequent set() reads find them there. */
	async registerStore(store: IQuadStore, namedGraphs: string[]): Promise<void> {
		const ngSet = new Set(namedGraphs);
		const bySubject = new Map<string, { ng: string; record: Record<string, unknown> }>();
		for (const q of this.quads) {
			if (!ngSet.has(q.namedGraph)) continue;
			const key = `${q.namedGraph}\u0000${q.subject}`;
			let entry = bySubject.get(key);
			if (!entry) {
				const idField = this.idFields[q.namedGraph] ?? "id";
				entry = { ng: q.namedGraph, record: { [idField]: q.subject } };
				bySubject.set(key, entry);
			}
			entry.record[q.predicate] = q.object;
		}
		for (const ng of namedGraphs) {
			this.routing.set(ng, store);
		}
		for (const { ng, record } of bySubject.values()) {
			await store.upsertIndividual(ng, record);
		}
		this.quads = this.quads.filter((q) => !ngSet.has(q.namedGraph));
	}

	/**
	 * The inverse of registerStore: remove every graph routed to `store`. A backing's registration must not outlive
	 * it — the owner calls this when it closes its engine, and because the routing map is shared along the store
	 * chain, the registration disappears from every carried store at once.
	 */
	unregisterStore(store: IQuadStore): void {
		for (const [ng, s] of [...this.routing]) {
			if (s === store) this.routing.delete(ng);
		}
	}

	/**
	 * Scenario-boundary carry-over: copy every quad whose named graph is NOT the variables graph into the target
	 * store. Variables (SHARED_GRAPH) are re-projected by FeatureVariables from `world.shared.all()` with provenance
	 * properties rebuilt, so they're carried separately. Facts and observations live only in this in-memory store and
	 * would be lost when FeatureVariables creates a fresh QuadStore for the next scenario. Backing registrations are
	 * NOT copied — the routing map is shared by reference via the constructor.
	 */
	carryNonVariableQuadsTo(target: QuadStore): void {
		for (const q of this.quads) {
			if (q.namedGraph === SHARED_GRAPH) continue;
			target.quads.push({ ...q });
		}
	}

	private storeFor(namedGraph: string): IQuadStore | undefined {
		return this.routing.get(namedGraph);
	}

	private get allStores(): IQuadStore[] {
		return [...new Set(this.routing.values())];
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
			if (this.routing.has(namedGraph)) return Promise.resolve();
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

	/**
	 * Type-bounded snapshot. Every backing store owns its bounded clustered query
	 * (queried directly — the efficient SQL/Cypher path). Local quads held by this
	 * store are sampled per type in memory. No `all()`-then-slice fallback exists:
	 * a store that can't sample at the source is a bug, not a degraded mode.
	 */
	async getClusteredQuads(opts: TClusteredQuadsOpts): Promise<TClusteredQuads> {
		const requested = opts.types ? new Set(opts.types) : undefined;
		const allQuads: TQuad[] = [];
		const clustersByType = new Map<string, TCluster>();
		const mergeCluster = (c: TCluster) => {
			const existing = clustersByType.get(c.type);
			if (!existing) {
				clustersByType.set(c.type, { ...c, sampledSubjects: [...c.sampledSubjects], displayLabels: { ...c.displayLabels }, ...(c.sites ? { sites: { ...c.sites } } : {}) });
				return;
			}
			const merged = new Set(existing.sampledSubjects);
			for (const s of c.sampledSubjects) merged.add(s);
			existing.sampledSubjects = [...merged];
			existing.sampledCount = existing.sampledSubjects.length;
			existing.totalCount = Math.max(existing.totalCount, c.totalCount, existing.sampledCount);
			existing.omittedCount = Math.max(0, existing.totalCount - existing.sampledCount);
			existing.displayLabels = { ...existing.displayLabels, ...c.displayLabels };
			if (c.sites) existing.sites = { ...existing.sites, ...c.sites };
		};

		// Federated peers and REMOTE backing stores merge alongside local backing stores; each stamps its subjects with
		// its own site principal (TCluster.sites), so a merged cluster still says which site served each subject. Under
		// scope "own" (this instance's authoritative record) both are skipped — their records are the serving site's own.
		const own = opts.scope === "own";
		const backing = own ? this.allStores.filter((s) => !s.isRemote) : this.allStores;
		const peers = own ? [] : [...this.federated];
		const backingResults = await Promise.all([...backing.map((s) => s.getClusteredQuads(opts)), ...peers.map((f) => f.getClusteredQuads(opts))]);
		for (const r of backingResults) {
			allQuads.push(...r.quads);
			for (const c of r.clusters) mergeCluster(c);
		}

		const localQuads = requested ? this.quads.filter((q) => requested.has(q.namedGraph)) : [...this.quads];
		const localClustered = sliceQuadsPerType(localQuads, opts.perTypeLimit, allQuads);
		allQuads.push(...localClustered.quads);
		for (const c of localClustered.clusters) mergeCluster(c);

		allQuads.sort((a, b) => a.timestamp - b.timestamp);
		return { quads: allQuads, clusters: [...clustersByType.values()] };
	}

	// --- Individual operations: route to backing store or local emulation ---

	private idFields: Record<string, string> = {};
	private schemas: Record<string, import("zod").ZodType> = {};

	registerIndividualType(label: string, schema: import("zod").ZodType, idField: string): void {
		this.schemas[label] = schema;
		this.idFields[label] = idField;
	}

	async upsertIndividual(label: string, data: unknown): Promise<string> {
		const backing = this.storeFor(label);
		if (backing) return backing.upsertIndividual(label, data);
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

	async getIndividual<T = Record<string, unknown>>(label: string, id: string): Promise<T | undefined> {
		const backing = this.storeFor(label);
		if (backing) return backing.getIndividual<T>(label, id);
		const quads = await this.query({ subject: id, namedGraph: label });
		if (quads.length === 0) return undefined;
		const result: Record<string, unknown> = {};
		for (const q of quads) result[q.predicate] = q.object;
		return result as T;
	}

	async deleteIndividual(label: string, id: string): Promise<void> {
		const backing = this.storeFor(label);
		if (backing) return backing.deleteIndividual(label, id);
		await this.remove({ subject: id, namedGraph: label });
	}

	async queryIndividuals<T = Record<string, unknown>>(label: string, filters?: Record<string, unknown>, options?: { limit?: number; offset?: number }): Promise<T[]> {
		const backing = this.storeFor(label);
		if (backing) return backing.queryIndividuals<T>(label, filters, options);
		const allQuads = await this.query({ namedGraph: label });
		const subjects = [...new Set(allQuads.map((q) => q.subject))];
		let individuals: Record<string, unknown>[] = [];
		for (const subject of subjects) {
			const k = await this.getIndividual(label, subject);
			if (k) individuals.push(k);
		}
		if (filters) {
			for (const [key, value] of Object.entries(filters)) {
				individuals = individuals.filter((v) => v[key] === value);
			}
		}
		const offset = options?.offset ?? 0;
		const limit = options?.limit ?? individuals.length;
		return individuals.slice(offset, offset + limit) as T[];
	}

	async distinctPropertyValues(label: string, property: string): Promise<string[]> {
		const backing = this.storeFor(label);
		if (backing) return backing.distinctPropertyValues(label, property);
		const quads = await this.query({ predicate: property, namedGraph: label });
		return [...new Set(quads.map((q) => String(q.object)))].sort();
	}
}

/**
 * Group quads by namedGraph, keep up to `perTypeLimit` distinct subjects per
 * group, and emit a TCluster summary for each. `existingQuads` lets the caller
 * pass already-included subjects (from another store) so totals stay coherent
 * across merged sources.
 */
function sliceQuadsPerType(quads: TQuad[], perTypeLimit: number, existingQuads: TQuad[] = []): TClusteredQuads {
	const subjectsByType = new Map<string, Set<string>>();
	const sampledByType = new Map<string, Set<string>>();
	for (const q of existingQuads) {
		if (!sampledByType.has(q.namedGraph)) sampledByType.set(q.namedGraph, new Set());
		sampledByType.get(q.namedGraph)?.add(q.subject);
	}
	// Index local quads by subject, plus each Body's content — so labels compose the
	// same way every producer does (shortest linked-body preview, else id). The
	// in-memory path has no rels registry, so name/content resolution is unavailable
	// here; body-backed and id labels still come out identical to other producers.
	const quadsBySubject = new Map<string, TQuad[]>();
	const bodyContentBySubject = new Map<string, string>();
	for (const q of quads) {
		let arr = quadsBySubject.get(q.subject);
		if (!arr) {
			arr = [];
			quadsBySubject.set(q.subject, arr);
		}
		arr.push(q);
		if (!subjectsByType.has(q.namedGraph)) subjectsByType.set(q.namedGraph, new Set());
		subjectsByType.get(q.namedGraph)?.add(q.subject);
		if (q.namedGraph === BODY_LABEL && q.predicate === "content" && typeof q.object === "string") bodyContentBySubject.set(q.subject, q.object);
	}
	const sampledQuads: TQuad[] = [];
	const clusters: TCluster[] = [];
	for (const [type, subjectSet] of subjectsByType) {
		const subjects = [...subjectSet];
		const alreadySampled = sampledByType.get(type) ?? new Set<string>();
		const newSubjects = subjects.filter((s) => !alreadySampled.has(s));
		const remainingBudget = Math.max(0, perTypeLimit - alreadySampled.size);
		const keep = new Set([...alreadySampled, ...newSubjects.slice(0, remainingBudget)]);
		for (const q of quads) {
			if (q.namedGraph === type && keep.has(q.subject)) sampledQuads.push(q);
		}
		// Label only subjects this store actually holds — a subject sampled by another
		// store labels itself, and merging local labels over it would clobber its name.
		const displayLabels: Record<string, string> = {};
		for (const subject of keep) {
			if (!quadsBySubject.has(subject)) continue;
			displayLabels[subject] = displayLabelForQuads(type, subject, quadsBySubject.get(subject) ?? [], (b) => bodyContentBySubject.get(b), undefined);
		}
		clusters.push({
			type,
			totalCount: alreadySampled.size + subjects.length,
			sampledCount: keep.size,
			omittedCount: Math.max(0, alreadySampled.size + subjects.length - keep.size),
			sampledSubjects: [...keep],
			displayLabels,
		});
	}
	return { quads: sampledQuads, clusters };
}
