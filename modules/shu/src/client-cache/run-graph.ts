/**
 * What reading a run needs of the graph, as one contract rather than as whichever module singletons a reader reaches.
 *
 * A run is read three ways: the records of one type by time, how many fall in each division of a span, and whether the
 * graph carries a type at all. Every reading of a run states which graph it reads, so a page reads through its site and
 * its own copy, a report reads the copy it carries, and a test reads a store it made. Nothing has to be installed for a
 * run to be read.
 */
import type { IQuadStore, TDensityQuery, TDensityResult, TGraphQuery, TGraphQueryResult } from "@haibun/core/lib/quad-types.js";
import { queryQuadStore } from "@haibun/core/lib/quad-store.js";
import { EXECUTION_FIELD } from "@haibun/core/lib/seq-path.js";

export type TRunGraph = {
	/** The records of one type the query names. */
	query(query: TGraphQuery): Promise<TGraphQueryResult>;
	/** How many records of one type fall in each division of a span, by how each turned out. */
	density(query: TDensityQuery): Promise<TDensityResult>;
	/** Whether the graph carries this type. Asking for one it does not is asking a question with no answer. */
	declares(label: string): boolean;
};

/** A run read over one store: what a report reads of the copy it carries, and what a test reads of a store it made. */
export function runGraphOf(store: IQuadStore, declares: (label: string) => boolean = () => true): TRunGraph {
	return {
		query: (query) => queryQuadStore(store, query),
		density: (query) => store.density(query),
		declares,
	};
}

/**
 * One run of the graph given: every read of it carries the run's own name, so what is read, counted and spanned is one
 * run rather than whatever the store holds.
 *
 * A store holds the records of every run written to it, and a record states the run it belongs to, so this is a filter
 * rather than a second store. With no run named the graph is read as it is, which is what a page reads by before it
 * has read anything and learned which run it is looking at.
 */
export function ofExecution(graph: TRunGraph, execution: string | undefined): TRunGraph {
	if (execution === undefined) return graph;
	const named = { predicate: EXECUTION_FIELD, operator: "eq", value: execution };
	return {
		query: (query) => graph.query({ ...query, filters: [...(query.filters ?? []), named] } as TGraphQuery),
		density: (query) => graph.density({ ...query, filters: [...(query.filters ?? []), named] } as TDensityQuery),
		declares: graph.declares,
	};
}
