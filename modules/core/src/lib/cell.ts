/**
 * A value and the followers subscribed to it. `set` calls each follower with the new value and the value it replaced.
 * Setting the same value again doesn't call a follower.
 */

/** The interface of a cell: its value, a setter and change subscriptions. shu's shared signal implements it across bundles. */
export interface ICell<T> {
	get(): T;
	set(value: T): void;
	/** Calls `onChange` on each change until the returned function is called. */
	subscribe(onChange: (value: T, before: T) => void): () => void;
}

export class Cell<T> implements ICell<T> {
	#value: T;
	readonly #followers = new Set<(value: T, before: T) => void>();
	constructor(initial: T) {
		this.#value = initial;
	}
	get(): T {
		return this.#value;
	}
	set(value: T): void {
		const before = this.#value;
		if (before === value) return;
		this.#value = value;
		for (const follower of this.#followers) follower(value, before);
	}
	subscribe(onChange: (value: T, before: T) => void): () => void {
		this.#followers.add(onChange);
		return () => this.#followers.delete(onChange);
	}
}
