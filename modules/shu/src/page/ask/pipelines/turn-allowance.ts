/**
 * What this page gives the turns it sends beyond what the instance names for every turn: the actions the reader allowed
 * after a turn was refused one. It is kept in the page's own store beside its key, so it outlives a reload, and held in a
 * cell, so the ask shows it and the reader withdraws any of it there. A turn is given only what the page holds of it.
 */
import { z } from "zod";
import type { TAllowanceScope } from "../ports.js";

/** What the page keeps of what it allows its turns: the actions. */
const TurnAllowanceSchema = z.array(z.string());

/** The name the page keeps what it allows its turns under, in its own store. */
export const TURN_ALLOWANCE_KEPT_AS = "turn-allowance";

/** What this page allows its turns, read from its store once per page. A store that doesn't hold an allowance allows
 *  only what the instance names. */
export async function readTurnAllowance(scope: TAllowanceScope): Promise<readonly string[]> {
	scope.reading.read ??= scope.kept.read(TURN_ALLOWANCE_KEPT_AS).then((kept) => scope.allowed.set(kept === undefined ? [] : TurnAllowanceSchema.parse(kept)));
	await scope.reading.read;
	return scope.allowed.get();
}

/** Allows `action` for the turns this page sends. */
export const allowForTurns = (scope: TAllowanceScope, action: string): Promise<void> =>
	changeAllowance(scope, (allowed) => (allowed.includes(action) ? allowed : [...allowed, action]));

/** Withdraws `action` from what the turns this page sends are given. */
export const withdrawFromTurns = (scope: TAllowanceScope, action: string): Promise<void> => changeAllowance(scope, (allowed) => allowed.filter((kept) => kept !== action));

async function changeAllowance(scope: TAllowanceScope, change: (allowed: readonly string[]) => readonly string[]): Promise<void> {
	const changed = change(await readTurnAllowance(scope));
	await scope.kept.keep(TURN_ALLOWANCE_KEPT_AS, [...changed]);
	scope.allowed.set(changed);
}
