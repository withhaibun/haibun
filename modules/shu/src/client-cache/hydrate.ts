/**
 * A run carried in a page rather than read from a server: the standalone report embeds what the client cache holds of
 * the run it reports, and this fills a memory-backed device store with it at boot. Every view then reads the run through
 * the same sources it uses against a live server; nothing about a report is a second read path.
 *
 * Memory, not IndexedDB: a report is opened from a file, where every report shares one origin, so a report that
 * persisted would mix its run with the next report's.
 */
import { CACHE_SHAPE, MemoryDeviceStore, type TStoredEvent } from "./device-store.js";
import { readRun, setDeviceStore } from "./run-source.js";

/** What a report carries of the run it reports: the run's identity, its events as the store keeps them, what each level
 *  spans, and the site's registry as it stood. `shape` names the rule the payload was written to. */
export type TCachePayload = {
	shape: string;
	run: string;
	events: TStoredEvent[];
	extents: Record<string, { total: number; first?: number; last?: number }>;
	registry?: unknown;
};

/** Fill a memory-backed device store with a report's run, and read the run through it from now on. */
export async function hydrateClientCache(cache: TCachePayload): Promise<void> {
	if (cache.shape !== CACHE_SHAPE) throw new Error(`this report carries a run written as ${cache.shape}, which this build does not read (${CACHE_SHAPE})`);
	const store = new MemoryDeviceStore();
	await store.putMany(cache.events);
	for (const [level, extent] of Object.entries(cache.extents)) await store.setExtent(cache.run, level, extent);
	await store.setLastRun(cache.run);
	if (cache.registry !== undefined) await store.setRegistry(cache.registry);
	setDeviceStore(store);
	// The run this page carries is the run it reads: there is no server recording another one, so every page comes from
	// what the page carries rather than from a response about some other run.
	await readRun(cache.run);
}
