/**
 * RemoteQuadStore: the full IQuadStore served by ANOTHER instance's store, over the capability-gated
 * `store.*` protocol (store-protocol.ts). Registered as a backing store (QuadStore.registerStore) for the
 * graphs it is mounted for, so a satellite instance keeps those records in the main instance's store
 * instead of its own: writes route through, reads come back: one store, one custodian. Every call
 * is signed, invoking the action its method takes; a peer that doesn't hold a delegation for it is refused by the serving side.
 * Mount-scoped: clustered reads and all() cover only the mounted graphs, never the peer's whole store.
 */
import { RemoteInstance } from "./rpc-client.js";
import { STORE_METHOD_PREFIX, appliedWrite, requiredStoreCapability, sentWrites, UnitsRemovedSchema, UnitsWrittenSchema, WrittenIdSchema } from "../../domains/store-protocol.js";
import { writesInFlight } from "../../domains/capability-context.js";
import type { TRequestSigner } from "../../domains/authority-types.js";
import { z } from "zod";
import type { AccessQueryLevel } from "../../domains/resources.js";
import { ClusteredQuadsSchema, DensityResultSchema, DistinctValuesSchema, QuadSchema, RecordsPageSchema, typedRecord } from "../../steps/domains/quad-types.js";
import type { IQuadStore } from "../../steps/ports.js";
import {
	ReadVersionSchema,
	WRITE_VERB,
	type TNode,
	type TReadVersion,
	type TRecordName,
	type TRemoval,
	type TUnitRemoved,
	type TUnitWrite,
	type TUnitWritten,
	type TWriteVerb,
} from "../../records/domains/unit.js";
import type {
	TClusteredQuads,
	TClusteredQuadsOpts,
	TDensityQuery,
	TDensityResult,
	TDistinctValues,
	TGraphQuery,
	TQuad,
	TQuadPattern,
	TRecordsPage,
	TRecordType,
} from "../../steps/domains/quad-types.js";

export type TRemoteQuadStoreConfig = { url: string; sign: TRequestSigner; graphs: string[]; fetchImpl?: typeof fetch };

export class RemoteQuadStore implements IQuadStore {
	readonly isRemote = true;
	private remote: RemoteInstance;

	constructor(private config: TRemoteQuadStoreConfig) {
		this.remote = new RemoteInstance(config.url, config.sign, config.fetchImpl);
	}

	/** Handshake before use: the serving instance self-reports its site principal: the custodian of everything mounted here. */
	connect(): Promise<string> {
		return this.remote.connect();
	}

	get site(): string {
		return this.remote.site;
	}

	get graphs(): readonly string[] {
		return this.config.graphs;
	}

	/** Calls a store method at the serving instance, and returns its result parsed with `result`, the schema of what it returns. */
	private async call<S extends z.ZodType>(method: string, params: Record<string, unknown>, result: S): Promise<z.output<S>> {
		const storeMethod = `${STORE_METHOD_PREFIX}${method}`;
		// A method without a result serializes its envelope without `result`, so the method's own schema reads its absence.
		const answer = z
			.object({ result: z.unknown().optional() })
			.transform((envelope) => envelope.result)
			.pipe(result);
		return await this.remote.rpc.call(storeMethod, params, answer, undefined, { action: requiredStoreCapability(storeMethod) });
	}

	create(node: TNode): Promise<string> {
		return this.write(WRITE_VERB.create, WrittenIdSchema, { node });
	}

	update(node: TNode, version: TReadVersion): Promise<string> {
		return this.write(WRITE_VERB.update, WrittenIdSchema, { node, version });
	}

	merge(node: TNode): Promise<string> {
		return this.write(WRITE_VERB.merge, WrittenIdSchema, { node });
	}

	/** Writes the units at the serving instance in one call, and returns how each ended. */
	writeMany(units: readonly TUnitWrite[]): Promise<TUnitWritten[]> {
		return this.write("writeMany", UnitsWrittenSchema, { units });
	}

