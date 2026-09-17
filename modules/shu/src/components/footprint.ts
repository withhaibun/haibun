/**
 * FootprintController sets the height an element takes along the bottom of its positioning host, as a custom property on
 * that host, so the host keeps its content clear of the element. The element measures that height. The controller
 * removes the property where the element measures none, and where the element leaves the page.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";

export class FootprintController implements ReactiveController {
	readonly #host: ReactiveControllerHost & HTMLElement;
	readonly #property: string;
	/** The height to reserve, or null where the element reserves none. */
	readonly #measure: () => number | null;
	#footprintHost: HTMLElement | null = null;
	#footprint = -1;
	#observer: ResizeObserver | null = null;

	constructor(host: ReactiveControllerHost & HTMLElement, property: string, measure: () => number | null) {
		this.#host = host;
		this.#property = property;
		this.#measure = measure;
		host.addController(this);
	}

	hostConnected(): void {
		// The element spans its host's width, so what it holds wraps and its height changes with the window.
		this.#observer = new ResizeObserver(() => this.publish());
		this.#observer.observe(this.#host);
	}

	hostUpdated(): void {
		this.publish();
	}

	hostDisconnected(): void {
		this.#observer?.disconnect();
		this.#observer = null;
		this.#withdraw();
	}

	/** Set the measured height on the positioning host, once per change, or withdraw it where there is none. */
	publish(): void {
		const height = this.#measure();
		if (height === null) return this.#withdraw();
		const host = this.#host.offsetParent as HTMLElement | null;
		if (!host) return;
		const rounded = Math.ceil(height);
		if (host === this.#footprintHost && rounded === this.#footprint) return;
		if (this.#footprintHost && this.#footprintHost !== host) this.#withdraw();
		this.#footprintHost = host;
		this.#footprint = rounded;
		host.style.setProperty(this.#property, `${rounded}px`);
	}

	#withdraw(): void {
		this.#footprintHost?.style.removeProperty(this.#property);
		this.#footprintHost = null;
		this.#footprint = -1;
	}
}
