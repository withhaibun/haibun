/**
 * The page's graph snapshots, one per view scope, with the shared view context and the listeners of each scope. Scope ""
 * is the shared main graph; a view that needs an independent source (the class browser) declares its own scope, so its
 * reads and chip choices never replace another scope's snapshot. The page root pins one store on the page, so the app and
 * an external view, each a bundle of its own, read the same snapshots.
 */
import type { QuadGraphModel } from "@haibun/core/lib/quad-graph-model.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import type { TGraphSnapshot, TSnapshotKey, TSnapshotListener, TViewContext } from "../domains/snapshot.js";

type THeld = { model: QuadGraphModel; key: TSnapshotKey };
type TScope = { held: THeld | undefined };

/** A scope's snapshot before anything is read into it. */
const EMPTY: TGraphSnapshot = { quads: [], clusters: [] };

const sameKey = (a: TSnapshotKey, b: TSnapshotKey): boolean => a.perTypeLimit === b.perTypeLimit && a.types === b.types && a.accessLevel === b.accessLevel;

export class SnapshotStore {
	readonly #scopes = new Map<string, TScope>();
	readonly #listeners = new Set<{ scope: string; fn: TSnapshotListener }>();
	#context: TViewContext = { activeViewId: null };

	/** `failed` receives a listener's failure, which the other listeners outlive. */
	constructor(private readonly failed: (err: unknown) => void) {}

	get context(): TViewContext {
		return this.#context;
	}

	/** Listen to a scope's snapshot and to the view context. Returns the end of the subscription. */
	subscribe(fn: TSnapshotListener, scope: string): () => void {
		const entry = { scope, fn };
		this.#listeners.add(entry);
		return () => this.#listeners.delete(entry);
	}

	setActiveViewId(id: string | null): void {
		if (this.#context.activeViewId === id) return;
		this.#context = { ...this.#context, activeViewId: id };
		this.#notify(undefined);
	}

	/** A scope's snapshot, read without a read; empty before anything is read into it. */
	current(scope: string): TGraphSnapshot {
		const held = this.#scope(scope).held;
		return held === undefined ? EMPTY : held.model.snapshot;
	}

	/** The snapshot a scope holds under `key`, or undefined where it lacks one or holds one read under another key. */
	heldUnder(scope: string, key: TSnapshotKey): TGraphSnapshot | undefined {
		const held = this.#scope(scope).held;
		return held !== undefined && sameKey(held.key, key) ? held.model.snapshot : undefined;
	}

	/** The subjects a scope pins, which a read carries across into the snapshot it reads. */
	pinned(scope: string): ReadonlySet<string> | undefined {
		return this.#scope(scope).held?.model.pinnedSubjects;
	}

	/** A read under a new key replaces what the scope holds, so the view never shows a snapshot of another limit, type set or ceiling. */
	forget(scope: string): void {
		this.#scope(scope).held = undefined;
	}

	/** Hold a read snapshot for a scope, and notify its listeners. */
	adopt(scope: string, model: QuadGraphModel, key: TSnapshotKey): void {
		this.#scope(scope).held = { model, key };
		this.#notify(scope);
	}

	/** Pin subjects into a scope so streamed data never evicts them, starting the scope with `fresh` where it lacks a snapshot. */
	pin(scope: string, subjects: Iterable<string>, fresh: () => THeld): void {
		this.#heldOrFresh(scope, fresh).model.pin(subjects);
	}

	/** Merge observed quads into every scope that holds a snapshot, each bounded by its own limit. Streamed data can arrive
	 *  before a read, so the shared scope starts with `fresh` where it lacks a snapshot. */
	merge(quads: readonly TQuad[], fresh: () => THeld): void {
		this.#heldOrFresh("", fresh);
		for (const [scope, st] of this.#scopes) {
			if (st.held === undefined) continue;
			st.held.model.merge([...quads]);
			this.#notify(scope);
		}
	}

	#heldOrFresh(scope: string, fresh: () => THeld): THeld {
		const st = this.#scope(scope);
		if (st.held === undefined) st.held = fresh();
		return st.held;
	}

	#scope(scope: string): TScope {
		const found = this.#scopes.get(scope);
		if (found !== undefined) return found;
		const created: TScope = { held: undefined };
		this.#scopes.set(scope, created);
		return created;
	}

	/** Notify a scope's listeners of its snapshot; a change of the view context, `undefined`, reaches every listener. */
	#notify(changed: string | undefined): void {
		for (const { scope, fn } of this.#listeners) {
			if (changed !== undefined && scope !== changed) continue;
			const held = this.#scopes.get(scope)?.held;
			try {
				fn(held === undefined ? null : held.model.snapshot, this.#context);
			} catch (err) {
				this.failed(err);
			}
		}
	}
}
