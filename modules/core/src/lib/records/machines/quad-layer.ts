/**
 * The quads a store holds in its own layer, in the order they were written, indexed by named graph and by subject within
 * a named graph. A write replaces the quads of its subject without scanning the layer, and a read of a graph or of a
 * subject reads only that graph's or that subject's quads, so the time a store's write takes doesn't grow with what it holds.
 */
import type { TQuad } from "../../quad-types.js";

const EMPTY: ReadonlySet<TQuad> = new Set();

const subjectKey = (namedGraph: string, subject: string): string => `${namedGraph}\u0000${subject}`;

/** Adds `quad` to the set `index` holds under `key`, making the set where the index lacks it. */
function indexed(index: Map<string, Set<TQuad>>, key: string, quad: TQuad): void {
	const held = index.get(key);
	if (held === undefined) index.set(key, new Set([quad]));
	else held.add(quad);
}

/** Removes `quad` from the set `index` holds under `key`, and the set once it is empty. */
function unindexed(index: Map<string, Set<TQuad>>, key: string, quad: TQuad): void {
	const held = index.get(key);
	if (held === undefined) return;
	held.delete(quad);
	if (held.size === 0) index.delete(key);
}

export class QuadLayer implements Iterable<TQuad> {
	readonly #quads = new Set<TQuad>();
	readonly #byGraph = new Map<string, Set<TQuad>>();
	readonly #bySubject = new Map<string, Set<TQuad>>();

	[Symbol.iterator](): IterableIterator<TQuad> {
		return this.#quads.values();
	}

	add(quad: TQuad): void {
		this.#quads.add(quad);
		indexed(this.#byGraph, quad.namedGraph, quad);
		indexed(this.#bySubject, subjectKey(quad.namedGraph, quad.subject), quad);
	}

	delete(quad: TQuad): void {
		this.#quads.delete(quad);
		unindexed(this.#byGraph, quad.namedGraph, quad);
		unindexed(this.#bySubject, subjectKey(quad.namedGraph, quad.subject), quad);
	}

	/** The quads of `namedGraph`, in the order they were written. */
	ofGraph(namedGraph: string): ReadonlySet<TQuad> {
		const held = this.#byGraph.get(namedGraph);
		return held === undefined ? EMPTY : held;
	}

	/** The quads of `subject` in `namedGraph`, in the order they were written. */
	ofSubject(namedGraph: string, subject: string): ReadonlySet<TQuad> {
		const held = this.#bySubject.get(subjectKey(namedGraph, subject));
		return held === undefined ? EMPTY : held;
	}

	/** Removes each quad `matches` selects among `candidates`, and returns them. */
	removeWhere(candidates: Iterable<TQuad>, matches: (quad: TQuad) => boolean): TQuad[] {
		const removed = [...candidates].filter(matches);
		for (const quad of removed) this.delete(quad);
		return removed;
	}

	clear(): void {
		this.#quads.clear();
		this.#byGraph.clear();
		this.#bySubject.clear();
	}
}
