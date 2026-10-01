/**
 * Holding a machine's transition to its table. A test states the status each event moves each status to, as data, and
 * runs seeded random event sequences against the rule the machine keeps. The same seed gives the same sequence, so a
 * failing sequence is replayed by its seed.
 */
import { expect } from "vitest";
import type { TTransition } from "../machine.js";
import { itemAt } from "../util/item-at.js";

/** A generator of numbers in [0, 1) from the seed. */
export function seededRandom(seed: number): () => number {
	let at = seed;
	return () => {
		at = (at * 1_103_515_245 + 12_345) % 2_147_483_648;
		return at / 2_147_483_648;
	};
}

/** One item of the list, chosen by the generator. */
export const pickWith = <T>(random: () => number, items: readonly T[]): T => itemAt(items, Math.floor(random() * items.length));

/** A row of a table: `status` for every event but those `moves` names. */
export const staying = <E extends string, S>(events: readonly E[], status: S, moves: Partial<Record<E, S>>): Record<E, S> =>
	Object.fromEntries(events.map((event) => [event, moves[event] ?? status])) as Record<E, S>;

/** Assert that a state `at` each status holds it, and that every event moves it to the status the table states. */
export function assertTable<S extends string, E extends string, M, V>(
	table: Record<S, Record<E, S>>,
	at: Record<S, M>,
	{ events, statusOf, event, transition }: { events: readonly E[]; statusOf: (state: M) => S; event: (type: E) => V; transition: TTransition<M, V> },
): void {
	for (const status of Object.keys(table) as S[]) {
		expect(statusOf(at[status]), `the state at ${status}`).toBe(status);
		for (const type of events) expect(statusOf(transition(at[status], event(type))), `${status} + ${type}`).toBe(table[status][type]);
	}
}

/**
 * Run seeded random sequences. Each seed starts a context, and each step moves it with the seed's generator; `label`
 * adds a move to the sequence and names the seed and the sequence so far, for a failure's message.
 */
export function runSequences<C>(start: () => C, step: (context: C, random: () => number, label: (move: string) => string) => void, { seeds = 200, steps = 40 } = {}): void {
	for (let seed = 1; seed <= seeds; seed++) {
		const random = seededRandom(seed);
		const context = start();
		const path: string[] = [];
		const label = (move: string) => {
			path.push(move);
			return `seed ${seed}: ${path.join(" ")}`;
		};
		for (let at = 0; at < steps; at++) step(context, random, label);
	}
}
