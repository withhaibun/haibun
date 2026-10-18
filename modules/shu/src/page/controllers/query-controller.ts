import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { TGraphQueryResult } from "@haibun/core/lib/quad-types.js";
import { queryGraph } from "./read-controller.js";

/**
 * QueryController: the per-view handle to the graph-query data path. A view that runs queries HOLDS one
 * (`#query = new QueryController(this)`) and calls `this.#query.run(payload)`; it never assembles `requireStep` +
 * `conduit` itself. `run()` requests the `graphQuery` step: a graph store registers a rich `graphQuery` (sort / text /
 * cypher) that overrides the inherent one (the world's store's `readRecords`), so the column browser works in
 * plain haibun without a parallel store. See ./index.ts for the pattern; data-access.test.ts enforces it.
 */
export class QueryController implements ReactiveController {
	constructor(host: ReactiveControllerHost) {
		host.addController(this);
	}

	hostConnected(): void {} // queries are on-demand; connecting doesn't start one

	/** Run the `graphQuery` step: a graph store's rich query where present, else the inherent one, and without a server
	 *  the same query over the graph the page caches. */
	run(query: Record<string, unknown>): Promise<TGraphQueryResult> {
		return queryGraph(query);
	}
}
