/** Counts a store's records in each division of a span of time, over a store that holds its records in memory. */
import type { IQuadStore } from "../../steps/ports.js";
import type { TDensityQuery, TDensityResult } from "../../steps/domains/quad-types.js";
import { bucketOf } from "../../steps/derivations/quad-sample.js";
import { itemAt } from "../../domains/item-at.js";
import { readEvery } from "./record-reads.js";

/** The group a record counts under: how it turned out, or the empty group where it doesn't state it, so a bucket's counts
 *  add up to what it holds. */
const groupOf = (value: unknown): string => (value === undefined || value === null ? "" : String(value));

/**
 * Counts the records in each division of a span, by how each turned out, over a store that holds its records. An
 * in-memory store and the store a page holds both count through this function, since counting is reading what each
 * already holds. A store with a query engine counts in the engine.
 */
export async function densityOverQuadStore(store: IQuadStore, query: TDensityQuery): Promise<TDensityResult> {
	const from = Date.parse(query.from);
	const to = Date.parse(query.to);
	if (Number.isNaN(from) || Number.isNaN(to)) throw new Error(`a density read spans instants, and this one names ${query.from} to ${query.to}; name two instants`);
	if (to < from) throw new Error(`a density read spans forward, and this one names ${query.from} to ${query.to}; name the earlier instant first`);
	const buckets: Record<string, number>[] = Array.from({ length: query.buckets }, () => ({}));
	for (const individual of await readEvery(store, { label: query.label, filters: query.filters })) {
		const stamp = individual[query.timeField];
		const at = typeof stamp === "string" || typeof stamp === "number" ? Date.parse(String(stamp)) : Number.NaN;
		const bucket = Number.isNaN(at) ? -1 : bucketOf(at, from, to, query.buckets);
		if (bucket < 0) continue;
		const group = groupOf(individual[query.groupBy]);
		const counts = itemAt(buckets, bucket);
		const counted = counts[group];
		counts[group] = counted === undefined ? 1 : counted + 1;
	}
	return { buckets };
}
