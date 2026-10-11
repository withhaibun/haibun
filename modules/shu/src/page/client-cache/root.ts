/**
 * The client cache's composition root: the page's one connection to each device database, the device's store and graph
 * of each actuality, the readers told of a write to the device, the execution the page reads, and the readings of
 * actuality the views share. Each is held on the page by key, so every bundle on the page shares it.
 */
import { machine, type Machine } from "@haibun/core/lib/machine.js";
import { pagePinned } from "../adapters/page-held.js";
import { pageHydration } from "../root.js";
import { reportFailure, reportToRun } from "../../client-log.js";
import { databaseOf, deviceDatabase, heldDatabaseNames, IndexedDbDeviceStore, MemoryDeviceStore, type TDeviceConnections } from "./adapters/device-store.js";
import { GRAPH_BOUND, IndexedDbQuads } from "./adapters/quad-store.js";
import { indexedDbSummary, type TIdbDatabaseSummary } from "./adapters/idb-summary.js";
import { INITIAL_EXECUTIONS, executionsTransition, type TExecutionsEvent, type TExecutionsState } from "./machines/executions.js";
import type { TCachedGraph, TDeviceDatabase, TDeviceQuads, TDeviceReport, TDeviceStore, TRunRegistry } from "./ports.js";

export { CACHE_SHAPE } from "./ports.js";
import type { TGraphRunSource } from "./pipelines/run-sources.js";

/** The source the device reports under. */
const DEVICE_STORE = "device-store";
/** The source a reading of actuality reports under. */
const RUN_SOURCE = "graph-run-source";

const CONNECTIONS_KEY = "__SHU_DEVICE_DB__";
const WRITE_LISTENERS_KEY = "__SHU_CLIENT_CACHE_WRITE_LISTENERS__";
const STORE_KEY = "__SHU_DEVICE_STORE__";
const EXECUTIONS_KEY = "__SHU_READING_EXECUTION__";
const RUN_REGISTRY_KEY = "__SHU_RUN_REGISTRY__";
const RUN_SOURCES_KEY = "__SHU_GRAPH_RUN_SOURCES__";
const GRAPH_SLOT_KEY = "__SHU_CACHED_GRAPH_STORE__";

export const deviceReport: TDeviceReport = { warn: (message) => reportToRun("warn", DEVICE_STORE, message), failure: (message, err) => reportFailure(DEVICE_STORE, message, err) };
/** Reports a reading of actuality that failed. */
export const runReport = (message: string, err: unknown): void => reportFailure(RUN_SOURCE, message, err);
const connections = (): TDeviceConnections => pagePinned(CONNECTIONS_KEY, () => ({ opened: new Map<string, Promise<IDBDatabase | null>>(), report: deviceReport }));

/** The name of the database of the actuality the page reads. */
export const servedDatabase = (): string => databaseOf(pageHydration().actualityId());

/** The names of the databases this device holds, one per actuality. */
export const heldDatabases = (): Promise<string[]> => heldDatabaseNames();

/** The database `name` names. The served database replaces the databases an earlier build kept. */
const databaseNamed = (name: string): TDeviceDatabase => deviceDatabase(name, connections(), name === servedDatabase());

/** The readers told of each write to the device. */
const deviceWrites = (): Set<() => void> => pagePinned(WRITE_LISTENERS_KEY, () => new Set<() => void>());

/** Adds a reader of each write to the device, and returns its removal. A write is sent without waiting on it, so a view
 *  that read the device only at its own write would report an older state than the device holds. */
export function followDeviceWrites(fn: () => void): () => void {
	deviceWrites().add(fn);
	return () => deviceWrites().delete(fn);
}

const wrote = (): void => {
	for (const fn of deviceWrites()) fn();
};

/** The device's store a report or a test installs, else the one the page makes of the actuality it reads. */
const storeSlot = (): { store?: TDeviceStore } => pagePinned(STORE_KEY, (): { store?: TDeviceStore } => ({}));

/** The device's store of the actuality the page reads. */
export function pageDeviceStore(): TDeviceStore {
	const slot = storeSlot();
	if (slot.store === undefined) slot.store = new IndexedDbDeviceStore(databaseNamed(servedDatabase()), wrote);
	return slot.store;
}

/** Installs `store` as the device's store of the actuality the page reads. */
export function installDeviceStore(store: TDeviceStore): TDeviceStore {
	storeSlot().store = store;
	return store;
}

/** Installs a device store held in memory, which a report reads, since every report shares one origin. */
export const installMemoryDeviceStore = (): TDeviceStore => installDeviceStore(new MemoryDeviceStore(wrote));

/** The device's quads of the actuality `database` names. */
export const deviceQuads = (database: string): TDeviceQuads => new IndexedDbQuads(databaseNamed(database), GRAPH_BOUND);

/** The graph a report installs, which holds what it carries; the device's graph of the actuality the page serves; and the
 *  graph of another actuality the device holds, while a reader reads it. */
export type TGraphSlot = { installed?: TCachedGraph; served?: TCachedGraph; reading?: TCachedGraph };

/** The graphs the page reads. */
export const graphSlot = (): TGraphSlot => pagePinned(GRAPH_SLOT_KEY, (): TGraphSlot => ({}));

/** What IndexedDB holds for this origin: each database, its stores and their counts. */
export const deviceSummary = (): Promise<TIdbDatabaseSummary[]> => indexedDbSummary();

/** The execution the page reads. */
export const pageExecutions = (): Machine<TExecutionsState, TExecutionsEvent> => pagePinned(EXECUTIONS_KEY, () => machine(INITIAL_EXECUTIONS, executionsTransition));

/** The readings of actuality the views share. */
export const runRegistry = (): TRunRegistry => pagePinned(RUN_REGISTRY_KEY, (): TRunRegistry => ({ reading: new Set(), made: new Set(), at: undefined, span: {} }));

/** The readings made, by their level and whether they read substeps. Ending the page stops each. */
export const graphRunSources = (): Map<string, TGraphRunSource> =>
	pagePinned(
		RUN_SOURCES_KEY,
		() => new Map<string, TGraphRunSource>(),
		(held) => {
			for (const source of held.values()) source.close();
		},
	);
