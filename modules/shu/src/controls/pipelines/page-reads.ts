/**
 * What a control reads of the page, and the waits it takes on it. Playwright's locators reach into shadow roots, so a read
 * finds an element by its selector and doesn't walk roots. A function a read runs in the page takes only its element and
 * an argument, since the page runs it apart from this module.
 */
import type { Locator, Page } from "playwright";
import { objectId } from "../../page/derivations/record-fields.js";

/** A fraction as a percentage to `digits` places, for a refusal to state. */
export const percent = (fraction: number, digits: number): string => `${(fraction * 100).toFixed(digits)}%`;

/** Reads `read` until it satisfies `ok`, as a render or a backfill arrives, up to `tries` reads `ms` apart, and returns the last value read. */
export async function pollUntil<T>(page: Page, read: () => Promise<T>, ok: (v: T) => boolean, tries: number, ms: number): Promise<T> {
	let v = await read();
	for (let i = 1; i < tries && !ok(v); i++) {
		await page.waitForTimeout(ms);
		v = await read();
	}
	return v;
}

/** Whether an error is Playwright's timeout, which a bounded wait reads as the page not reaching the state it awaited. */
const isTimeout = (e: unknown): boolean => e instanceof Error && e.name === "TimeoutError";

/**
 * Whether `test` comes to hold of the element `locator` finds within `timeout`, running it in the page on each frame. An
 * error other than the timeout, such as one the test throws, is thrown.
 */
export async function comesToHold<E extends HTMLElement, A>(locator: Locator, test: (on: { el: E; arg: A }) => boolean, arg: A, timeout: number): Promise<boolean> {
	const el = await locator.evaluateHandle((found: E) => found);
	// The page receives the handle as the element it names, which Playwright's types can't state for a generic element.
	return locator
		.page()
		.waitForFunction(test as (on: unknown) => boolean, { el, arg } as unknown, { timeout })
		.then(
			() => true,
			(e: unknown) => {
				if (isTimeout(e)) return false;
				throw e;
			},
		);
}

/** Waits until `test` holds of the element `locator` finds. A wait that times out is refused naming `state`, so a failure
 *  names which of a step's waits the page didn't reach. */
export async function until<E extends HTMLElement, A>(locator: Locator, state: string, test: (on: { el: E; arg: A }) => boolean, arg: A, timeout: number): Promise<void> {
	if (!(await comesToHold(locator, test, arg, timeout))) throw new Error(`waited ${timeout}ms for ${state}, and the page didn't reach it`);
}

/** Waits until `locator` finds an element in the page, shown or not. */
export const attached = (locator: Locator, timeout: number): Promise<void> => locator.waitFor({ state: "attached", timeout });

/** A node of a graph as a control reads it: its id, its type, and its name where it has one. */
export type TNodeRead = { id: string; type: string; name?: string };

/** The node that `match` names: by its handle `type:id`, by its bare id, or by a part of its name. */
export const nodeMatching = (nodes: TNodeRead[], match: string): TNodeRead | undefined =>
	nodes.find((n) => objectId(n.type, n.id) === match || n.id === match || (n.name !== undefined && n.name.includes(match)));
