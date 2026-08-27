import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { TGraphQueryResult } from "@haibun/core/lib/quad-types.js";
import { conduit } from "../hypermedia.js";
import { getAvailableSteps, findStep } from "../rpc-registry.js";
import { queryGraph } from "../quads-snapshot.js";
import type { SiteMetadata } from "../rels-cache.js";

/**
 * QueryController — the per-view handle to the graph-query data path. A view that runs queries HOLDS one
 * (`#query = new QueryController(this)`) and calls `this.#query.run(payload)`; it never assembles `requireStep` +
 * `conduit` itself. `run()` asks for the `graphQuery` step: a graph store registers a rich `graphQuery` (sort / text /
 * cypher) that overrides the inherent one (`queryQuadStore` over the world's store), so the column browser works in
 * plain haibun with no parallel store. See ./index.ts for the pattern; data-access.test.ts enforces it.
 */
export class QueryController implements ReactiveController {
	constructor(host: ReactiveControllerHost) {
		host.addController(this);
	}

	hostConnected(): void {} // queries are on-demand; nothing to do at connect

	/** Run the `graphQuery` step — a graph store's rich query where present, else the inherent one; with no server, the
	 *  same query over the graph the page caches. */
	run(query: Record<string, unknown>): Promise<TGraphQueryResult> {
		return queryGraph(query);
	}

	/** The server's site metadata (id fields, types, sortable fields) where the active stepper provides it, else null. */
	async siteMetadata(): Promise<SiteMetadata | null> {
		await getAvailableSteps();
		const step = findStep("getSiteMetadata");
		return step ? conduit().follow<SiteMetadata>({ method: step.method }, "query: site metadata") : null;
	}
}
