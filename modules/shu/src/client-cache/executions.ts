/**
 * The executions this device holds, and which of them the page is reading.
 *
 * A run's records name the execution they belong to, so what a device holds of many runs is told apart by the ids
 * themselves rather than by a second index beside them. The executions are read the way everything else is read: a
 * query over the records, here the steps that declared a feature, which is what names an execution for a reader and
 * costs one small query however long the run was.
 */
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { FEATURE_START, declaredName } from "@haibun/core/schema/protocol.js";
import { SEQ_PATH_FIELD, parseRecordName } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { queryQuadStore } from "@haibun/core/lib/quad-store.js";
import { GraphQuerySchema, type TQuad } from "@haibun/core/lib/quad-types.js";
import { cachedGraphStore, selectValuesFor } from "../quads-snapshot.js";
import { RUN_TYPES } from "./run-window.js";
import { componentOfView, declaredViews } from "../rels-cache.js";
import { pagePinned } from "../page-pinned.js";

/** An execution as this device holds it: what it ran, and the moments its features span. */
export type THeldExecution = { execution: string; features: string[]; first?: number; last?: number };

const READING_KEY = "__SHU_READING_EXECUTION__";
type TReading = { chosen?: string; observed?: string; switched: Set<() => void> };
const reading = (): TReading => pagePinned(READING_KEY, () => ({ switched: new Set<() => void>() }));

/** The execution a reader chose, or undefined while the page follows whichever one is being recorded. */
export function currentExecution(): string | undefined {
	return reading().chosen;
}

/** The execution whose records a window last read: what the page is looking at when no reader has chosen one. A run
 *  that has started while a page was following the one before it is the execution being read from that moment, so this
 *  says so the way a reader choosing one does: what is drawn of a run and what is read of it are of the same run. */
export function noteExecution(execution: string): void {
	const held = reading();
	if (held.observed === execution) return;
	const was = readingExecution();
	held.observed = execution;
	// A page learning which run it is reading is not a change of run: it read nothing before and reads that run now.
	// One named run giving way to another is, and that is a run that started while the page followed the one before it.
	if (was === undefined || readingExecution() === was) return;
	for (const fn of held.switched) fn();
}

/** The execution being read: the one chosen, else the one the last window read. Undefined before any has been read. */
export function readingExecution(): string | undefined {
	const held = reading();
	return held.chosen ?? held.observed;
}

/** Read an execution this device holds rather than the one being recorded. Undefined follows the recorded one again. */
export function readExecution(execution: string | undefined): void {
	const held = reading();
	if (held.chosen === execution) return;
	held.chosen = execution;
	for (const fn of held.switched) fn();
}

/** Be told when the execution being read changes, whether a reader chose it or a run that started while the page was
 *  following the one before it became the one being read. */
export function subscribeExecutionSwitch(fn: () => void): () => void {
	const held = reading();
	held.switched.add(fn);
	return () => held.switched.delete(fn);
}

/** Test-only: read the recorded execution again, and forget who was listening. */
export function resetExecutions(): void {
	const held = reading();
	held.chosen = undefined;
	held.observed = undefined;
	held.switched.clear();
}

/** How many feature declarations the listing reads: what names the executions a reader is offered. */
export const EXECUTIONS_READ = 500;

/** The executions this device holds, newest first, each named by the features it ran. */
export async function executionsHeld(): Promise<THeldExecution[]> {
	const { vertices } = await queryQuadStore(
		cachedGraphStore(),
		GraphQuerySchema.parse({
			label: SEQ_PATH_LABEL,
			filters: [{ predicate: SEQ_PATH_FIELD.called, operator: "contains", value: `.${FEATURE_START}` }],
			sortBy: SEQ_PATH_FIELD.generatedAtTime,
			sortOrder: "desc",
			limit: EXECUTIONS_READ,
			skipCount: true,
		}),
	);
	const byExecution = new Map<string, THeldExecution>();
	for (const record of vertices as Array<Record<string, unknown>>) {
		const execution = parseRecordName(String(record[SEQ_PATH_FIELD.id] ?? ""))?.execution;
		if (!execution) continue;
		const at = Date.parse(String(record[SEQ_PATH_FIELD.generatedAtTime] ?? ""));
		const held = byExecution.get(execution) ?? { execution, features: [] };
		const name = declaredName(String(record[SEQ_PATH_FIELD.stepText] ?? ""), "feature");
		if (name && !held.features.includes(name)) held.features.push(name);
		if (!Number.isNaN(at)) {
			held.first = held.first === undefined ? at : Math.min(held.first, at);
			held.last = held.last === undefined ? at : Math.max(held.last, at);
		}
		byExecution.set(execution, held);
	}
	return [...byExecution.values()].sort((a, b) => (b.first ?? 0) - (a.first ?? 0));
}