	/** Makes the removals at the serving instance in one call, and returns how each ended. */
	removeMany(removals: readonly TRemoval[]): Promise<TUnitRemoved[]> {
		return this.call("removeMany", { removals }, UnitsRemovedSchema);
	}

	/** Writes at the serving instance within the writes of the step in progress, and returns the write's value. The step's writes
	 *  list each record the serving store wrote and each change it refused, and a refusal of a unit is thrown as that store threw it. */
	private async write<V extends z.ZodType>(method: TWriteVerb | "writeMany", value: V, params: Record<string, unknown>): Promise<z.output<V>> {
		const writes = writesInFlight();
		// The result holds the write's value beside the writes the serving store made, which `appliedWrite` parses.
		return appliedWrite(value, await this.call(method, { ...params, ...sentWrites(writes) }, z.unknown()), writes);
	}

	get(subject: string, predicate: string, namedGraph?: string): Promise<unknown | undefined> {
		return this.call("get", { subject, predicate, namedGraph }, z.unknown());
	}

	query(pattern: TQuadPattern): Promise<TQuad[]> {
		return this.call("query", { pattern }, z.array(QuadSchema));
	}

	clear(namedGraph?: string): Promise<void> {
		return this.call("clear", { namedGraph }, z.undefined());
	}

	remove(removal: TRemoval): Promise<void> {
		return this.call("remove", { removal }, z.undefined());
	}

	versionOf(name: TRecordName): Promise<TReadVersion> {
		return this.call("versionOf", { name }, ReadVersionSchema);
	}

	/** Mount-scoped: the mounted graphs' quads, not the peer's whole store: one bounded query per mounted graph. */
	async all(): Promise<TQuad[]> {
		const perGraph = await Promise.all(this.config.graphs.map((namedGraph) => this.query({ namedGraph })));
		return perGraph.flat();
	}

	readRecords(query: TGraphQuery): Promise<TRecordsPage> {
		return this.call("readRecords", { query }, RecordsPageSchema);
	}

	/** The far side reads the record by its label, and this side parses what it returns with the type's schema. */
	readRecord<S extends z.ZodType>(type: TRecordType<S>, id: string, accessLevel?: AccessQueryLevel): Promise<z.output<S> | undefined> {
		return typedRecord(type, id, accessLevel, (query) => this.readRecords(query));
	}

	distinctPropertyValues(label: string, property: string): Promise<TDistinctValues> {
		return this.call("distinctPropertyValues", { label, property }, DistinctValuesSchema);
	}

	density(query: TDensityQuery): Promise<TDensityResult> {
		return this.call("density", { query }, DensityResultSchema);
	}

	/**
	 * Mount-scoped: a caller's type filter intersects the mounted graphs; a call without a filter reads exactly the mounted graphs.
	 * Every subject is stamped with the serving site: a mounted record's location IS the serving instance's store (a
	 * read-time store fact), so this instance's own view already shows it under the site that holds it, and doesn't need
	 * federation. A subject the peer itself stamped (transitive mount) keeps that deeper stamp.
	 */
	async getClusteredQuads(opts: TClusteredQuadsOpts): Promise<TClusteredQuads> {
		const types = opts.types ? opts.types.filter((t) => this.config.graphs.includes(t)) : [...this.config.graphs];
		if (types.length === 0) return { quads: [], clusters: [] };
		const site = this.site;
		const r = await this.call("getClusteredQuads", { perTypeLimit: opts.perTypeLimit, types, accessLevel: opts.accessLevel, scope: opts.scope }, ClusteredQuadsSchema);
		const defaultSite = r.site ?? site;
		const clusters = r.clusters.map((c) => ({ ...c, sites: Object.fromEntries(c.sampledSubjects.map((s) => [s, c.sites?.[s] ?? defaultSite])) }));
		return { quads: r.quads, clusters, site };
	}
}
