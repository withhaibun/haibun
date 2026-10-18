/**
 * An actuality's graph (`TActualityGraph`) over one store, and one actuality's records of a graph.
 */
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import type { TDensityQuery, TGraphQuery } from "@haibun/core/lib/quad-types.js";
import { EXECUTION_FIELD } from "@haibun/core/lib/seq-path.js";
import type { TActualityGraph } from "../ports.js";

/** An actuality read over one store: what a report reads of the copy it carries, and what a test reads of a store it made. */
export function actualityGraphOf(store: IQuadStore, declares: (label: string) => boolean): TActualityGraph {
	return { query: (query) => store.readRecords(query), density: (query) => store.density(query), declares };
}

/**
 * One execution of the graph given: every read of it carries the execution's own name, so what is read, counted and
 * spanned is one execution rather than whatever the store holds.
 *
 * A store holds the records of every execution written to it, and a record states its execution, so this is a filter
 * rather than a second store. Where an execution isn't named the graph is read as it is, which is what a page reads
 * before its first read names the execution it shows.
 */
export function ofExecution(graph: TActualityGraph, execution: string | undefined): TActualityGraph {
	if (execution === undefined) return graph;
	const named = { predicate: EXECUTION_FIELD, operator: "eq", value: execution };
	return {
		query: (query) => graph.query({ ...query, filters: query.filters === undefined ? [named] : [...query.filters, named] } as TGraphQuery),
		density: (query) => graph.density({ ...query, filters: query.filters === undefined ? [named] : [...query.filters, named] } as TDensityQuery),
		declares: graph.declares,
	};
}
