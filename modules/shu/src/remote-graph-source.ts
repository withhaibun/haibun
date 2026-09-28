/**
 * RemoteGraphSource: a federated peer's clustered read surface over RPC (reads-first federation).
 * Implements TFederatedGraphSource against a peer haibun instance: handshake via action.begin (the
 * peer self-reports its site principal), clustered reads via RPC_METHOD.CLUSTERED_QUADS, every
 * sampled subject stamped with the site that served it. Deliberately NOT a routed backing store:
 * it doesn't take raw pattern queries or writes; those arrive with capability-gated federation.
 */
import { RemoteInstance } from "@haibun/core/lib/rpc-client.js";
import type { TRequestSigner } from "@haibun/core/lib/authority-types.js";
import { AUTHORITY_CAPABILITIES } from "@haibun/core/steps/authority-stepper.js";
import { RPC_METHOD } from "./consts.js";
import { readAction } from "@haibun/core/lib/actions.js";
import type { AccessLevel } from "@haibun/core/lib/resources.js";
import type { TCluster, TClusteredQuads, TFederatedGraphSource, TQuad } from "@haibun/core/lib/quad-types.js";

type TRemoteGraphSourceConfig = { url: string; sign: TRequestSigner; fetchImpl?: typeof fetch };

export class RemoteGraphSource implements TFederatedGraphSource {
	private remote: RemoteInstance;

	constructor(private config: TRemoteGraphSourceConfig) {
		this.remote = new RemoteInstance(config.url, config.sign, config.fetchImpl);
	}

	/** Handshake: the peer self-reports its site principal via action.begin. Must complete before reads. */
	connect(): Promise<string> {
		return this.remote.connect();
	}

	get site(): string {
		return this.remote.site;
	}

	/** Ask the peer to assign THIS instance a unique site principal (AuthorityStepper's `name a connecting site`), under a
	 *  delegation the peer gave this instance for naming it. */
	async requestName(): Promise<string> {
		const { site } = await this.remote.rpc.call<{ site?: string }>("AuthorityStepper-nameConnectingSite", {}, [], { action: AUTHORITY_CAPABILITIES.name });
		if (typeof site !== "string" || site.length === 0) throw new Error(`RemoteGraphSource: naming at ${this.config.url} didn't return a site`);
		return site;
	}

	/** Clustered reads from the peer, every sampled subject stamped with the site that served it. Asks for scope
	 *  "own": the peer's authoritative data, never its view of the world, so a federation cycle cannot recurse;
	 *  each consumer federates the peers it wants directly. */
	async getClusteredQuads(opts: { perTypeLimit: number; types?: string[]; accessLevel: AccessLevel }): Promise<TClusteredQuads> {
		const remote = this.site;
		const params: Record<string, unknown> = {
			perTypeLimit: opts.perTypeLimit,
			accessLevel: opts.accessLevel,
			scope: "own",
			...(opts.types ? { types: JSON.stringify(opts.types) } : {}),
		};
		// A read at a level is invoked as one, under a delegation from the peer that allows reading at it.
		const r = await this.remote.rpc.call<TClusteredQuads>(RPC_METHOD.CLUSTERED_QUADS, params, [], { action: readAction(opts.accessLevel) });
		const defaultSite = r.site ?? remote;
		// Stamp EVERY sampled subject explicitly: merged into another instance's response (whose own default
		// applies to unstamped subjects) these must keep the site that served them, and a peer that
		// stamped per-subject sites itself keeps its stamps.
		const clusters: TCluster[] = r.clusters.map((c) => ({ ...c, sites: Object.fromEntries(c.sampledSubjects.map((s) => [s, c.sites?.[s] ?? defaultSite])) }));
		return { quads: r.quads as TQuad[], clusters, site: remote };
	}
}