/**
 * The views this run has shown, as the elements they are shown in, in the order the site declares them.
 *
 * The set comes from the distinct values of the field a step names its view in, which is one answer however many
 * times a view was shown: a view that refreshes its own data is shown by a step per refresh, and reading records to
 * find the set would read those instead of the views shown once each.
 *
 * This is what a page arriving with no address of its own starts on. A page with an address shows what the address
 * names, which is what lets two addresses show different views of one run.
 */
export async function viewsShown(): Promise<string[]> {
	const values = await selectValuesFor(SEQ_PATH_LABEL);
	const shown = new Set(values[SEQ_PATH_FIELD.showed] ?? []);
	return declaredViews()
		.filter((view) => shown.has(view))
		.map(componentOfView);
}

/** How many of a run's records are read at a time while it is forgotten: a run is forgotten in pages so a long one is
 *  never read at once. */
const FORGET_PAGE = 1000;

/** Forget every record of one run this device holds, and answer how many went. A record's id names the run it belongs
 *  to, so what to forget is asked of the records themselves rather than of a second index beside them. */
export async function forgetExecution(execution: string): Promise<number> {
	const store = cachedGraphStore();
	let gone = 0;
	for (const type of RUN_TYPES) {
		for (;;) {
			const { vertices } = await queryQuadStore(
				store,
				GraphQuerySchema.parse({
					label: type.label,
					filters: [{ predicate: SEQ_PATH_FIELD.id, operator: "contains", value: `${execution}.` }],
					limit: FORGET_PAGE,
					skipCount: true,
				}),
			);
			const ids = (vertices as Array<Record<string, unknown>>)
				.map((record) => String(record[SEQ_PATH_FIELD.id] ?? ""))
				.filter((id) => parseRecordName(id)?.execution === execution);
			for (const id of ids) await store.deleteIndividual(type.label, id);
			gone += ids.length;
			if (vertices.length < FORGET_PAGE) break;
		}
	}
	return gone;
}

/** Whether a write failed because the browser has no room left for what this page holds. */
function storageIsFull(err: unknown): boolean {
	return (err as { name?: string } | undefined)?.name === "QuotaExceededError";
}

/**
 * Hold what a window read on this device, in one write.
 *
 * What a device holds is the runs a reader can come back to, and it holds them until the browser has no room left. At
 * that point the oldest run the reader is not reading is forgotten and the write is tried once more, so what is kept
 * is the runs nearest to what a reader is looking at rather than whichever ones were written first. A device with
 * nothing it can forget says so: reading carries on against the site, and a reader who loses the site loses what this
 * write would have held.
 */
export async function holdOnDevice(quads: TQuad[]): Promise<void> {
	if (quads.length === 0) return;
	try {
		await cachedGraphStore().setMany(quads);
	} catch (err: unknown) {
		if (!storageIsFull(err)) return failFastOrLog("the run's records could not be held on this device", err);
		const held = await executionsHeld();
		const oldest = held.filter((one) => one.execution !== readingExecution()).pop();
		if (oldest === undefined) return failFastOrLog("this device is full and holds no run it could forget", err);
		const gone = await forgetExecution(oldest.execution);
		// Making room is what a full device does rather than a failure of the page, so it is said rather than thrown:
		// a reader whose earlier run is no longer here is told why it went.
		console.warn(`[shu] this device is full, so the run ${oldest.execution} and its ${gone} records were forgotten`);
		await cachedGraphStore()
			.setMany(quads)
			.catch((again: unknown) => failFastOrLog("the run's records could not be held on this device after forgetting a run", again));
	}
}
