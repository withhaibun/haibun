/**
 * Holds the writes that observe actuality: a copy into the store of what actuality logged or produced. Observation isn't
 * actuality's own activity, so what an observing write logs while it runs isn't observed again, and a store that closes
 * waits for the observing writes begun before its close.
 *
 * An AsyncLocalStorage store marks the writes, so a log a write's statement emits is read as that write's, wherever in the
 * store's code it is emitted.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const observingStore = new AsyncLocalStorage<true>();
/** The observing writes begun and not settled. */
const begun = new Set<Promise<unknown>>();

/** Runs `write` as an observing write, and returns what it returns. */
export function observing<T>(write: () => Promise<T>): Promise<T> {
	const held = observingStore.run(true, write);
	begun.add(held);
	const settled = (): void => void begun.delete(held);
	held.then(settled, settled);
	return held;
}

/** Whether this call is part of an observing write. */
export const isObserving = (): boolean => observingStore.getStore() === true;

/** Settles once every observing write begun before the call settles. It doesn't wait for a write begun after the call. */
export const observationsSettled = async (): Promise<void> => void (await Promise.allSettled([...begun]));
