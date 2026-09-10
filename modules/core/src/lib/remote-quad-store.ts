/**
 * RemoteQuadStore: the full IQuadStore served by ANOTHER instance's store, over the capability-gated
 * `store.*` protocol (store-protocol.ts). Registered as a backing store (QuadStore.registerStore) for the
 * graphs it is mounted for, so a satellite instance keeps those records in the main instance's store
 * instead of its own: writes route through, reads come back: one store, one custodian. Every call
 * presents the delegated capability token; a peer without the grant is refused by the serving side.
 * Mount-scoped: clustered reads and all() cover only the mounted graphs, never the peer's whole store.
 */
import { discoverInstance, RpcClient, type RpcError } from "./rpc-client.js";
import { STORE_METHOD_PREFIX } from "./store-protocol.js";
import type { AccessLevel } from "./resources.js";
import type { IQuadStore, TClusteredQuads, TClusteredQuadsOpts, TDensityQuery, TDensityResult, TQuad, TQuadPattern } from "./quad-types.js";

export type TRemoteQuadStoreConfig = { url: string; token: string; graphs: string[]; fetchImpl?: typeof fetch };

export class RemoteQuadStore implements IQuadStore {
	readonly isRemote = true;
	private rpc: RpcClient;
	private remoteSite?: string;

	constructor(private config: TRemoteQuadStoreConfig) {
		this.rpc = new RpcClient({ baseUrl: config.url, capabilityToken: config.token, fetchImpl: config.fetchImpl });
	}

	/** Handshake before use: the serving instance self-reports its site principal: the custodian of everything mounted here. */
	async connect(): Promise<string> {
		const { site } = await discoverInstance(this.rpc, this.config.url);
		this.remoteSite = site;
		return site;
	}

	get site(): string {
		if (!this.remoteSite) throw new Error("RemoteQuadStore: connect() has not completed: no site principal");
		return this.remoteSite;
	}

	get graphs(): readonly string[] {
		return this.config.graphs;
	}

	private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
		const result = await this.rpc.call<{ result: T }>(`${STORE_METHOD_PREFIX}${method}`, params, []);
		if (typeof (result as RpcError).error === "string") throw new Error(`RemoteQuadStore: ${method} failed at ${this.config.url}: ${(result as RpcError).error}`);
		return (result as { result: T }).result;
	}

	set(subject: string, predicate: string, object: unknown, namedGraph: string, properties?: Record<string, unknown>): Promise<void> {
		return this.call("set", { subject, predicate, object, namedGraph, properties });
	}

	get(subject: string, predicate: string, namedGraph?: string): Promise<unknown | undefined> {
		return this.call("get", { subject, predicate, namedGraph });
	}

	add(quad: Omit<TQuad, "timestamp">): Promise<void> {
		return this.call("add", { quad });
	}

	query(pattern: TQuadPattern): Promise<TQuad[]> {
		return this.call("query", { pattern });
	}

	clear(namedGraph?: string): Promise<void> {
		return this.call("clear", { namedGraph });
	}

	remove(pattern: TQuadPattern): Promise<void> {
		return this.call("remove", { pattern });
	}

	/** Mount-scoped: the mounted graphs' quads, not the peer's whole store: one bounded query per mounted graph. */
	async all(): Promise<TQuad[]> {
		const perGraph = await Promise.all(this.config.graphs.map((namedGraph) => this.query({ namedGraph })));
		return perGraph.flat();
	}

	upsertIndividual(label: string, data: unknown): Promise<string> {
		return this.call("upsertIndividual", { label, data });
	}

	getIndividual<T = Record<string, unknown>>(label: string, id: string): Promise<T | undefined> {
		return this.call("getIndividual", { label, id });
	}

	deleteIndividual(label: string, id: string): Promise<void> {
		return this.call("deleteIndividual", { label, id });
	}

	queryIndividuals<T = Record<string, unknown>>(label: string, filters?: Record<string, unknown>, options?: { limit?: number; offset?: number }): Promise<T[]> {
		return this.call("queryIndividuals", { label, filters, options });
	}

	distinctPropertyValues(label: string, property: string): Promise<string[]> {
		return this.call("distinctPropertyValues", { label, property });
	}

	density(query: TDensityQuery): Promise<TDensityResult> {
		return this.call("density", { query });
	}

	/**
	 * Mount-scoped: a caller's type filter intersects the mounted graphs; no filter means exactly the mounted graphs.
	 * Every subject is stamped with the serving site: a mounted record's location IS the serving instance's store (a
	 * read-time store fact), so this instance's own view already shows it under the site that holds it, no federation
	 * needed. A subject the peer itself stamped (transitive mount) keeps that deeper stamp.
	 */
	async getClusteredQuads(opts: TClusteredQuadsOpts): Promise<TClusteredQuads> {
		const types = opts.types ? opts.types.filter((t) => this.config.graphs.includes(t)) : [...this.config.graphs];
		if (types.length === 0) return { quads: [], clusters: [] };
		const site = this.site;
		const r = await this.call<TClusteredQuads>("getClusteredQuads", { perTypeLimit: opts.perTypeLimit, types, accessLevel: opts.accessLevel as AccessLevel, scope: opts.scope });
		const defaultSite = r.site ?? site;
		const clusters = r.clusters.map((c) => ({ ...c, sites: Object.fromEntries(c.sampledSubjects.map((s) => [s, c.sites?.[s] ?? defaultSite])) }));
		return { quads: r.quads, clusters, site };
	}

	createEdge(fromLabel: string, fromId: string, edgeLabel: string, toLabel: string, toId: string): Promise<void> {
		return this.call("createEdge", { fromLabel, fromId, edgeLabel, toLabel, toId });
	}
}
