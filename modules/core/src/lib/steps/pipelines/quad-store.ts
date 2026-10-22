/**
 * The in-memory store of quads, which routes each named graph to a backing store where one is registered for it. A write
 * reaches the store that holds its named graph, and a read merges this store's own layer with every backing store's.
 *
 * It holds actuality in one process, a report's records and a test's records. Its own layer is indexed by graph, by
 * subject and by predicate, so a write, a read of a subject and a read of a predicate read only those quads. A read of
 * a type's records reads every quad of that type and then narrows, so a limit bounds the result rather than the work. A
 * store with a query engine behind it reads the same records from an index, and actuality too large to hold in memory
 * reads its records through such a store.
 */
import { RecordSchema } from "../../domains/json-text.js";
import { itemAt } from "../../domains/item-at.js";
import {
	SHARED_GRAPH,
	matchesQuadPattern,
	type TCluster,
	type TClusteredQuads,
	type TClusteredQuadsOpts,
	type TDensityQuery,
	type TDensityResult,
	type TDistinctValues,
	type TGraphQuery,
	type TQuad,
	type TQuadPattern,
	type TRecordsPage,
} from "../domains/quad-types.js";
import type { IQuadStore, TFederatedGraphSource, TStoreLevels } from "../ports.js";
import { AccessLevelSchema, HELD_BY, LinkRelations, withinAccess, type AccessLevel } from "../../domains/resources.js";
import { seenAt, writesAtEveryLevel, writtenAt } from "../../domains/actions.js";
import { distinctOf, readFromRecords, recordsOfQuads, type THeldRecord, type TReadDeclarations } from "../../records/derivations/read-records.js";
import { quadsOfRead, readEvery, type TRecordReader } from "../../records/pipelines/record-reads.js";
import { QuadLayer } from "../../records/machines/quad-layer.js";
import { bucketOf, sliceQuadsPerType } from "../derivations/quad-sample.js";

/**
 * The backing stores and federated peers that a chain of stores shares by reference. Each store of a scenario and a
 * feature is built with its predecessor's chain, so a registration exists in one place and its removal removes it from
 * every store of the chain at once. A copy per store let a registration outlive its engine: a closed engine's store
 * stayed registered in an earlier copy and the next feature's reads read it.
 */
export type TStoreChain = {
	/** Each named graph's backing store. It holds the store's writes and pattern reads. */
	routing: Map<string, IQuadStore>;
	/** The federated peers, which only getClusteredQuads reads: a peer serves its sample within an access level, and doesn't
	 *  serve a write or a pattern read. */
	federated: Set<TFederatedGraphSource>;
};

/** A chain of stores without a backing store or a federated peer. The first store of actuality starts one. */
export const newStoreChain = (): TStoreChain => ({ routing: new Map(), federated: new Set() });

/** The field that identifies a record of a type the store's declarations don't name. */
const UNDECLARED_ID_FIELD = "id";

export class QuadStore implements IQuadStore {
	private readonly quads = new QuadLayer();

	/**
	 * `chain` holds the backing stores and peers this store shares with its chain. `levels` classifies what this store writes
	 * and bounds what it reads for the call in progress; a store without levels holds a copy of what a site served, which
	 * was bounded where it was served, and doesn't classify a record. `declarations` returns the declarations of the types
	 * this store's own layer reads; a store without them doesn't read its layer by type. `derived` reads the records core
	 * derives from the declarations: each type whose declaration states `heldBy: declarations`.
	 */
	constructor(
		private readonly chain: TStoreChain,
		private readonly levels?: TStoreLevels,
		private readonly declarations?: () => TReadDeclarations,
		private readonly derived?: TRecordReader,
	) {}

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

	/** The field that identifies a record of a type: the one its declaration states, or `id` for a type it doesn't declare. */
	private idFieldOf(label: string): string {
		const declared = this.declarations?.().of(label)?.id;
		return declared === undefined ? UNDECLARED_ID_FIELD : declared;
	}

