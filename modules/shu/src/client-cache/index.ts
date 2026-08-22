/**
 * The client cache: what a page holds of the run, and how. One library, read through this surface.
 *
 * - run sources (run-source.ts): the run at a level as a view reads it, a WindowedSource over every event at that level
 *   and up, spanning the whole run by index, paged in on demand (the device first, then the server), bounded in what it
 *   holds, grown by live events; one per level, shared by every view at that level. The run's span and the live-edge rule
 *   every view places the cursor by come from here.
 * - the device's event store (event-store.ts): where the sources persist lean events by their index at each level and
 *   each run's extent, so a reload or a page with no server serves from the device.
 * - what IndexedDB holds for the origin (idb-summary.ts): every database, its stores and their counts, read-only.
 *
 * The client cache view (components/shu-client-cache-column) reads all of it, and the client cache stepper
 * (client-cache-stepper.ts) opens that view and declares it.
 */
export {
	eventRunSource,
	runSources,
	runSourceStore,
	subscribeRunSources,
	runSpan,
	atLiveEdge,
	leanForStore,
	setRunSourceStore,
	resetRunSources,
	EVENTS_UNAVAILABLE,
	type RunSource,
	type TRunExtent,
	type TEventRecord,
} from "./run-source.js";
export { IndexedDbEventStore, MemoryEventStore, eventTime, runOf, storedEventKey, resetEventStoreIdb, type EventStore, type TEventStoreSummary, type TStoredEvent } from "./event-store.js";
export { indexedDbSummary, type TIdbDatabaseSummary, type TIdbStoreSummary } from "./idb-summary.js";
