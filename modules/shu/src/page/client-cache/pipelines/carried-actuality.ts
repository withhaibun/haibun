/**
 * An actuality carried in a page rather than read from a site: the standalone report embeds the graph of the execution it
 * reports, and this fills a memory-backed graph with it at boot. Every view then reads actuality through the same window
 * as a live one, so a report adds a store rather than a second read path.
 *
 * Memory, not IndexedDB: a report is opened from a file, where every report shares one origin, so a report that held its
 * actuality on the device would mix it with the next report's.
 */
import { QuadStore, newStoreChain } from "@haibun/core/lib/quad-store.js";
import type { TReadDeclarations } from "@haibun/core/lib/records/derivations/read-records.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import type { TCachePayload } from "../../../domains/hydration.js";
import { CACHE_SHAPE, type TCachedGraph, type TDeviceStore } from "../ports.js";

/** What reading a carried actuality installs: a device store held in memory, the graph the page reads, and the execution it
 *  reads; and the declarations of the types whose records the graph reads. */
export type TCarriedScope = {
	installDeviceStore: () => TDeviceStore;
	installGraph: (graph: TCachedGraph) => void;
	readExecution: (execution: string) => void;
	declarations: () => TReadDeclarations;
};

/** Returns what a report carries of an actuality: its execution, the site's registry as it stood, and the graph actuality wrote,
 *  in the shape this build reads. */
export const carriedActuality = (execution: string, registry: unknown, quads: TQuad[]): TCachePayload => ({ shape: CACHE_SHAPE, execution, registry, quads });

/** Fills a memory-backed graph with a report's actuality, and reads that execution from then. */
export async function readCarriedActuality(scope: TCarriedScope, cache: TCachePayload): Promise<void> {
	if (cache.shape !== CACHE_SHAPE) throw new Error(`this report carries an actuality written as ${cache.shape}, which this build doesn't read (${CACHE_SHAPE})`);
	const store = scope.installDeviceStore();
	if (cache.registry !== undefined) await store.setRegistry(cache.registry);
	const graph = new QuadStore(newStoreChain(), undefined, scope.declarations);
	if (cache.quads.length) await graph.setMany(cache.quads);
	scope.installGraph(graph);
	// The actuality this page carries is the actuality it reads: a site doesn't record another one.
	scope.readExecution(cache.execution);
}