	/** The named graphs of the quads this store's own layer holds. A backing store's graphs aren't read. */
	ownGraphs(): string[] {
		return this.quads.graphs();
	}

	/** The chain this store shares. The next store of the chain is built with it. */
	storeChain(): TStoreChain {
		return this.chain;
	}

	/** Merges a federated peer's clustered reads into this store's graph view. `unfederate` reverses it. */
	federate(source: TFederatedGraphSource): void {
		for (const f of this.chain.federated) {
			if (f.site === source.site) throw new Error(`a source for site ${source.site} is already federated; unfederate it before federating another`);
		}
		this.chain.federated.add(source);
	}

	unfederate(source: TFederatedGraphSource): void {
		this.chain.federated.delete(source);
	}

	/**
	 * Removes every connection to another instance: each federated peer and each remote backing store. A connection lasts
	 * as long as its peer, so a peer torn down as a feature ends doesn't leave a registration that the next feature's reads
	 * read at a closed port. A local backing store, such as an engine this instance owns, stays registered.
	 */
	dropRemoteConnections(): void {
		this.chain.federated.clear();
		for (const [ng, store] of [...this.chain.routing]) if (store.isRemote) this.chain.routing.delete(ng);
	}

	/** Registers a backing store for named graphs. A write of those graphs reaches it, and a read merges it. The quads this
	 *  store's own layer holds of those graphs move into the backing store as whole records, so a later write reads them there. */
	async registerStore(store: IQuadStore, namedGraphs: string[]): Promise<void> {
		const bySubject = new Map<string, { ng: string; record: Record<string, unknown> }>();
		for (const ng of namedGraphs)
			for (const q of this.quads.ofGraph(ng)) {
				const key = `${ng}\u0000${q.subject}`;
				const entry = bySubject.get(key);
				if (entry === undefined) bySubject.set(key, { ng, record: { [this.idFieldOf(ng)]: q.subject, [q.predicate]: q.object } });
				else entry.record[q.predicate] = q.object;
			}
		for (const ng of namedGraphs) this.chain.routing.set(ng, store);
		// A store that refuses a record this one holds isn't registered: this one keeps every record it holds, so the
		// next write of one of them reads it here, and the caller receives the store's refusal.
		try {
			for (const { ng, record } of bySubject.values()) await store.upsertIndividual(ng, record);
		} catch (err) {
			this.unregisterStore(store);
			throw err;
		}
		for (const ng of namedGraphs) this.quads.removeWhere(this.quads.ofGraph(ng), () => true);
	}

	/**
	 * Removes every graph routed to `store`, the inverse of registerStore. The owner calls this when it closes its engine,
	 * and because the chain shares its routing, the registration leaves every store of the chain at once.
	 */
	unregisterStore(store: IQuadStore): void {
		for (const [ng, s] of [...this.chain.routing]) {
			if (s === store) this.chain.routing.delete(ng);
		}
	}

	/**
	 * Copies every quad of this store's own layer into the target store, except the variables. FeatureVariables writes the
	 * variables of the next scope from the ones it carries, with the steps that set each. The facts are held only in this
	 * layer, so the next scenario's store holds them through this copy. The chain is shared through the constructor, so a
	 * backing registration isn't copied.
	 */
	carryNonVariableQuadsTo(target: QuadStore): void {
		for (const q of this.quads) {
			if (q.namedGraph === SHARED_GRAPH) continue;
			target.quads.add({ ...q });
		}
	}

	private storeFor(namedGraph: string): IQuadStore | undefined {
		return this.chain.routing.get(namedGraph);
	}

	private get allStores(): IQuadStore[] {
		return [...new Set(this.chain.routing.values())];
	}

