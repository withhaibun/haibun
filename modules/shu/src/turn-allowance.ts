/**
 * What this page gives the turns it asks beyond what the instance names for every turn: the actions the reader allowed
 * after a turn was refused one. It is kept in the page's own store beside its key, so it outlives a reload, and held as a
 * signal, so the ask shows it and the reader withdraws any of it there. A turn is given only what the page holds of it.
 */
import { keep, readKept } from "./page-key.js";
import { pagePinned } from "./page-pinned.js";
import { SharedSignal } from "./signals.js";

/** The name the page keeps what it allows its turns under, in its own store. */
export const TURN_ALLOWANCE_KEPT_AS = "turn-allowance";

/** The actions this page allows its turns, once read from its store. */
export const turnAllowance = new SharedSignal<readonly string[]>("turnAllowance", []);

/** What this page allows its turns, read from its store once per page. */
export async function readTurnAllowance(): Promise<readonly string[]> {
	const pinned = pagePinned<{ reading?: Promise<void> }>("__SHU_TURN_ALLOWANCE__", () => ({}));
	pinned.reading ??= readKept<string[]>(TURN_ALLOWANCE_KEPT_AS).then((kept) => turnAllowance.set(kept ?? []));
	await pinned.reading;
	return turnAllowance.get();
}

/** Allow `action` for the turns this page asks. */
export function allowForTurns(action: string): Promise<void> {
	return changeAllowance((allowed) => (allowed.includes(action) ? allowed : [...allowed, action]));
}

/** Withdraw `action` from what the turns this page asks are given. */
export function withdrawFromTurns(action: string): Promise<void> {
	return changeAllowance((allowed) => allowed.filter((kept) => kept !== action));
}

async function changeAllowance(change: (allowed: readonly string[]) => readonly string[]): Promise<void> {
	const changed = change(await readTurnAllowance());
	await keep(TURN_ALLOWANCE_KEPT_AS, [...changed]);
	turnAllowance.set(changed);
}
