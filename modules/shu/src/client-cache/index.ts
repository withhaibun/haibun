/**
 * The client cache: what a page holds of a run, and the ONE path a view reads it by. Every view reads the run through a
 * run source over the device's store, the graph through the store the page caches it in, and the site's declarations
 * through the registry this cache holds. Where the cache was filled from — a server, this device from an earlier visit,
 * or a run the page carries because it is a report — is settled once at boot and never asked again by a view.
 *
 * A change that needs data a view does not have extends this library: a new read on the store, a new source, a value on
 * the cache view. It does not add a fetch beside it, a second store, or a branch on what kind of page this is;
 * `one-path.test.ts` fails the build when one appears.
 *
 * - run sources (run-source.ts): the run at a level as a view reads it, a WindowedSource over every event at that level
 *   and up, spanning the whole run by index, paged in on demand (the device first, then the server), bounded in what it
 *   caches, grown by live events; one per level, shared by every view at that level. The run's span and the live-edge rule
 *   every view places the cursor by come from here.
 * - the device's store (device-store.ts): where the sources persist lean events by their index at each level and each
 *   run's extent, and where the server's registry is cached, so a reload or a page with no server serves from the device and
 *   still knows the server's declarations (rpc-registry reads it when the server does not respond).
 * - the graph this page caches (quad-store.ts): the client's `IQuadStore`, in the same database as the events.
 * - a run carried in a page (hydrate.ts): what a standalone report embeds, read through the same sources.
 * - what IndexedDB caches for the origin (idb-summary.ts): every database, its stores and their counts, read-only.
 *
 * The client cache view (components/shu-client-cache-column) reads all of it, and the client cache stepper
 * (client-cache-stepper.ts) opens that view and declares it.
 */
export { runSources, subscribeRunSources, runSpan, atLiveEdge, readRunAt, runReadingAt, resetRunSources, type RunSource, type TRunExtent, type TEventRecord } from "./run-source.js";
export { IndexedDbDeviceStore, MemoryDeviceStore, deviceStore, setDeviceStore, subscribeDeviceWrites, CACHE_SHAPE, resetDeviceStoreIdb, type DeviceStore, type TStoredRegistry } from "./device-store.js";
export { executionsHeld, forgetExecution, holdOnDevice, viewsShown, currentExecution, readingExecution, noteExecution, readExecution, subscribeExecutionSwitch, resetExecutions, EXECUTIONS_READ, type THeldExecution } from "./executions.js";
export { IndexedDbQuadStore, originGraphStore } from "./quad-store.js";
export { graphRunSource } from "./graph-run-source.js";
export { runWindow, detailRegion, runExtent, RUN_WINDOW_SIZE, DETAIL_HALF, type TRunRow, type TRunWindow } from "./run-window.js";
export { runCounts, marksOf, type TRunMark } from "./run-marks.js";
export { runShape, RUN_DIVISIONS, type TRunShape } from "./run-shape.js";
export { runGraphOf, type TRunGraph } from "./run-graph.js";
export { hydrateClientCache, type TCachePayload } from "./hydrate.js";
export { indexedDbSummary, type TIdbDatabaseSummary, type TIdbStoreSummary } from "./idb-summary.js";
