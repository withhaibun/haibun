/**
 * A run carried in a page rather than read from a site: the standalone report embeds the graph of the run it reports,
 * and this fills a memory-backed store with it at boot. Every view then reads the run through the same window it reads
 * a live one by; nothing about a report is a second read path.
 *
 * Memory, not IndexedDB: a report is opened from a file, where every report shares one origin, so a report that
 * persisted would mix its run with the next report's.
 */
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { setGraphStore } from "../quads-snapshot.js";
import { CACHE_SHAPE, MemoryDeviceStore, setDeviceStore } from "./device-store.js";
import { readExecution } from "./executions.js";

/** What a report carries of the run it reports: the graph the run wrote, which is the run, and the site's registry as
 *  it stood. `shape` names the rule the payload was written to. */
export type TCachePayload = {
	shape: string;
	/** The execution the report is of, which is the one its views read. */
	execution: string;
	registry?: unknown;
	quads: TQuad[];
};

/** Fill a memory-backed store with a report's run, and read that execution from now on. */
export async function hydrateClientCache(cache: TCachePayload): Promise<void> {
	if (cache.shape !== CACHE_SHAPE) throw new Error(`this report carries a run written as ${cache.shape}, which this build does not read (${CACHE_SHAPE})`);
	const store = new MemoryDeviceStore();
	if (cache.registry !== undefined) await store.setRegistry(cache.registry);
	setDeviceStore(store);
	// The graph the page carries, in a store of its own rather than the origin's: a file shares one origin with every
	// other report, so a report that persisted its graph would mix it with the next report's.
	const graph = new QuadStore();
	if (cache.quads?.length) await graph.setMany(cache.quads);
	setGraphStore(graph);
	// The run this page carries is the run it reads: there is no site recording another one.
	readExecution(cache.execution);
}
