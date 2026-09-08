/**
 * QuadStore - In-memory quad store with optional backing store routing
 *
 * Stores quads as Subject-Predicate-Object-namedGraph with timestamps and optional properties.
 * Backing stores can be registered for specific named graphs — writes route to the owning store,
 * reads merge across all stores.
 * Methods return Promises (via Promise.resolve) to satisfy the async IQuadStore interface.
 *
 * What it is for: a run held in one process, a report holding a run's records, and tests. Every read of a type passes
 * once over every quad of that type and then narrows, so a limit bounds the answer rather than the work: a window, a
 * count and a read at an offset each cost the type's quads. That is the store's shape rather than a defect of a
 * caller, and it is why a run too large to hold in memory needs a store with an engine behind it, where the same reads
 * are answered from an index.
 */

import {
	SHARED_GRAPH,
	type IQuadStore,
	type TCluster,
	type TClusteredQuads,
	type TClusteredQuadsOpts,
	type TFederatedGraphSource,
	type TGraphQuery,
	type TGraphQueryResult,
	type TSearchCondition,
	type TQuad,
	type TQuadPattern,
	matchesQuadPattern,
	type TDensityQuery,
	type TDensityResult,
	type TQuadEdge,
	type TIndividualWithEdges,
} from "./quad-types.js";
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

	/** Upsert a batch as one act: each quad replaces any prior quad with the same subject, predicate and named graph, so
	 *  caching a batch keeps one row per fact rather than appending. The client's store does the same in one transaction. */
	async setMany(quads: TQuad[]): Promise<void> {
		for (const q of quads) await this.set(q.subject, q.predicate, q.object, q.namedGraph, q.properties);
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

	/**
	 * Create a navigable edge. A property-graph backing store materializes it as a real, walkable relationship; without
	 * such a backing the edge is modelled as a quad in the source's named graph (an edge a property-graph store would
	 * reject as a stray property is a plain quad here). Routing mirrors `add`/`set`/`query`, so a caller holding this
	 * store never needs to know whether a graph engine backs the source's named graph.
	 */
	createEdge(fromLabel: string, fromId: string, edgeLabel: string, toLabel: string, toId: string): Promise<void> {
		const backing = this.storeFor(fromLabel);
		if (backing?.createEdge) return backing.createEdge(fromLabel, fromId, edgeLabel, toLabel, toId);
		// objectType records the target's type, so the quad reads back as an edge rather than a literal property.
		return this.add({ subject: fromId, predicate: edgeLabel, object: toId, namedGraph: fromLabel, objectType: toLabel });
	}

	/**
	 * An edge to something that may not be here yet. A backing store that keeps edges strictly holds an id-only
	 * placeholder until the target arrives; without such a backing this is an ordinary edge, since a quad needs no
	 * target to exist. Routed like `createEdge`, so a caller writing a forward reference never needs to know which
	 * backing holds the source.
	 */
	referenceEdge(fromLabel: string, fromId: string, edgeLabel: string, toLabel: string, toId: string): Promise<void> {
		const backing = this.storeFor(fromLabel) as (IQuadStore & { referenceEdge?: IQuadStore["createEdge"] }) | undefined;
		if (backing?.referenceEdge) return backing.referenceEdge(fromLabel, fromId, edgeLabel, toLabel, toId);
		return this.createEdge(fromLabel, fromId, edgeLabel, toLabel, toId);
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
		return this.quads.filter((q) => matchesQuadPattern(q, pattern));
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
		this.quads = this.quads.filter((q) => !matchesQuadPattern(q, pattern));
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

	// async so a rejected identity reaches a caller's .catch like every other failure, rather than throwing
	// synchronously out of a method that returns a promise.
	async upsertIndividual(label: string, data: unknown): Promise<string> {
		const backing = this.storeFor(label);
		if (backing) return await backing.upsertIndividual(label, data);
		const schema = this.schemas[label];
		const validated = (schema ? schema.parse(data) : data) as Record<string, unknown>;
		const idField = this.idFields[label] ?? "id";
		// Read before stringifying: String(undefined) is "undefined", a truthy string, so the guard below it never fired
		// and the record was written under that literal subject, unreachable and overwritten by the next one.
		const identity = validated[idField];
		if (identity === undefined || identity === null || String(identity).trim() === "") throw new Error(`Missing identity field "${idField}" for ${label}`);
		const id = String(identity);
		// Atomic replace: no await between the remove and the adds, so a concurrent upsert (fire-and-forget writers), a
		// scenario-boundary carry, or a mid-flight backing registration never observes a half-written individual.
		this.quads = this.quads.filter((q) => !(q.subject === id && q.namedGraph === label));
		const timestamp = Date.now();
		for (const [key, value] of Object.entries(validated)) {
			if (value !== undefined && value !== null) this.quads.push({ subject: id, predicate: key, object: value, namedGraph: label, timestamp });
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
		// The graph's quads once, grouped by subject in one pass: reading each individual back by its own query scanned
		// every quad the store holds once per individual, so a read of a type cost its individuals times the store.
		let individuals = individualsFrom(await this.query({ namedGraph: label }));
		if (filters) {
			for (const [key, value] of Object.entries(filters)) {
				individuals = individuals.filter((v) => v[key] === value);
			}
		}
		const offset = options?.offset ?? 0;
		const limit = options?.limit ?? individuals.length;
		return individuals.slice(offset, offset + limit) as T[];
	}

	density(query: TDensityQuery): Promise<TDensityResult> {
		return densityOverQuadStore(this, query);
	}

	async distinctPropertyValues(label: string, property: string): Promise<string[]> {
		const backing = this.storeFor(label);
		if (backing) return backing.distinctPropertyValues(label, property);
		const quads = await this.query({ predicate: property, namedGraph: label });
		return [...new Set(quads.map((q) => String(q.object)))].sort();
	}
}

/**
 * The rows a graph query names, answered by a store that holds quads: one type at a time, equality filters, windowed.
 * A store with a query engine answers richer queries itself; this is what a store of quads can say, and it is the same
 * answer whether the store is the site's or the copy a page caches, which is why both ask it here.
 */
export async function queryQuadStore(store: IQuadStore, query: TGraphQuery): Promise<TGraphQueryResult> {
	const { label, limit, offset } = query;
	if (!label) throw new Error("a graph query over quads reads one type at a time, and this one names none");
	if (query.textQuery) throw new Error("a graph query over quads matches a type and equality filters; text search needs a store with a query engine");
	const vertices = await individualsMatching(store, label, query.filters);
	// The order a query asks for, applied before the window: a page of the newest is the newest of what matched, not the
	// first the store happened to return. A query naming no order takes the store's own.
	if (query.sortBy) {
		const by = query.sortBy;
		const direction = query.sortOrder === "asc" ? 1 : -1;
		vertices.sort((a, b) => direction * compare(a[by], b[by]));
	}
	const from = offset ?? 0;
	return { vertices: vertices.slice(from, from + (limit ?? vertices.length)), total: vertices.length };
}

/**
 * The individuals of a type that satisfy every condition, over a store that holds its records.
 *
 * The store matches equality itself; the comparisons are made here over the values it returned, which a store of quads
 * holds in full. Reading a range of time is a comparison, so answering only equality would have meant either a wrong
 * answer or no reading by time. Every read of such a store narrows this way, so it narrows in one place.
 */
async function individualsMatching(store: IQuadStore, label: string, filters: readonly TSearchCondition[]): Promise<Record<string, unknown>[]> {
	const equality = Object.fromEntries(filters.filter((f) => f.operator === "eq").map((f) => [f.predicate, f.value]));
	const compared = filters.filter((f) => f.operator !== "eq");
	const matched = await store.queryIndividuals<Record<string, unknown>>(label, Object.keys(equality).length ? equality : undefined, {});
	return matched.filter((individual) => compared.every((f) => satisfies(individual[f.predicate], f)));
}

/** The individuals a set of quads describes, each from its own quads, in the order their subjects first appear: one
 *  pass over the quads, whatever their number. What every store that holds its records as quads reads a type by. */
export function individualsFrom(quads: readonly TQuad[]): Record<string, unknown>[] {
	const bySubject = new Map<string, Record<string, unknown>>();
	for (const q of quads) {
		let record = bySubject.get(q.subject);
		if (!record) {
			record = {};
			bySubject.set(q.subject, record);
		}
		record[q.predicate] = q.object;
	}
	return [...bySubject.values()];
}

/**
 * Which bucket an instant falls in, over a span divided into a fixed number.
 *
 * The division is by the span rather than by a rounded width, so a span that does not divide evenly still answers with
 * exactly the buckets asked for; the last bucket includes the end, which nothing after it would otherwise hold.
 */
export function bucketOf(at: number, from: number, to: number, buckets: number): number {
	if (at < from || at > to) return -1;
	if (to === from) return 0;
	return Math.min(buckets - 1, Math.floor(((at - from) / (to - from)) * buckets));
}

/**
 * How many records fall in each division of a span, by how each turned out, over a store that holds its records.
 *
 * The one implementation both quad-backed stores answer with: an in-memory store and the store a page holds hold their
 * records, so counting them is reading what is already there. A store with a query engine counts in the engine.
 */
export async function densityOverQuadStore(store: IQuadStore, query: TDensityQuery): Promise<TDensityResult> {
	const from = Date.parse(query.from);
	const to = Date.parse(query.to);
	if (Number.isNaN(from) || Number.isNaN(to)) throw new Error(`a density read spans instants, and this one names ${query.from} to ${query.to}`);
	if (to < from) throw new Error(`a density read spans forward, and this one names ${query.from} to ${query.to}`);
	const buckets: Record<string, number>[] = Array.from({ length: query.buckets }, () => ({}));
	for (const individual of await individualsMatching(store, query.label, query.filters)) {
		const at = Date.parse(String(individual[query.timeField] ?? ""));
		if (Number.isNaN(at)) continue;
		const bucket = bucketOf(at, from, to, query.buckets);
		if (bucket < 0) continue;
		const group = individual[query.groupBy] === undefined || individual[query.groupBy] === null ? "" : String(individual[query.groupBy]);
		buckets[bucket][group] = (buckets[bucket][group] ?? 0) + 1;
	}
	return { buckets };
}

/** Two held values in order. Numbers compare as numbers where both are; anything else compares as text, which orders an
 *  ISO instant by time. A value a record does not hold sorts before one it does. */
function compare(a: unknown, b: unknown): number {
	if (a === undefined || a === null) return b === undefined || b === null ? 0 : -1;
	if (b === undefined || b === null) return 1;
	if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
	const [x, y] = [String(a), String(b)];
	return x < y ? -1 : x > y ? 1 : 0;
}

/** Whether a held value satisfies one condition. Numbers compare as numbers where both sides are numbers, and anything
 *  else compares as text, which orders an ISO instant by time. A value the record does not hold satisfies nothing. */
function satisfies(held: unknown, condition: TSearchCondition): boolean {
	if (held === undefined || held === null) return false;
	const order = (against: string): number => {
		const a = typeof held === "number" ? held : Number(held);
		const b = Number(against);
		if (!Number.isNaN(a) && !Number.isNaN(b) && typeof held !== "string") return a < b ? -1 : a > b ? 1 : 0;
		const text = String(held);
		return text < against ? -1 : text > against ? 1 : 0;
	};
	switch (condition.operator) {
		case "in":
			return (condition.values ?? [condition.value]).includes(String(held));
		case "contains":
			return String(held).includes(condition.value);
		case "gt":
			return order(condition.value) > 0;
		case "gte":
			return order(condition.value) >= 0;
		case "lt":
			return order(condition.value) < 0;
		case "lte":
			return order(condition.value) <= 0;
		case "between":
			if (condition.value2 === undefined) throw new Error(`a "between" condition on ${condition.predicate} names only one bound`);
			return order(condition.value) >= 0 && order(condition.value2) <= 0;
		default:
			throw new Error(`a graph query over quads does not answer the "${condition.operator}" condition on ${condition.predicate}`);
	}
}

/**
 * Group quads by namedGraph, keep up to `perTypeLimit` distinct subjects per
 * group, and emit a TCluster summary for each. `existingQuads` lets the caller
 * pass already-included subjects (from another store) so totals stay coherent
 * across merged sources.
 */
export function sliceQuadsPerType(quads: TQuad[], perTypeLimit: number, existingQuads: TQuad[] = []): TClusteredQuads {
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

/** The record a store holds for a node, stamped with the identity it was reached by, so an edge resolves to something a
 *  reader can open even where that node's own fields are not held. */
async function targetOf(store: IQuadStore, label: string, id: string): Promise<Record<string, unknown>> {
	return { "@id": id, "@type": label, ...((await store.getIndividual<Record<string, unknown>>(label, id)) ?? {}) };
}

/** How many edges pointing at one individual are read as records at a time. A hub has more edges than a reader reads,
 *  and each edge read is a read of the record it names, so a reading takes a page of them and says how many there are. */
export const INCOMING_EDGE_PAGE = 100;

/** The edges pointing at an individual, over any store: how many there are, and the page of them asked for, each read
 *  as the record it names. A quad pointing at the individual carries the type of the record it comes from, which is how
 *  that record resolves rather than a bare id. */
export async function incomingEdgesOf(store: IQuadStore, id: string, page: { offset?: number; limit?: number } = {}): Promise<{ edges: TQuadEdge[]; total: number }> {
	const pointing = (await store.query({ object: id })).filter((quad) => quad.objectType);
	const offset = page.offset ?? 0;
	const read = pointing.slice(offset, offset + (page.limit ?? INCOMING_EDGE_PAGE));
	const edges = await Promise.all(read.map(async (quad) => ({ type: quad.predicate, direction: "in" as const, target: await targetOf(store, quad.namedGraph, quad.subject) })));
	return { edges, total: pointing.length };
}

/**
 * One individual with its edges, over any store: its own fields, the edges its quads name in both directions, and how
 * many edges point at it. An edge quad carries the type of the record it names. That type is how a target resolves to a
 * record rather than to a bare id. Undefined where the store holds nothing of the individual.
 *
 * One reading, so a page reading what it holds and a site answering for its own store give a reader the same shape.
 */
export async function individualWithEdges(store: IQuadStore, label: string, id: string): Promise<TIndividualWithEdges | undefined> {
	const quads = await store.query({ subject: id, namedGraph: label });
	if (quads.length === 0) return undefined;
	const vertex: Record<string, unknown> = { "@id": id, "@type": label };
	const named = quads.filter((quad) => quad.objectType);
	for (const quad of quads) if (!quad.objectType) vertex[quad.predicate] = quad.object;
	// Every target read at once: a record with many edges is one round of reads rather than one round per edge.
	const [outgoing, incoming] = await Promise.all([
		Promise.all(named.map(async (quad) => ({ type: quad.predicate, direction: "out" as const, target: await targetOf(store, String(quad.objectType), String(quad.object)) }))),
		incomingEdgesOf(store, id),
	]);
	return { vertex, edges: [...outgoing, ...incoming.edges], incomingCount: incoming.total };
}
