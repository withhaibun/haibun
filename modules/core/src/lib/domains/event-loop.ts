/**
 * The event loop's delay as a process states it: the stretch past which it warns that a synchronous path held the loop, the
 * delay's summary since its watch began, and the work in flight that such a warning names.
 */

/** How long the loop may be held before the process warns. */
export const LOOP_BLOCK_WARN_MS = 500;

/** The delay since the watch began: its longest and its 99th percentile, in milliseconds, and how many stretches held the loop past the warning. */
export type TLoopSummary = { maxMs: number; p99Ms: number; blocked: number };
/** A watch of the event loop: its summary so far, and its end. */
export type TLoopWatch = { summary(): TLoopSummary; stop(): void };

/** A piece of work the process runs, by the name a warning states: a phase, a cycle method, a step or a statement. */
type TWork = { name: string };
/** The work in flight now. */
const inFlight = new Set<TWork>();
/** The work in flight at any time since the last read: what was in flight then, and what began after it. */
let sinceRead = new Set<TWork>();

/** Runs `within` as the work `name`. A warning that the event loop was held while it was in flight names it. */
export async function runAsWork<T>(name: string, within: () => Promise<T> | T): Promise<T> {
	const work = { name };
	inFlight.add(work);
	sinceRead.add(work);
	try {
		return await within();
	} finally {
		inFlight.delete(work);
	}
}

/** Returns the names of the work in flight at any time since the last call, each once in the order it first began, and starts the
 *  next span. */
export function readWorkSince(): string[] {
	const names = [...new Set([...sinceRead].map(({ name }) => name))];
	sinceRead = new Set(inFlight);
	return names;
}
