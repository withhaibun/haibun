/**
 * RemoteGraphSource — a federated peer's clustered read surface over RPC (reads-first federation).
 * Implements TFederatedGraphSource against a peer haibun instance: handshake via action.begin (the
 * peer self-reports its site principal), clustered reads via MonitorStepper-getClusteredQuads, every
 * sampled subject stamped with the site that served it. Deliberately NOT a routed backing store —
 * no raw pattern queries and no writes; those arrive with capability-gated federation.
 */
import { RpcClient } from "@haibun/core/lib/rpc-client.js";
import type { AccessLevel } from "@haibun/core/lib/resources.js";
import type { TCluster, TClusteredQuads, TFederatedGraphSource, TQuad } from "@haibun/core/lib/quad-types.js";

export type TRemoteGraphSourceConfig = { url: string; token?: string; fetchImpl?: typeof fetch };

export class RemoteGraphSource implements TFederatedGraphSource {
	private rpc: RpcClient;
	private remoteSite?: string;

	constructor(private config: TRemoteGraphSourceConfig) {
		this.rpc = new RpcClient({ baseUrl: config.url, capabilityToken: config.token, fetchImpl: config.fetchImpl });
	}

	/** Handshake: the peer self-reports its site principal via action.begin. Must complete before reads. */
	async connect(): Promise<string> {
		const result = await this.rpc.call<{ site?: string }>("action.begin", {}, []);
		if (typeof (result as { error?: unknown }).error === "string") throw new Error(`RemoteGraphSource: action.begin failed at ${this.config.url}: ${(result as { error: string }).error}`);
		const site = (result as { site?: string }).site;
		if (typeof site !== "string" || site.length === 0) throw new Error(`RemoteGraphSource: ${this.config.url} did not report a site principal — the peer predates federation`);
		this.remoteSite = site;
		return site;
	}

	get site(): string {
		if (!this.remoteSite) throw new Error("RemoteGraphSource: connect() has not completed — no site principal");
		return this.remoteSite;
	}

	/** Ask the peer to assign THIS instance a unique site principal (AuthorityStepper's `name a connecting site`). */
	async requestName(): Promise<string> {
		const result = await this.rpc.call<{ site?: string }>("AuthorityStepper-nameConnectingSite", {}, []);
		if (typeof (result as { error?: unknown }).error === "string") throw new Error(`RemoteGraphSource: naming failed at ${this.config.url}: ${(result as { error: string }).error}`);
		const site = (result as { site?: string }).site;
		if (typeof site !== "string" || site.length === 0) throw new Error(`RemoteGraphSource: naming at ${this.config.url} returned no site`);
		return site;
	}

	/** Clustered reads from the peer, every sampled subject stamped with the site that served it. */
	async getClusteredQuads(opts: { perTypeLimit: number; types?: string[]; accessLevel: AccessLevel }): Promise<TClusteredQuads> {
		const remote = this.site;
		const params: Record<string, unknown> = { perTypeLimit: opts.perTypeLimit, accessLevel: opts.accessLevel, ...(opts.types ? { types: JSON.stringify(opts.types) } : {}) };
		const result = await this.rpc.call<TClusteredQuads>("MonitorStepper-getClusteredQuads", params, []);
		if (typeof (result as { error?: unknown }).error === "string") throw new Error(`RemoteGraphSource: getClusteredQuads failed at ${this.config.url}: ${(result as { error: string }).error}`);
		const r = result as TClusteredQuads;
		const defaultSite = r.site ?? remote;
		// Stamp EVERY sampled subject explicitly: merged into another instance's response (whose own default
		// applies to unstamped subjects) these must keep the site that actually served them — including
		// deeper stamps when the peer itself federates (transitive reads keep their true origin).
		const clusters: TCluster[] = r.clusters.map((c) => ({ ...c, sites: Object.fromEntries(c.sampledSubjects.map((s) => [s, c.sites?.[s] ?? defaultSite])) }));
		return { quads: r.quads as TQuad[], clusters, site: remote };
	}
}
