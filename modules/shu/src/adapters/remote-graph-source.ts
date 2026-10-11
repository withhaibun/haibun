/**
 * A federated peer's clustered graph, read over RPC. The handshake (`action.begin`) returns the peer's site principal, and
 * each clustered read stamps every sampled subject with the site that served it. The source doesn't route raw pattern
 * queries or writes to the peer; those require capability-gated federation.
 */
import { RemoteInstance } from "@haibun/core/lib/rpc-client.js";
import type { TRequestSigner } from "@haibun/core/lib/authority-types.js";
import { readAction } from "@haibun/core/lib/actions.js";
import type { AccessLevel } from "@haibun/core/lib/resources.js";
import type { TCluster, TClusteredQuads, TQuad } from "@haibun/core/lib/quad-types.js";
import type { TPeerCalls, TPeerGraphSource } from "../ports.js";

type TRemoteGraphSourceConfig = { url: string; sign: TRequestSigner; calls: TPeerCalls; fetchImpl?: typeof fetch };

export class RemoteGraphSource implements TPeerGraphSource {
	private remote: RemoteInstance;

	constructor(private config: TRemoteGraphSourceConfig) {
		this.remote = new RemoteInstance(config.url, config.sign, config.fetchImpl);
	}

	/** The handshake, which returns the peer's site principal. A read follows it. */
	connect(): Promise<string> {
		return this.remote.connect();
	}

	get site(): string {
		return this.remote.site;
	}

	/** The site principal the peer assigns this instance, under a delegation the peer gave this instance for naming it. */
	async requestName(): Promise<string> {
		const { method, action } = this.config.calls.nameSite;
		const { site } = await this.remote.rpc.call<{ site?: string }>(method, {}, [], { action });
		if (typeof site !== "string" || site.length === 0) throw new Error(`the peer at ${this.config.url} didn't return a site principal for this instance`);
		return site;
	}

	/** The peer's clustered sample, each sampled subject stamped with the site that served it. The read's scope is the
	 *  peer's own graph, never the graph it federates, so a federation cycle doesn't recurse, and each instance federates
	 *  the peers it reads directly. */
	async getClusteredQuads(opts: { perTypeLimit: number; types?: string[]; accessLevel: AccessLevel }): Promise<TClusteredQuads> {
		const remote = this.site;
		const params: Record<string, unknown> = {
			perTypeLimit: opts.perTypeLimit,
			accessLevel: opts.accessLevel,
			scope: "own",
			...(opts.types ? { types: JSON.stringify(opts.types) } : {}),
		};
		// A read at a level is invoked as one, under a delegation from the peer that allows reading at it.
		const r = await this.remote.rpc.call<TClusteredQuads>(this.config.calls.clustered, params, [], { action: readAction(opts.accessLevel) });
		const servedBy = r.site ?? remote;
		// Every sampled subject is stamped, so merged into another instance's sample it keeps the site that served it, and a
		// peer that stamped its subjects keeps its stamps.
		const clusters: TCluster[] = r.clusters.map((c) => ({ ...c, sites: Object.fromEntries(c.sampledSubjects.map((s) => [s, c.sites?.[s] ?? servedBy])) }));
		return { quads: r.quads as TQuad[], clusters, site: remote };
	}
}