	/** Writes a batch as one act: each quad replaces any prior quad with the same subject, predicate and named graph, so
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
		this.quads.removeWhere(this.quads.ofSubject(quad.namedGraph, quad.subject), (q) => q.predicate === quad.predicate);
		this.quads.add({ ...classified, timestamp: Date.now() });
	}

	/**
	 * A quad as this store holds it: at the level `writtenAt` determines, as every store writes. A quad about a subject
	 * this store already holds is written into that subject, and states its level; a quad about a new one takes the level
	 * its type declares, where the writer may write there.
	 */
	private classified(quad: Omit<TQuad, "timestamp">): Omit<TQuad, "timestamp"> {
		if (!this.levels) return quad;
		const [first] = this.quads.ofSubject(quad.namedGraph, quad.subject);
		const accessLevel = writtenAt(quad.accessLevel === undefined ? first?.accessLevel : quad.accessLevel, this.levels.declared(quad.namedGraph), this.levels.writeBound());
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

	/** Refuses the removal of a quad the caller may not write at: removing a fact is written into its subject, as adding one is. */
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
		// This store's own layer is read first, through the index of the subject or of the predicate, the most recent quad first.
		const seen = this.seen(undefined);
		const candidates = [...this.quads.candidates({ subject, predicate, ...(namedGraph === undefined ? {} : { namedGraph }) })];
		for (let i = candidates.length - 1; i >= 0; i--) {
			const q = itemAt(candidates, i);
			if (q.subject === subject && q.predicate === predicate && seen(q)) return Promise.resolve(q.object);
		}
		// A read that doesn't name a graph then reads each backing store.
		return namedGraph === undefined ? this.getFromBackingStores(subject, predicate) : Promise.resolve(undefined);
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
		this.quads.add({ ...this.classified(quad), timestamp: Date.now() });
	}

	/**
	 * Writes an edge. A backing store with a graph engine writes it as a relationship a query walks. Without such a
	 * backing store the edge is a quad in the source's named graph. The edge is routed as `add`, `set` and `query` are, so a
	 * caller writes it the same way whether a graph engine holds the source's named graph or not.
	 */
	createEdge(fromLabel: string, fromId: string, edgeLabel: string, toLabel: string, toId: string): Promise<void> {
		const backing = this.storeFor(fromLabel);
		if (backing?.createEdge) return backing.createEdge(fromLabel, fromId, edgeLabel, toLabel, toId);
		// objectType states the target's type, so the quad reads back as an edge rather than a literal property.
		return this.add({ subject: fromId, predicate: edgeLabel, object: toId, namedGraph: fromLabel, objectType: toLabel });
	}

