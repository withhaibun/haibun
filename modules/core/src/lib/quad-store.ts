/**
 * QuadStore - In-memory quad store with optional backing store routing
 *
 * Stores quads as Subject-Predicate-Object-namedGraph with timestamps and optional properties.
 * Backing stores can be registered for specific named graphs, writes route to the owning store,
 * reads merge across all stores.
 * Methods return Promises (via Promise.resolve) to satisfy the async IQuadStore interface.
 *
 * What it is for: a run held in one process, a report holding a run's records, and tests. Every read of a type passes
 * once over every quad of that type and then narrows, so a limit bounds the answer rather than the work: a window, a
 * count and a read at an offset each take the type's quads. That is the store's shape rather than a defect of a
 * caller, and it is why a run too large to hold in memory needs a store with an engine behind it, where the same reads
 * are answered from an index.
 */

import { RecordSchema } from "./json-text.js";
import { itemAt } from "./util/item-at.js";
import {
	SHARED_GRAPH,
	type IQuadStore,
	type TCluster,
	type TClusteredQuads,
	type TClusteredQuadsOpts,
	type TFederatedGraphSource,
	type TGraphQuery,
	type TQuad,
	type TQuadPattern,
	matchesQuadPattern,
	type TDensityQuery,
	type TDensityResult,
	type TDistinctValues,
	type TStoreLevels,
	type TRecordsPage,
} from "./quad-types.js";
import { displayLabelForQuads, type TTitledBy } from "./hypermedia.js";
import { AccessLevelSchema, BODY_LABEL, HELD_BY, LinkRelations, withinAccess, type AccessLevel } from "./resources.js";
import { seenAt, writesAtEveryLevel, writtenAt } from "./actions.js";
import { distinctOf, readFromRecords, recordsOfQuads, type THeldRecord, type TReadDeclarations } from "./records/derivations/read-records.js";
import { quadsOfRead, readEvery, type TRecordReader } from "./records/pipelines/record-reads.js";

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
	 * Federated peers, consulted ONLY by getClusteredQuads, reads-first federation joins at the one read
	 * surface a peer serves (bounded, accessLevel-gated), never the routing map (which owns writes and raw
	 * queries). Shared by reference along the store chain for the same reason as `routing`.
	 */
	private federated: Set<TFederatedGraphSource>;

	/** What classifies what this store writes and bounds what it reads, for the call in progress. A store that isn't given one holds
	 *  a copy of what a site served, which was bounded where it was served, and doesn't classify a record. */
	private levels: TStoreLevels | undefined;

	/** Returns the declarations of the types this store's own layer reads. A store without them doesn't read its layer by type. */
	private declarations: (() => TReadDeclarations) | undefined;

	/** Reads the records core derives from the declarations: each type whose declaration states `heldBy: declarations`. */
	private derived: TRecordReader | undefined;

	constructor(routing?: Map<string, IQuadStore>, federated?: Set<TFederatedGraphSource>, levels?: TStoreLevels, declarations?: () => TReadDeclarations, derived?: TRecordReader) {
		this.routing = routing ?? new Map();
		this.federated = federated ?? new Set();
		this.levels = levels;
		this.declarations = declarations;
		this.derived = derived;
	}

	/** Returns the reader of derived records where core derives a type's records from the declarations and this store holds
	 *  that reader. A store without the reader holds the records it was given, as a page holds a copy of what a site served. */
	private derivedReaderOf(label: string): TRecordReader | undefined {
		return this.derived && this.declarations?.().of(label)?.heldBy === HELD_BY.declarations ? this.derived : undefined;
	}

	/** Throws for a write of a type whose records this store derives from the declarations. */
	private refuseDerived(label: string): void {
		if (this.derivedReaderOf(label))
			throw new Error(`${label} records are derived from the declarations, so a write of a ${label} record is rejected. Change the declaration of the type it describes.`);
	}

	/** Returns what reads a type's records: the reader of derived records, or the backing store registered for it. */
	private readerOf(label: string): TRecordReader | undefined {
		return this.derivedReaderOf(label) ?? this.storeFor(label);
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
	 * Drop every connection to another instance, federated read sources and remote backing stores. Their lifetime is
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
		// A store that refuses a record this one holds isn't registered: this one keeps every record it holds, so the
		// next write of one of them reads it here, and the caller is given the store's refusal.
		try {
			for (const { ng, record } of bySubject.values()) {
				await store.upsertIndividual(ng, record);
			}
		} catch (err) {
			this.unregisterStore(store);
			throw err;
		}
		this.quads = this.quads.filter((q) => !ngSet.has(q.namedGraph));
	}

	/**
	 * The inverse of registerStore: remove every graph routed to `store`. A backing's registration must not outlive
	 * it: the owner calls this when it closes its engine, and because the routing map is shared along the store
	 * chain, the registration disappears from every carried store at once.
	 */
	unregisterStore(store: IQuadStore): void {
		for (const [ng, s] of [...this.routing]) {
			if (s === store) this.routing.delete(ng);
		}
	}

	/**
	 * Copies every quad of this store's own layer into the target store, except the variables. FeatureVariables writes the
	 * variables of the next scope from the ones it carries, with the steps that set each. The facts are held only in this
	 * layer, so the next scenario's store holds them through this copy. The routing map is shared by reference through
	 * the constructor, so a backing registration isn't copied.
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
		for (const { timestamp: _, ...q } of quads) await this.setQuad(q);
	}

	set(subject: string, predicate: string, object: unknown, namedGraph: string, properties?: Record<string, unknown>): Promise<void> {
		return this.setQuad({ subject, predicate, object, namedGraph, ...(properties ? { properties } : {}) });
	}

	// async, as every write here is, so a refused level reaches a caller's .catch rather than throwing out of a method that
	// returns a promise.
	private async setQuad(quad: Omit<TQuad, "timestamp">): Promise<void> {
		this.refuseDerived(quad.namedGraph);
		const backing = this.storeFor(quad.namedGraph);
		if (backing) return await backing.set(quad.subject, quad.predicate, quad.object, quad.namedGraph, quad.properties);
		const classified = this.classified(quad);
		this.quads = this.quads.filter((q) => !(q.subject === quad.subject && q.predicate === quad.predicate && q.namedGraph === quad.namedGraph));
		this.quads.push({ ...classified, timestamp: Date.now() });
	}

	/**
	 * A quad as this store holds it: at the level `writtenAt` decides, as every store writes. A quad about a subject this
	 * store already holds is written into that subject, and states its level; a quad about a new one takes the level its
	 * type declares, where the writer may write there.
	 */
	private classified(quad: Omit<TQuad, "timestamp">): Omit<TQuad, "timestamp"> {
		if (!this.levels) return quad;
		const held = this.quads.find((q) => q.subject === quad.subject && q.namedGraph === quad.namedGraph)?.accessLevel;
		const accessLevel = writtenAt(quad.accessLevel ?? held, this.levels.declared(quad.namedGraph), this.levels.writeBound());
		return { ...quad, accessLevel };
	}

	/** Whether a read at `asked` returns a quad this store holds, by the rule of every store. A read that doesn't state a
	 *  level reads at the caller's ceiling, and the instance's own read returns every level. */
	private seen(asked: AccessLevel | undefined): (q: TQuad) => boolean {
		if (!this.levels) return () => true;
		const { ceiling } = this.levels.bound();
		const level = asked === undefined ? ceiling : seenAt(asked, ceiling);
		if (level === undefined) return () => true;
		return (q) => withinAccess(q.accessLevel, level);
	}

	/** Refuse removing a quad the caller may not write at: removing a fact is written into its subject, as adding one is. */
	private removable(quads: TQuad[]): TQuad[] {
		const bound = this.levels?.writeBound();
		if (bound && !writesAtEveryLevel(bound)) for (const q of quads) if (q.accessLevel) writtenAt(q.accessLevel, undefined, bound);
		return quads;
	}

	get(subject: string, predicate: string, namedGraph?: string): Promise<unknown | undefined> {
		if (namedGraph) {
			const backing = this.storeFor(namedGraph);
			if (backing) return backing.get(subject, predicate, namedGraph);
		}
		// Search local first
		const seen = this.seen(undefined);
		for (let i = this.quads.length - 1; i >= 0; i--) {
			const q = itemAt(this.quads, i);
			if (q.subject === subject && q.predicate === predicate && (namedGraph === undefined || q.namedGraph === namedGraph) && seen(q)) return Promise.resolve(q.object);
		}
		// Then search backing stores if the query doesn't filter by namedGraph
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

	async add(quad: Omit<TQuad, "timestamp">): Promise<void> {
		this.refuseDerived(quad.namedGraph);
		const backing = this.storeFor(quad.namedGraph);
		if (backing) return await backing.add(quad);
		this.quads.push({ ...this.classified(quad), timestamp: Date.now() });
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
	 * placeholder until the target arrives; without such a backing this is an ordinary edge, since a quad doesn't need the
	 * target to exist. Routed like `createEdge`, so a caller writing a forward reference never needs to know which
	 * backing holds the source.
	 */
	referenceEdge(fromLabel: string, fromId: string, edgeLabel: string, toLabel: string, toId: string): Promise<void> {
		const backing = this.storeFor(fromLabel);
		if (backing?.referenceEdge) return backing.referenceEdge(fromLabel, fromId, edgeLabel, toLabel, toId);
		return this.createEdge(fromLabel, fromId, edgeLabel, toLabel, toId);
	}

	async query(pattern: TQuadPattern): Promise<TQuad[]> {
		if (pattern.namedGraph) {
			const backing = this.storeFor(pattern.namedGraph);
			if (backing) return backing.query(pattern);
			return this.localQuery(pattern);
		}
		// The query doesn't filter by namedGraph: merge local + all backing stores
		const local = this.localQuery(pattern);
		const backingResults = await Promise.all(this.allStores.map((s) => s.query(pattern)));
		return [...local, ...backingResults.flat()].sort((a, b) => a.timestamp - b.timestamp);
	}

	private localQuery(pattern: TQuadPattern): TQuad[] {
		const seen = this.seen(undefined);
		return this.quads.filter((q) => matchesQuadPattern(q, pattern) && seen(q));
	}

	// biome-ignore lint/suspicious/useAwait: a write, so a refused level rejects rather than throws, as setQuad states
	async clear(namedGraph?: string): Promise<void> {
		if (namedGraph) {
			// Don't clear persistent backing stores, only clear ephemeral (local) data
			if (this.routing.has(namedGraph)) return;
			const cleared = new Set(this.removable(this.quads.filter((q) => q.namedGraph === namedGraph)));
			this.quads = this.quads.filter((q) => !cleared.has(q));
		} else {
			// Clear ephemeral only
			this.removable(this.quads);
			this.quads = [];
		}
	}

	async remove(pattern: TQuadPattern): Promise<void> {
		if (pattern.namedGraph) {
			this.refuseDerived(pattern.namedGraph);
			const backing = this.storeFor(pattern.namedGraph);
			if (backing) return await backing.remove(pattern);
		}
		const removed = new Set(this.removable(this.quads.filter((q) => matchesQuadPattern(q, pattern))));
		this.quads = this.quads.filter((q) => !removed.has(q));
	}

	async all(): Promise<TQuad[]> {
		const local = this.quads.filter(this.seen(undefined));
		const backingResults = await Promise.all(this.allStores.map((s) => s.all()));
		return [...local, ...backingResults.flat()].sort((a, b) => a.timestamp - b.timestamp);
	}

	/**
	 * Reads a page from the store that holds the read's records: the store of its label, of the record a reference read
	 * names, the reader of the records core derives from the declarations, or the one store that holds every type a term
	 * reads. Throws for a term whose types more than one store holds. This store's own layer reads through
	 * `readFromRecords`, which doesn't search text. A read of the records one of its records references reads each
	 * record that another store holds from that store.
	 */
	async readRecords(query: TGraphQuery): Promise<TRecordsPage> {
		const routed = this.routeOf(query);
		if (routed) return await routed.readRecords(query);
		const declarations = this.declarations;
		if (!declarations) throw new Error("this store doesn't hold the declarations of its types, so it doesn't read records by type");
		const held = recordsOfQuads(await quadsOfRead(query, (pattern) => Promise.resolve(this.localQuery(pattern))));
		const elsewhere = query.referencedBy ? await this.referencedElsewhere(held, query) : [];
		return readFromRecords([...held, ...elsewhere], query, declarations());
	}

	/**
	 * Reads the records that a record of this store's own layer references and another store holds, from that store, at the
	 * read's level. Throws where that store returns a record without its id field.
	 */
	private async referencedElsewhere(held: readonly THeldRecord[], query: TGraphQuery): Promise<THeldRecord[]> {
		const { referencedBy, accessLevel } = query;
		if (!referencedBy) return [];
		const source = held.find((record) => record.label === referencedBy.label && record.id === referencedBy.id);
		const named = new Map<string, Set<string>>();
		for (const edge of source?.edges ?? []) {
			if (referencedBy.via && !referencedBy.via.includes(edge.rel)) continue;
			if (this.readerOf(edge.label) === undefined) continue;
			named.set(edge.label, (named.get(edge.label) ?? new Set()).add(edge.id));
		}
		const read = await Promise.all(
			[...named].map(async ([label, ids]) => {
				const reader = this.readerOf(label);
				if (!reader) throw new Error(`the store that holds ${label} records was removed during the read`);
				const idField = this.declarations?.().of(label)?.id;
				if (!idField) throw new Error(`${label} isn't a declared type, so a record it names can't be read by its id`);
				const vertices = await readEvery(reader, { label, named: [...ids], ...(accessLevel ? { accessLevel } : {}) });
				return vertices.map(({ "@id": _iri, "@type": _type, ...fields }): THeldRecord => {
					const id = fields[idField];
					if (typeof id !== "string" && typeof id !== "number") throw new Error(`a ${label} record read from another store doesn't state its id field ${idField}`);
					return { id: String(id), label, fields, edges: [], level: fields[LinkRelations.ACCESS_LEVEL.rel] };
				});
			}),
		);
		return read.flat();
	}

	/** Returns the store or reader that holds a read's records, or undefined where this store's own layer holds them. */
	private routeOf(query: TGraphQuery): TRecordReader | undefined {
		const label = query.label ?? query.references?.label ?? query.referencedBy?.label;
		if (label !== undefined) return this.readerOf(label);
		if (query.textQuery === undefined) return undefined;
		const stores = query.types ? [...new Set(query.types.map((type) => this.storeFor(type)))] : this.allStores;
		if (stores.length > 1)
			throw new Error(
				`a term reads the types of one store, and ${query.types ? `the types ${query.types.join(", ")}` : "the types this store routes"} are held by ${stores.length} stores: name the types of one store in types`,
			);
		return stores[0];
	}

	/**
	 * Type-bounded snapshot. Every backing store owns its bounded clustered query
	 * (queried directly: the efficient SQL/Cypher path). Local quads held by this
	 * store are sampled per type in memory. An `all()`-then-slice fallback doesn't exist:
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
			if (c.saturated) existing.saturated = true;
			if (c.sites) existing.sites = { ...existing.sites, ...c.sites };
		};

		// Federated peers and REMOTE backing stores merge alongside local backing stores; each stamps its subjects with
		// its own site principal (TCluster.sites), so a merged cluster still states which site served each subject. Under
		// scope "own" (this instance's authoritative record) both are skipped, their records are the serving site's own.
		const own = opts.scope === "own";
		const backing = own ? this.allStores.filter((s) => !s.isRemote) : this.allStores;
		const peers = own ? [] : [...this.federated];
		const backingResults = await Promise.all([...backing.map((s) => s.getClusteredQuads(opts)), ...peers.map((f) => f.getClusteredQuads(opts))]);
		for (const r of backingResults) {
			allQuads.push(...r.quads);
			for (const c of r.clusters) mergeCluster(c);
		}

		const seen = this.seen(opts.accessLevel);
		const localQuads = this.quads.filter((q) => (!requested || requested.has(q.namedGraph)) && seen(q));
		const localClustered = sliceQuadsPerType(localQuads, opts.perTypeLimit, allQuads, (type) => this.declarations?.().of(type)?.title);
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
		this.refuseDerived(label);
		const backing = this.storeFor(label);
		if (backing) return await backing.upsertIndividual(label, data);
		const schema = this.schemas[label];
		const validated = RecordSchema.parse(schema ? schema.parse(data) : data);
		const idField = this.idFields[label] ?? this.declarations?.().of(label)?.id ?? "id";
		// Read before stringifying: String(undefined) is "undefined", a truthy string, so the guard below it never fired
		// and the record was written under that literal subject, unreachable and overwritten by the next one.
		const identity = validated[idField];
		if (identity === undefined || identity === null || String(identity).trim() === "") throw new Error(`Missing identity field "${idField}" for ${label}`);
		const id = String(identity);
		// A record states its level, as every persisted type's record does, and each of its quads is held at that level.
		const declared = this.levels?.declared(label);
		const stated = validated.accessLevel === undefined ? undefined : AccessLevelSchema.parse(validated.accessLevel);
		const accessLevel = this.levels ? writtenAt(stated, declared, this.levels.writeBound()) : stated;
		if (declared) validated.accessLevel = accessLevel;
		// Atomic replace: the code doesn't await between the remove and the adds, so a concurrent upsert (fire-and-forget writers), a
		// scenario-boundary carry, or a mid-flight backing registration never observes a half-written individual.
		this.quads = this.quads.filter((q) => !(q.subject === id && q.namedGraph === label));
		const timestamp = Date.now();
		for (const [key, value] of Object.entries(validated)) {
			if (value !== undefined && value !== null)
				this.quads.push({ subject: id, predicate: key, object: value, namedGraph: label, timestamp, ...(accessLevel ? { accessLevel } : {}) });
		}
		return id;
	}

	async deleteIndividual(label: string, id: string): Promise<void> {
		this.refuseDerived(label);
		const backing = this.storeFor(label);
		if (backing) return backing.deleteIndividual(label, id);
		await this.remove({ subject: id, namedGraph: label });
	}

	density(query: TDensityQuery): Promise<TDensityResult> {
		return densityOverQuadStore(this, query);
	}

	async distinctPropertyValues(label: string, property: string): Promise<TDistinctValues> {
		const backing = this.storeFor(label);
		if (backing) return backing.distinctPropertyValues(label, property);
		const quads = await this.query({ predicate: property, namedGraph: label });
		return distinctOf(quads.map((q) => String(q.object)));
	}
}

/**
 * Which bucket an instant falls in, over a span divided into a fixed number.
 *
 * The division is by the span rather than by a rounded width, so a span that does not divide evenly still answers with
 * exactly the buckets asked for; the last bucket includes the end, since a bucket after it doesn't exist to hold it.
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
	for (const individual of await readEvery(store, { label: query.label, filters: query.filters })) {
		const at = Date.parse(String(individual[query.timeField] ?? ""));
		if (Number.isNaN(at)) continue;
		const bucket = bucketOf(at, from, to, query.buckets);
		if (bucket < 0) continue;
		const group = individual[query.groupBy] === undefined || individual[query.groupBy] === null ? "" : String(individual[query.groupBy]);
		const counts = itemAt(buckets, bucket);
		counts[group] = (counts[group] ?? 0) + 1;
	}
	return { buckets };
}

/**
 * Group quads by namedGraph, keep up to `perTypeLimit` distinct subjects per
 * group, and emit a TCluster summary for each. `existingQuads` lets the caller
 * pass already-included subjects (from another store) so totals stay coherent
 * across merged sources. `titledBy` returns the property or edge that titles a
 * type's records, where the type declares one.
 */
export function sliceQuadsPerType(
	quads: TQuad[],
	perTypeLimit: number,
	existingQuads: TQuad[] = [],
	titledBy: (type: string) => TTitledBy | undefined = () => undefined,
): TClusteredQuads {
	const subjectsByType = new Map<string, Set<string>>();
	const sampledByType = new Map<string, Set<string>>();
	for (const q of existingQuads) {
		if (!sampledByType.has(q.namedGraph)) sampledByType.set(q.namedGraph, new Set());
		sampledByType.get(q.namedGraph)?.add(q.subject);
	}
	// Index local quads by subject, plus each Body's content, so labels compose the
	// same way every producer does (declared title, shortest linked-body preview, else id).
	// The in-memory path doesn't have a rels registry, so a name or content rel doesn't
	// title a record here.
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
		if (q.namedGraph === BODY_LABEL && q.predicate === LinkRelations.CONTENT.rel && typeof q.object === "string") bodyContentBySubject.set(q.subject, q.object);
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
		// Label only subjects this store holds: a subject sampled by another
		// store labels itself, and merging local labels over it would clobber its name.
		const displayLabels: Record<string, string> = {};
		for (const subject of keep) {
			if (!quadsBySubject.has(subject)) continue;
			displayLabels[subject] = displayLabelForQuads(type, subject, quadsBySubject.get(subject) ?? [], (b) => bodyContentBySubject.get(b), undefined, titledBy(type));
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
