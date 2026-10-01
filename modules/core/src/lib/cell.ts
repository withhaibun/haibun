/**
 * A value and the readers that follow it. Each follower is told the value and the value it replaced, and a value set
 * again unchanged doesn't tell a follower.
 */

/** What a cell holds and tells: shu's shared signal implements it across bundles. */
export interface ICell<T> {
	get(): T;
	set(value: T): void;
	/** Follow each change until the returned function is called. */
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
