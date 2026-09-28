/**
 * What every *.controls.ts stepper shares: the page web-playwright drives, and the waits a control takes on it.
 * Playwright's locators reach into shadow roots, so a control finds an element by its selector and doesn't walk roots.
 */
import type { Locator, Page } from "playwright";
import WebPlaywright from "@haibun/web-playwright";
import type { AStepper } from "@haibun/core/lib/astepper.js";

/** How long a control waits for a state the page reaches soon after it acts: a render, a debounced repaint. */
export const STATE_MS = 5_000;
/** How long a control waits for a state that takes a round trip through the run: a save, a read back. */
export const ROUND_TRIP_MS = 10_000;
/** How long a control waits for a layout or a stream to come to rest. */
export const SETTLES_MS = 15_000;
/** The events a control dispatches as a person's input starts them. */
export const INPUT_EVENT = { click: "click", pointerdown: "pointerdown", wheel: "wheel" } as const;
/** What a report names where a point doesn't hold an element. */
export const NO_ELEMENT = "∅";

/** A fraction as a percentage, for a refusal to state. */
export const percent = (fraction: number, digits = 0): string => `${(fraction * 100).toFixed(digits)}%`;

/** The world's web-playwright, which drives the page and holds the storage a control saves an artifact to. */
export function controlledBrowser(stepper: AStepper): WebPlaywright {
	const wp = stepper.getWorld().runtime.steppers?.find((s) => s instanceof WebPlaywright) as WebPlaywright | undefined;
	if (!wp) throw new Error(`${stepper.constructor.name}: the world doesn't hold WebPlaywright`);
	return wp;
}

/** The page the world's web-playwright drives, which a controls stepper reads and acts on. */
export async function controlledPage(stepper: AStepper): Promise<Page> {
	return (await controlledBrowser(stepper).getPage()) as unknown as Page;
}

/** Read `read` until it satisfies `ok`, as a re-render or a backfill lands; returns the last value read. */
export async function pollUntil<T>(page: Page, read: () => Promise<T>, ok: (v: T) => boolean, tries = 25, ms = 200): Promise<T> {
	let v = await read();
	for (let i = 1; i < tries && !ok(v); i++) {
		await page.waitForTimeout(ms);
		v = await read();
	}
	return v;
}

/** Whether an error is Playwright's timeout, which a bounded wait reads as the page not reaching the state it waited for. */
const isTimeout = (e: unknown): boolean => e instanceof Error && e.name === "TimeoutError";

/**
 * Whether `test` comes to hold of the element `locator` finds within `timeout`, running it in the page on each frame.
 * The test takes the element and `arg` only, since the page runs it apart from this module. An error other than the
 * timeout, such as one the test throws, is thrown.
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

/** Wait until `test` holds of the element `locator` finds. A wait that times out is refused naming `state`, the state it
 *  waited for, so a failure says which of a step's waits the page didn't reach. */
export async function until<E extends HTMLElement, A>(locator: Locator, state: string, test: (on: { el: E; arg: A }) => boolean, arg: A, timeout = SETTLES_MS): Promise<void> {
	if (!(await comesToHold(locator, test, arg, timeout))) throw new Error(`waited ${timeout}ms for ${state}, and the page didn't reach it`);
}

/** Wait until `locator` finds an element in the page, shown or not. */
export function attached(locator: Locator, timeout = STATE_MS): Promise<void> {
	return locator.waitFor({ state: "attached", timeout });
}

/** Whether `locator` comes to find at least `count` elements within `timeout`. */
export function findsAtLeast(locator: Locator, count: number, timeout = STATE_MS): Promise<boolean> {
	return attached(locator.nth(count - 1), timeout).then(
		() => true,
		() => false,
	);
}
