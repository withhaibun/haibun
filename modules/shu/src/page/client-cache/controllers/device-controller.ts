/**
 * What the device holds of actuality, as the views read it: the graph the page reads (the site's, a report's, or another
 * actuality's the device holds), the actuality feature the page reads, an actuality a report carries, and the device's store of
 * the site's registry.
 */
import { readDeclarationsOfCatalog, type TReadDeclarations } from "@haibun/core/lib/records/derivations/read-records.js";
import type { TCachePayload } from "../../../domains/hydration.js";
import { getConcernCatalog } from "../../controllers/catalog-controller.js";
import { deviceQuads, graphSlot, heldDatabases, installMemoryDeviceStore, pageActualityFeatures, servedDatabase } from "../root.js";
import type { TCachedGraph, TDeviceGraph, TGraphSaturation } from "../ports.js";
import { DeviceGraph } from "../pipelines/device-graph.js";
import { readCarriedActuality } from "../pipelines/carried-actuality.js";
import { ACTUALITY_FEATURES_EVENT, readingOf } from "../machines/actuality-features.js";

export { followDeviceWrites, pageDeviceStore, deviceSummary } from "../root.js";
export { CACHE_SHAPE } from "../root.js";
export type { TGraphSaturation, TStoredRegistry } from "../ports.js";
export type { TIdbDatabaseSummary } from "../adapters/idb-summary.js";

/** Returns the read declarations of the types the page's concern catalog lists. */
export const pageReadDeclarations = (): TReadDeclarations => readDeclarationsOfCatalog(getConcernCatalog());

/** The device's graph of the actuality `database` names. */
export const deviceGraph = (database: string): TDeviceGraph => new DeviceGraph(deviceQuads(database), pageReadDeclarations);

/** Installs the graph the page reads: a report's, held in memory, which holds what the report carries. */
export function installGraph(graph: TCachedGraph): void {
	graphSlot().installed = graph;
}

/** The graph of what the site serves: a report's where one is installed, else the device's. */
export function servedGraph(): TCachedGraph {
	const slot = graphSlot();
	if (slot.installed !== undefined) return slot.installed;
	slot.served ??= deviceGraph(servedDatabase());
	return slot.served;
}

/** Reads the records `graph` holds, or the site's again where it is the graph of what the site serves. */
export function readHeldGraph(graph: TCachedGraph): void {
	const slot = graphSlot();
	if (graph === servedGraph()) delete slot.reading;
	else slot.reading = graph;
}

/** Whether the page reads a graph of the device other than the one it serves, as it reads another actuality's records. */
export const readsHeldGraph = (): boolean => graphSlot().reading !== undefined;

/** The graph the page reads. */
export const cachedGraph = (): TCachedGraph => {
	const reading = graphSlot().reading;
	return reading === undefined ? servedGraph() : reading;
};

/** The device's graph of each actuality it holds. A report holds only what it carries, in memory, so the list is empty. */
export async function deviceGraphs(): Promise<TDeviceGraph[]> {
	if (graphSlot().installed !== undefined) return [];
	return (await heldDatabases()).map(deviceGraph);
}

/** How full the device's graph of each actuality is, by its database. */
export const graphSaturations = async (): Promise<Array<{ database: string; saturation: TGraphSaturation }>> =>
	Promise.all((await deviceGraphs()).map(async (graph) => ({ database: graph.database, saturation: await graph.saturation() })));

/** The graph of each actuality the page holds records of, the one of what the site serves first. */
export async function heldGraphs(): Promise<TCachedGraph[]> {
	const served = servedGraph();
	const others = (await deviceGraphs()).filter((graph) => graph.database !== servedDatabase());
	return [served, ...others];
}

/** The actuality feature a reader chose, or undefined while the page follows whichever one is being recorded. */
export const currentActualityFeature = (): string | undefined => pageActualityFeatures().state.get().chosen;

/** The actuality feature being read: the one chosen, else the one the last window read. Undefined before any has been read. */
export const readingActualityFeature = (): string | undefined => readingOf(pageActualityFeatures().state.get());

/** Notes the actuality feature whose records a window last read: what the page is looking at when a reader hasn't chosen one. */
export function noteActualityFeature(actualityFeature: string): void {
	pageActualityFeatures().dispatch({ type: ACTUALITY_FEATURES_EVENT.OBSERVE, actuality: actualityFeature });
}

/** Reads an actuality feature this device holds rather than the one being recorded. Undefined follows the recorded one again. */
export function readActualityFeature(actualityFeature: string | undefined): void {
	pageActualityFeatures().dispatch({ type: ACTUALITY_FEATURES_EVENT.CHOOSE, actuality: actualityFeature });
}

/** Calls `fn` each time the actuality feature being read changes, whether a reader chose it or an actuality feature that started while the
 *  page followed the one before it became the one being read. Returns the unsubscribe. */
export const subscribeActualityFeatureSwitch = (fn: () => void): (() => void) =>
	pageActualityFeatures().follow(({ before, after }) => {
		if (after.switches !== before.switches) fn();
	});

/** Follows the actuality feature being recorded again, in the records the site serves: what takes a reader off an actuality feature
 *  they chose and back to whatever is happening now. */
export function followRecordedActualityFeature(): void {
	readHeldGraph(servedGraph());
	readActualityFeature(undefined);
}

/** Reads what a report carries of an actuality, from then. */
export const hydrateClientCache = (cache: TCachePayload): Promise<void> =>
	readCarriedActuality({ installDeviceStore: installMemoryDeviceStore, installGraph, readActuality: readActualityFeature, declarations: pageReadDeclarations }, cache);
