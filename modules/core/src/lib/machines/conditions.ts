/**
 * Conditions that repeat, such as a task whose every tick fails or a statement that runs slowly each time: each is held by
 * its key from the occurrence that starts it to the one that ends it, so its reporter states it once as it starts and once as
 * it ends, with how often it occurred, in place of every occurrence. A store of conditions holds at most its bound; a new
 * condition past the bound drops the condition held longest, whose next occurrence starts it again.
 */

/** A condition while it holds: the detail of its first and its latest occurrence, when it started, and how often it occurred. */
export type THeldCondition = { first: string; latest: string; since: number; occurrences: number };

export class Conditions {
	readonly #held = new Map<string, THeldCondition>();

	/** `bound` is the most conditions held at once. */
	constructor(private readonly bound: number) {
		if (!Number.isInteger(bound) || bound < 1) throw new Error(`a store of conditions holds at least one; ${bound} isn't a whole number of 1 or more`);
	}

	/** Records an occurrence of the condition `key` at `at`, and returns whether it starts the condition. */
	occurs(key: string, detail: string, at: number): boolean {
		const held = this.#held.get(key);
		if (held !== undefined) {
			this.#held.set(key, { ...held, latest: detail, occurrences: held.occurrences + 1 });
			return false;
		}
		if (this.#held.size >= this.bound) {
			const [oldest] = this.#held.keys();
			if (oldest !== undefined) this.#held.delete(oldest);
		}
		this.#held.set(key, { first: detail, latest: detail, since: at, occurrences: 1 });
		return true;
	}

	/** Ends the condition `key`, and returns what it held, or undefined where it didn't hold. */
	ends(key: string): THeldCondition | undefined {
		const held = this.#held.get(key);
		this.#held.delete(key);
		return held;
	}

	/** How many conditions hold. */
	get size(): number {
		return this.#held.size;
	}
}