	/**
	 * Writes an edge to a target that the store may not hold yet. A backing store that keeps edges strictly holds a
	 * reference with the target's id until the target is written. Without such a backing store this is an ordinary edge,
	 * since a quad doesn't require its target. It is routed as `createEdge` is.
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
		// A query that doesn't name a graph merges this store's own layer and every backing store.
		const local = this.localQuery(pattern);
		const backingResults = await Promise.all(this.allStores.map((s) => s.query(pattern)));
		return [...local, ...backingResults.flat()].sort((a, b) => a.timestamp - b.timestamp);
	}

	private localQuery(pattern: TQuadPattern): TQuad[] {
		const seen = this.seen(undefined);
		return [...this.quads.candidates(pattern)].filter((q) => matchesQuadPattern(q, pattern) && seen(q));
	}

	// biome-ignore lint/suspicious/useAwait: a write, so a refused level rejects rather than throws, as setQuad states
	async clear(namedGraph?: string): Promise<void> {
		if (namedGraph) {
			// A backing store holds what persists, so a clear removes only what this store's own layer holds.
			if (this.chain.routing.has(namedGraph)) return;
			for (const q of this.removable([...this.quads.ofGraph(namedGraph)])) this.quads.delete(q);
		} else {
			this.removable([...this.quads]);
			this.quads.clear();
		}
	}

	async remove(pattern: TQuadPattern): Promise<void> {
		if (pattern.namedGraph) {
			this.refuseDerived(pattern.namedGraph);
			const backing = this.storeFor(pattern.namedGraph);
			if (backing) return await backing.remove(pattern);
		}
		const removed = this.removable([...this.quads.candidates(pattern)].filter((q) => matchesQuadPattern(q, pattern)));
		for (const q of removed) this.quads.delete(q);
	}

	async all(): Promise<TQuad[]> {
		const local = [...this.quads].filter(this.seen(undefined));
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
		if (!declarations) throw new Error("this store doesn't hold the declarations of its types, so it doesn't read records by type; build it with the declarations it reads");
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
		const edges = source === undefined ? [] : source.edges;
		for (const edge of edges) {
			if (referencedBy.via && !referencedBy.via.includes(edge.rel)) continue;
			if (this.readerOf(edge.label) === undefined) continue;
			const ids = named.get(edge.label);
			if (ids === undefined) named.set(edge.label, new Set([edge.id]));
			else ids.add(edge.id);
		}
		const read = await Promise.all(
			[...named].map(async ([label, ids]) => {
				const reader = this.readerOf(label);
				if (!reader) throw new Error(`the store that holds ${label} records was removed during the read; read again once a store holds them`);
				const idField = this.declarations?.().of(label)?.id;
				if (!idField) throw new Error(`${label} isn't a declared type, so a record it names can't be read by its id; declare the type`);
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
	 * Reads a sample of each type. Every backing store samples its own records, through its engine's query. This store's
	 * own layer samples each requested type in memory, reading only that type's quads. A store doesn't read every quad to
	 * slice a sample.
	 */
	async getClusteredQuads(opts: TClusteredQuadsOpts): Promise<TClusteredQuads> {
		const allQuads: TQuad[] = [];
		const clustersByType = new Map<string, TCluster>();
		const mergeCluster = (c: TCluster) => {
			const existing = clustersByType.get(c.type);
			if (!existing) {
				clustersByType.set(c.type, { ...c, sampledSubjects: [...c.sampledSubjects], displayLabels: { ...c.displayLabels }, ...(c.sites ? { sites: { ...c.sites } } : {}) });
				return;
			}
			existing.sampledSubjects = [...new Set([...existing.sampledSubjects, ...c.sampledSubjects])];
			existing.sampledCount = existing.sampledSubjects.length;
			existing.totalCount = Math.max(existing.totalCount, c.totalCount, existing.sampledCount);
			existing.omittedCount = Math.max(0, existing.totalCount - existing.sampledCount);
			existing.displayLabels = { ...existing.displayLabels, ...c.displayLabels };
			if (c.saturated) existing.saturated = true;
			if (c.sites) existing.sites = { ...existing.sites, ...c.sites };
			if (c.omittedUnder) existing.omittedUnder = { ...existing.omittedUnder, ...c.omittedUnder };
		};

		// Federated peers and remote backing stores merge beside local backing stores; each states the site of its subjects
		// (TCluster.sites), so a merged cluster states which site served each subject. A read scoped "own" reads what this
		// instance is authoritative for, so it skips both: their records are the serving site's own.
		const own = opts.scope === "own";
		const backing = own ? this.allStores.filter((s) => !s.isRemote) : this.allStores;
		const peers = own ? [] : [...this.chain.federated];
		const backingResults = await Promise.all([...backing.map((s) => s.getClusteredQuads(opts)), ...peers.map((f) => f.getClusteredQuads(opts))]);
		for (const r of backingResults) {
			allQuads.push(...r.quads);
			for (const c of r.clusters) mergeCluster(c);
		}

		const seen = this.seen(opts.accessLevel);
		const held = opts.types === undefined ? [...this.quads] : opts.types.flatMap((type) => [...this.quads.ofGraph(type)]);
		const localClustered = sliceQuadsPerType(held.filter(seen).map(this.asDeclared), opts.perTypeLimit, allQuads, (type) => this.declarations?.().of(type));
		allQuads.push(...localClustered.quads);
		for (const c of localClustered.clusters) mergeCluster(c);

		allQuads.sort((a, b) => a.timestamp - b.timestamp);
		return { quads: allQuads, clusters: [...clustersByType.values()] };
	}

