/**
 * The actualities the device holds, as the client cache view and the readings of actuality use them: the list a reader
 * chooses from, the deletion of one, the reading of one, and the write of what a window read, which deletes the oldest
 * where the device is full.
 */
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { deviceReport } from "../root.js";
import * as Actualities from "../pipelines/actualities.js";
import { heldGraphs, readExecution, readHeldGraph, readingExecution, readsHeldGraph, servedGraph } from "./device-controller.js";

export { FEATURES_READ, type THeldActuality } from "../pipelines/actualities.js";

/** The actualities this device holds, newest first, each named by the features it ran. */
export const actualitiesHeld = async (): Promise<Actualities.THeldActuality[]> => Actualities.actualitiesHeld(await heldGraphs());

/** Deletes every record of one actuality this device holds, and returns how many went. */
export const deleteActuality = (held: Actualities.THeldActuality): Promise<number> => Actualities.deleteActuality(held);

/** Reads a held actuality from its newest feature's execution, in the graph of its records. */
export function readHeldActuality(held: Actualities.THeldActuality): void {
	readHeldGraph(held.store);
	readExecution(held.newest);
}

/** Holds what a window read on this device, in one write, deleting the oldest actuality the reader isn't reading where the
 *  device is full. A window read from another graph the device holds isn't written again. */
export const holdOnDevice = (quads: TQuad[]): Promise<void> =>
	Actualities.holdOnDevice({ held: heldGraphs, served: servedGraph, readsHeld: readsHeldGraph, reading: readingExecution, report: deviceReport }, quads);
