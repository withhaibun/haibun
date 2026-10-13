/**
 * A view's observations of the page, through the page's observers: an element's resizes, its attribute changes and the
 * changes of a media query. Each observation the view starts ends when the view leaves the page.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { pageObservers } from "../root.js";

export class ObserverController implements ReactiveController {
	readonly #stops: Array<() => void> = [];

	constructor(host: ReactiveControllerHost) {
		host.addController(this);
	}

	hostDisconnected(): void {
		for (const stop of this.#stops.splice(0)) stop();
	}

	/** Calls `fn` each time `target`'s box changes size. */
	resizes(target: Element, fn: () => void): void {
		this.#stops.push(pageObservers().resizes(target, fn));
	}

	/** Calls `fn` each time an attribute `names` lists changes on `target`, or on an element under it where `subtree` holds. */
	attributes(target: Element, names: readonly string[], subtree: boolean, fn: () => void): void {
		this.#stops.push(pageObservers().attributes(target, names, subtree, fn));
	}

	/** Calls `fn` each time whether the page matches the media query `query` changes. */
	mediaChanges(query: string, fn: () => void): void {
		this.#stops.push(pageObservers().mediaChanges(query, fn));
	}
}
