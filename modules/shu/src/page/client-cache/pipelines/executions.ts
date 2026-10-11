/**
 * The executions this device holds, and what it deletes to hold another.
 *
 * A run's records name their execution, so the ids themselves separate what a device holds of many runs, rather than a
 * second index beside them. The executions are read from the step records: a step that declared a
 * feature names an execution for a reader.
 */
import { FEATURE_START, declaredName } from "@haibun/core/schema/protocol.js";
import { SEQ_PATH_FIELD, SeqPathSchema, parseRecordName } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { readEvery } from "@haibun/core/lib/records/pipelines/record-reads.js";
import type { TCachedGraph, TDeviceReport } from "../ports.js";
import { RUN_TYPES } from "../derivations/run-rows.js";

/** An execution as this device holds it: the graph of its actuality's records, the features it ran, and the moments
 *  its features span. */
export type THeldExecution = { execution: string; store: TCachedGraph; features: string[]; first: number; last: number };

/** How many feature declarations the listing reads: what names the executions a reader is offered. */
export const EXECUTIONS_READ = 500;

/** What holding a run reads and writes: the graphs of every actuality the device holds, the graph of the one the site
 *  serves, the execution the page reads, and the report of what the device couldn't hold. */
export type THoldScope = { held: () => Promise<TCachedGraph[]>; served: () => TCachedGraph; reading: () => string | undefined; report: TDeviceReport };

/** The executions of every graph, newest first, each named by the features it ran. */
export async function executionsHeld(graphs: TCachedGraph[]): Promise<THeldExecution[]> {
	const held = await Promise.all(graphs.map(executionsIn));
	return held.flat().sort((a, b) => b.first - a.first);
}

/** The executions one actuality's graph holds. */
async function executionsIn(store: TCachedGraph): Promise<THeldExecution[]> {
	// The declarations don't compare a step's `called`, so the read orders the type's steps by time and keeps the steps that
	// declared a feature.
	const records = await readEvery(store, { label: SEQ_PATH_LABEL, sortBy: SEQ_PATH_FIELD.generatedAtTime, sortOrder: "desc" });
	const declared = records
		.map((record) => SeqPathSchema.parse(record))
		.filter((step) => step[SEQ_PATH_FIELD.called]?.includes(`.${FEATURE_START}`))
		.slice(0, EXECUTIONS_READ);
	const byExecution = new Map<string, THeldExecution>();
	for (const step of declared) {
		const name = parseRecordName(step.id);
		if (name === undefined) throw new Error(`the step ${step.id} declared a feature, and its id doesn't name the execution it ran in`);
		const at = Date.parse(step[SEQ_PATH_FIELD.generatedAtTime]);
		if (Number.isNaN(at)) throw new Error(`the step ${step.id} states when it began as ${step[SEQ_PATH_FIELD.generatedAtTime]}, not an instant`);
		const feature = declaredName(step[SEQ_PATH_FIELD.stepText], "feature");
		const held = byExecution.get(name.execution);
		if (held === undefined) byExecution.set(name.execution, { execution: name.execution, store, features: feature ? [feature] : [], first: at, last: at });
		else {
			if (feature && !held.features.includes(feature)) held.features.push(feature);
			held.first = Math.min(held.first, at);
			held.last = Math.max(held.last, at);
		}
	}
	return [...byExecution.values()];
}

/** Deletes every record of one execution this device holds, and returns how many went. A record's id names its
 *  execution, so what to delete is read off the records themselves rather than a second index beside them. */
export async function deleteExecution({ execution, store }: THeldExecution): Promise<number> {
	let gone = 0;
	for (const type of RUN_TYPES) {
		const ids = (await readEvery(store, { label: type.label })).map((record) => recordId(record, type.label)).filter((id) => parseRecordName(id)?.execution === execution);
		for (const id of ids) await store.deleteIndividual(type.label, id);
		gone += ids.length;
	}
	return gone;
}

/** A record's id, which every record of a run states. */
function recordId(record: Record<string, unknown>, label: string): string {
	const id = record[SEQ_PATH_FIELD.id];
	if (typeof id !== "string") throw new Error(`a record of ${label} states its id as ${typeof id}, not a string`);
	return id;
}

/** Whether a write failed because the browser lacks room for what this page holds. */
const storageIsFull = (err: unknown): boolean => err instanceof DOMException && err.name === "QuotaExceededError";

/**
 * Holds what a window read on this device, in one write.
 *
 * What a device holds is the runs a reader can come back to, and it holds them until the browser lacks room. At that
 * point the oldest run the reader isn't reading is deleted and the write is tried once more, so what is kept is the runs
 * nearest to what a reader reads rather than whichever ones were written first. A device without a run it can delete
 * reports so: reading carries on against the site, and a reader who loses the site loses what this write would have
 * held.
 */
export async function holdOnDevice(scope: THoldScope, quads: TQuad[]): Promise<void> {
	if (quads.length === 0) return;
	try {
		await scope.served().setMany(quads);
	} catch (err: unknown) {
		if (!storageIsFull(err)) return scope.report.failure("actuality's records could not be held on this device", err);
		const held = await executionsHeld(await scope.held());
		const oldest = held.filter((one) => one.execution !== scope.reading()).pop();
		if (oldest === undefined) return scope.report.failure("this device is full, and it holds only the execution being read", err);
		const gone = await deleteExecution(oldest);
		// Making room is what a full device does rather than a failure of the page, so it is reported rather than thrown:
		// a reader whose earlier run is gone reads why.
		scope.report.warn(`this device is full, so actuality ${oldest.execution} and its ${gone} records were deleted`);
		await scope
			.served()
			.setMany(quads)
			.catch((again: unknown) => scope.report.failure("actuality's records could not be held on this device after deleting a run", again));
	}
}
