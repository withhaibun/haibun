/**
 * A view's delays, through the page's clock. A delay the view holds is cancelled when the view leaves the page. A trailing
 * delay replaces the delay held under its name, so a burst of calls runs once after the last one, and a coalesced delay
 * keeps the delay held under its name, so a burst runs once after the first one.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { pageClock } from "../root.js";

/** Calls `fn` after `ms` milliseconds through the page's clock, and returns the call that cancels it. An element that
 *  isn't a Lit host holds the cancel and calls it as it leaves the page. */
export const delay = (ms: number, fn: () => void): (() => void) => pageClock().after(ms, fn);

export class ClockController implements ReactiveController {
	readonly #held = new Map<string, () => void>();

	constructor(host: ReactiveControllerHost) {
		host.addController(this);
	}

	hostDisconnected(): void {
		for (const cancel of this.#held.values()) cancel();
		this.#held.clear();
	}

	/** Returns the instant now. */
	now(): number {
		return pageClock().now();
	}

	/** Calls `fn` `ms` milliseconds after the last call under `name`, and cancels the call it held under `name`. */
	trailing(name: string, ms: number, fn: () => void): void {
		this.cancel(name);
		this.#held.set(
			name,
			pageClock().after(ms, () => {
				this.#held.delete(name);
				fn();
			}),
		);
	}

	/** Calls `fn` `ms` milliseconds after the first call under `name`. A call while one is held under `name` doesn't start
	 *  another, so a burst of calls runs once. */
	coalesce(name: string, ms: number, fn: () => void): void {
		if (!this.holds(name)) this.trailing(name, ms, fn);
	}

	/** Calls `fn` on the next frame, under `name`, and cancels the frame it held under `name`. */
	frame(name: string, fn: () => void): void {
		this.cancel(name);
		this.#held.set(
			name,
			pageClock().frame(() => {
				this.#held.delete(name);
				fn();
			}),
		);
	}

	/** Cancels the call held under `name`. */
	cancel(name: string): void {
		this.#held.get(name)?.();
		this.#held.delete(name);
	}

	/** Whether a call is held under `name`. */
	holds(name: string): boolean {
		return this.#held.has(name);
	}
}
