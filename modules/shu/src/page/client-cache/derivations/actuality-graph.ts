/**
 * One actuality's records of an actuality's graph (`TActualityGraph`).
 */
import { ACTUALITY_FIELD } from "@haibun/core/lib/seq-path.js";
import { allOf, hasValue, type TClassExpression } from "@haibun/core/lib/records/domains/class-expression.js";
import type { TActualityGraph } from "../ports.js";

/** Returns `expression` narrowed to the records of one actuality feature. */
const ofFeature = (expression: TClassExpression | undefined, actualityFeature: string): TClassExpression =>
	allOf([...(expression === undefined ? [] : [expression]), hasValue(ACTUALITY_FIELD, actualityFeature)]);

/**
 * One actuality feature of the graph given: every read of it states the actuality feature's own name, so what is read, counted and
 * spanned is one actuality feature rather than whatever the store holds.
 *
 * A store holds the records of every actuality feature written to it, and a record states its actuality feature, so this is a
 * `value` restriction rather than a second store. Where an actuality feature isn't named the graph is read as it is, which is what
 * a page reads before its first read names the actuality feature it shows.
 */
export function ofActualityFeature(graph: TActualityGraph, actualityFeature: string | undefined): TActualityGraph {
	if (actualityFeature === undefined) return graph;
	return {
		query: (query) => {
			if (typeof query.expression === "string") throw new Error("an actuality feature's records are read by an expression the page builds, not a written one");
			return graph.query({ ...query, expression: ofFeature(query.expression, actualityFeature) });
		},
		density: (query) => graph.density({ ...query, expression: ofFeature(query.expression, actualityFeature) }),
		declares: graph.declares,
	};
}
