import type { ReactiveController, ReactiveControllerHost } from "lit";
import { conduit } from "../hypermedia.js";
import { getAvailableSteps, findStep, requireStep } from "../rpc-registry.js";
import type { SiteMetadata } from "../rels-cache.js";

/** A graph-query result: matched rows + total, plus the sort/cypher metadata the rich graph store adds (absent on the inherent path). */
export type TQueryResult = {
	vertices: Record<string, unknown>[];
	total: number;
	cypher?: string;
	sort?: { fields: string[]; orders: ("asc" | "desc")[]; current: { field?: string; order: "asc" | "desc" } };
};

/**
 * QueryController — the per-view handle to the graph-query data path. A view that runs queries HOLDS one
 * (`#query = new QueryController(this)`) and calls `this.#query.run(payload)`; it never assembles `requireStep` +
 * `conduit` itself. `run()` calls the `graphQuery` step: a graph store registers a rich `graphQuery` (sort / text /
 * cypher) that overrides the inherent fallback `graphQuery` (`getStore().queryIndividuals`), so the column browser works
 * in plain haibun with no parallel store. See ./index.ts for the pattern; data-access.test.ts enforces it.
 */
export class QueryController implements ReactiveController {
	constructor(host: ReactiveControllerHost) {
		host.addController(this);
	}

	hostConnected(): void {} // queries are on-demand; nothing to do at connect

	/** Run the `graphQuery` step — a graph store's rich query where present, else the inherent fallback. */
	async run(query: Record<string, unknown>): Promise<TQueryResult> {
		await getAvailableSteps();
		return conduit().follow<TQueryResult>({ method: requireStep("graphQuery"), params: { query } }, `query: ${(query.label as string) || "(any)"}`);
	}

	/** The server's site metadata (id fields, types, sortable fields) where the active stepper provides it, else null. */
	async siteMetadata(): Promise<SiteMetadata | null> {
		await getAvailableSteps();
		const step = findStep("getSiteMetadata");
		return step ? conduit().follow<SiteMetadata>({ method: step.method }, "query: site metadata") : null;
	}
}
