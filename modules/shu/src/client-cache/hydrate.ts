/**
 * A run carried in a page rather than read from a site: the standalone report embeds the graph of the run it reports,
 * and this fills a memory-backed store with it at boot. Every view then reads actuality through the same window it reads
 * a live one by; a report doesn't add a second read path.
 *
 * Memory, not IndexedDB: a report is opened from a file, where every report shares one origin, so a report that
 * persisted would mix its run with the next report's.
 */
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { pageReadDeclarations, setGraphStore } from "../quads-snapshot.js";
import { CACHE_SHAPE, MemoryDeviceStore, setDeviceStore } from "./device-store.js";
import { readExecution } from "./executions.js";
import type { TCachePayload } from "../domains/hydration.js";


/** Fill a memory-backed store with a report's run, and read that execution from now on. */
export async function hydrateClientCache(cache: TCachePayload): Promise<void> {
	if (cache.shape !== CACHE_SHAPE) throw new Error(`this report carries a run written as ${cache.shape}, which this build does not read (${CACHE_SHAPE})`);
	const store = new MemoryDeviceStore();
	if (cache.registry !== undefined) await store.setRegistry(cache.registry);
	setDeviceStore(store);
	// The graph the page carries, in a store of its own rather than the origin's: a file shares one origin with every
	// other report, so a report that persisted its graph would mix it with the next report's.
	const graph = new QuadStore(undefined, undefined, undefined, pageReadDeclarations);
	if (cache.quads?.length) await graph.setMany(cache.quads);
	setGraphStore(graph);
	// The actuality this page carries is the actuality it reads: a site doesn't record another one.
	readExecution(cache.execution);
}