	/** A held quad as a graph reads it: an edge where its type declares its predicate a relation to one type. A record written
	 *  whole states its relations as fields, and the graph draws each as an edge to the record it names. */
	private readonly asDeclared = (quad: TQuad): TQuad => {
		const ranges = quad.objectType === undefined ? this.declarations?.().of(quad.namedGraph)?.surface.references[quad.predicate] : undefined;
		return ranges?.length === 1 && typeof quad.object === "string" ? { ...quad, objectType: ranges[0] } : quad;
	};

	// async so a rejected identity reaches a caller's .catch like every other failure, rather than throwing
	// synchronously out of a method that returns a promise.
	async upsertIndividual(label: string, data: unknown): Promise<string> {
		this.refuseDerived(label);
		const backing = this.storeFor(label);
		if (backing) return await backing.upsertIndividual(label, data);
		const validated = RecordSchema.parse(data);
		const idField = this.idFieldOf(label);
		// The identity is read before it is stringified: String(undefined) is "undefined", which would write the record
		// under that literal subject, where a read doesn't reach it and the next such record overwrites it.
		const identity = validated[idField];
		if (identity === undefined || identity === null || String(identity).trim() === "")
			throw new Error(`a ${label} record is identified by its "${idField}" field, and this record doesn't state it; state the record's ${idField}`);
		const id = String(identity);
		// A record states its level, as every persisted type's record does, and each of its quads is held at that level.
		const declared = this.levels?.declared(label);
		const stated = validated.accessLevel === undefined ? undefined : AccessLevelSchema.parse(validated.accessLevel);
		const accessLevel = this.levels ? writtenAt(stated, declared, this.levels.writeBound()) : stated;
		if (declared) validated.accessLevel = accessLevel;
		// The code doesn't await between the removal and the additions, so a concurrent write, a carry at a scenario's end or a
		// backing registration during the write never reads a record that is half written.
		// A write replaces the record's properties and keeps its edges, as a graph store does.
		this.quads.removeWhere(this.quads.ofSubject(label, id), (q) => !q.objectType);
		const timestamp = Date.now();
		for (const [key, value] of Object.entries(validated)) {
			if (value !== undefined && value !== null)
				this.quads.add({ subject: id, predicate: key, object: value, namedGraph: label, timestamp, ...(accessLevel ? { accessLevel } : {}) });
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

/** The group a record counts under: how it turned out, or the empty group where it doesn't state it, so a bucket's counts
 *  add up to what it holds. */
const groupOf = (value: unknown): string => (value === undefined || value === null ? "" : String(value));

/**
 * Counts the records in each division of a span, by how each turned out, over a store that holds its records. An
 * in-memory store and the store a page holds both count through this function, since counting is reading what each
 * already holds. A store with a query engine counts in the engine.
 */
export async function densityOverQuadStore(store: IQuadStore, query: TDensityQuery): Promise<TDensityResult> {
	const from = Date.parse(query.from);
	const to = Date.parse(query.to);
	if (Number.isNaN(from) || Number.isNaN(to)) throw new Error(`a density read spans instants, and this one names ${query.from} to ${query.to}; name two instants`);
	if (to < from) throw new Error(`a density read spans forward, and this one names ${query.from} to ${query.to}; name the earlier instant first`);
	const buckets: Record<string, number>[] = Array.from({ length: query.buckets }, () => ({}));
	for (const individual of await readEvery(store, { label: query.label, filters: query.filters })) {
		const stamp = individual[query.timeField];
		const at = typeof stamp === "string" || typeof stamp === "number" ? Date.parse(String(stamp)) : Number.NaN;
		const bucket = Number.isNaN(at) ? -1 : bucketOf(at, from, to, query.buckets);
		if (bucket < 0) continue;
		const group = groupOf(individual[query.groupBy]);
		const counts = itemAt(buckets, bucket);
		const counted = counts[group];
		counts[group] = counted === undefined ? 1 : counted + 1;
	}
	return { buckets };
}
