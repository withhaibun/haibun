/**
 * The quads a store holds in its own layer, in the order they were written, indexed by named graph, by subject within a
 * named graph, by subject in every graph and by predicate. A write replaces the quads of its subject without scanning the
 * layer, and a read of a graph, a subject or a predicate reads only those quads, so the time a store's write or read takes
 * doesn't grow with what it holds.
 */
import type { TQuad, TQuadPattern } from "../../steps/domains/quad-types.js";

const EMPTY: ReadonlySet<TQuad> = new Set();

/** The set an index holds, or the empty set where the index lacks the key. */
const heldOrEmpty = (held: ReadonlySet<TQuad> | undefined): ReadonlySet<TQuad> => (held === undefined ? EMPTY : held);

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
	readonly #bySubjectInEveryGraph = new Map<string, Set<TQuad>>();
	readonly #byPredicate = new Map<string, Set<TQuad>>();

	[Symbol.iterator](): IterableIterator<TQuad> {
		return this.#quads.values();
	}

	add(quad: TQuad): void {
		this.#quads.add(quad);
		indexed(this.#byGraph, quad.namedGraph, quad);
		indexed(this.#bySubject, subjectKey(quad.namedGraph, quad.subject), quad);
		indexed(this.#bySubjectInEveryGraph, quad.subject, quad);
		indexed(this.#byPredicate, quad.predicate, quad);
	}

	delete(quad: TQuad): void {
		this.#quads.delete(quad);
		unindexed(this.#byGraph, quad.namedGraph, quad);
		unindexed(this.#bySubject, subjectKey(quad.namedGraph, quad.subject), quad);
		unindexed(this.#bySubjectInEveryGraph, quad.subject, quad);
		unindexed(this.#byPredicate, quad.predicate, quad);
	}

	/** The quads of `namedGraph`, in the order they were written. */
	ofGraph(namedGraph: string): ReadonlySet<TQuad> {
		return heldOrEmpty(this.#byGraph.get(namedGraph));
	}

	/** The quads of `subject` in `namedGraph`, in the order they were written. */
	ofSubject(namedGraph: string, subject: string): ReadonlySet<TQuad> {
		return heldOrEmpty(this.#bySubject.get(subjectKey(namedGraph, subject)));
	}

	/** The quads a pattern can match, from the smallest index the pattern names: its subject's in its graph, its graph's,
	 *  its subject's in every graph or its predicate's. A pattern that doesn't name a graph, a subject or a predicate reads
	 *  every quad. Each set holds its quads in the order they were written. */
	candidates(pattern: TQuadPattern): ReadonlySet<TQuad> {
		const { namedGraph, subject, predicate } = pattern;
		const indexes: ReadonlySet<TQuad>[] = [];
		if (namedGraph !== undefined) indexes.push(subject === undefined ? this.ofGraph(namedGraph) : this.ofSubject(namedGraph, subject));
		else if (subject !== undefined) indexes.push(heldOrEmpty(this.#bySubjectInEveryGraph.get(subject)));
		if (predicate !== undefined) indexes.push(heldOrEmpty(this.#byPredicate.get(predicate)));
		return indexes.reduce<ReadonlySet<TQuad>>((smallest, index) => (index.size < smallest.size ? index : smallest), this.#quads);
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
		this.#bySubjectInEveryGraph.clear();
		this.#byPredicate.clear();
	}
}
