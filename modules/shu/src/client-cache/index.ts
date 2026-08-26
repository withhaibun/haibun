/**
 * The client cache: what a page caches of the run, and how. One library, read through this surface.
 *
 * - run sources (run-source.ts): the run at a level as a view reads it, a WindowedSource over every event at that level
 *   and up, spanning the whole run by index, paged in on demand (the device first, then the server), bounded in what it
 *   caches, grown by live events; one per level, shared by every view at that level. The run's span and the live-edge rule
 *   every view places the cursor by come from here.
 * - the device's store (device-store.ts): where the sources persist lean events by their index at each level and each
 *   run's extent, and where the server's registry is cached, so a reload or a page with no server serves from the device and
 *   still knows the server's declarations (rpc-registry reads it when the server does not respond).
 * - the graph this page caches (quad-store.ts): the client's `IQuadStore`, in the same database as the events.
 * - what IndexedDB caches for the origin (idb-summary.ts): every database, its stores and their counts, read-only.
 *
 * The client cache view (components/shu-client-cache-column) reads all of it, and the client cache stepper
 * (client-cache-stepper.ts) opens that view and declares it.
 */
export {
	eventRunSource,
	runSources,
	deviceStore,
	subscribeRunSources,
	subscribeRunSwitch,
	readRun,
	currentRun,
	cullCachedRuns,
	RUNS_CACHED,
	runSpan,
	atLiveEdge,
	leanForStore,
	setDeviceStore,
	resetRunSources,
	EVENTS_UNAVAILABLE,
	type RunSource,
	type TRunExtent,
	type TEventRecord,
} from "./run-source.js";
export { IndexedDbDeviceStore, MemoryDeviceStore, subscribeDeviceWrites, runsNewestFirst, CACHE_SHAPE, eventTime, runOf, storedEventKey, resetDeviceStoreIdb, type DeviceStore, type TEventStoreSummary, type TStoredEvent, type TStoredRegistry } from "./device-store.js";
export { IndexedDbQuadStore } from "./quad-store.js";
export { indexedDbSummary, type TIdbDatabaseSummary, type TIdbStoreSummary } from "./idb-summary.js";
