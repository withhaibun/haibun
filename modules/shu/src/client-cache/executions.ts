/**
 * The executions this device holds, and which of them the page is reading.
 *
 * A run's records name the execution they belong to, so what a device holds of many runs is told apart by the ids
 * themselves rather than by a second index beside them. The executions are read the way everything else is read: a
 * query over the records, here the steps that declared a feature, which is what names an execution for a reader and
 * costs one small query however long the run was.
 */
import { FEATURE_START, declaredName } from "@haibun/core/schema/protocol.js";
import { SEQ_PATH_FIELD, parseRecordName } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { queryQuadStore } from "@haibun/core/lib/quad-store.js";
import { GraphQuerySchema } from "@haibun/core/lib/quad-types.js";
import { cachedGraphStore } from "../quads-snapshot.js";
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

/** The execution whose records a window last read: what the page is looking at when no reader has chosen one. */
export function noteExecution(execution: string): void {
	reading().observed = execution;
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

/** Be told when the execution being read changes, by a reader choosing one. */
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
