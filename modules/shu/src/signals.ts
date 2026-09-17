/**
 * Shared lit signals for cross-component reactive state.
 *
 * SCOPE: signals are NOT a cross-bundle transport. Two things must be shared for
 * a signal to work across the app's separate IIFE bundles (main app vs an external viewer
 * viewer), and the library gives neither by default:
 *   1. The signal INSTANCE: a `Signal.State` is a per-module object, so each bundle
 *      gets its own unless the singleton is pinned on `globalThis` (the same trick
 *      `quads-snapshot.ts` uses). `getSignals()` below does that pinning.
 *   2. The polyfill's dependency-tracking context, `signal-polyfill` keeps its
 *      "current consumer" in a module-level variable with no globalThis pinning, so
 *      a `SignalWatcher` in one bundle does NOT reactively track a signal read whose
 *      getter runs in another bundle's copy of the library.
 *
 * Net: signals are the in-(main)-bundle reactive layer. Cross-bundle state keeps the
 * `globalThis` store + its explicit subscribe API as the source of truth and bus;
 * signals mirror it for ergonomic auto-rerender of main-bundle lit components.
 */
import { Signal } from "@lit-labs/signals";
import { NOTHING_SELECTED_LABEL, type TComboboxOption, type TPageContext } from "./schemas.js";

/** The globalThis key every bundle's shared cells are held under, so a page reader outside the bundles finds the same cells. */
export const SHARED_SIGNALS_KEY = "__SHU_SHARED_SIGNALS__";

type SharedCell<T> = { signal: Signal.State<T>; subs: Set<(v: T, before: T) => void> };

/** Resolve (creating once) the globalThis-pinned cell backing a key, so every importer in this realm, including a
 *  separately-bundled IIFE viewer, shares one signal instance AND one subscriber set. */
function getSharedCell<T>(key: string, initial: T): SharedCell<T> {
	const g = globalThis as unknown as Record<string, Map<string, SharedCell<unknown>> | undefined>;
	const map = (g[SHARED_SIGNALS_KEY] ??= new Map<string, SharedCell<unknown>>());
	let cell = map.get(key) as SharedCell<T> | undefined;
	if (!cell) {
		cell = { signal: new Signal.State<T>(initial), subs: new Set() };
		map.set(key, cell as SharedCell<unknown>);
	}
	return cell;
}

/**
 * A reactive cell shared across every component AND every bundle. It pairs a globalThis-pinned `Signal.State` (the
 * in-(main)-bundle reactive layer, reading `get()` inside a lit render() auto-subscribes a SignalWatcher) with a
 * globalThis-pinned subscriber set (the ONLY channel that crosses an esbuild IIFE boundary, since the signal
 * polyfill's dependency-tracking context is module-level and unpinned, see the SCOPE note above). `set()` always
 * co-fires both, so a writer can never update one channel and silently skip the other. Every component reacts the
 * same way in any bundle via `ShuElement.watchSignal` (which calls `subscribe` here), cross-bundle views must NOT
 * rely on reading `get()` in render() for reactivity; only `subscribe` reaches them.
 */
export class SharedSignal<T> {
	readonly #signal: Signal.State<T>;
	readonly #subs: Set<(v: T, before: T) => void>;
	constructor(key: string, initial: T) {
		const cell = getSharedCell(key, initial);
		this.#signal = cell.signal;
		this.#subs = cell.subs;
	}
	get(): T {
		return this.#signal.get();
	}
	/** Set the value and notify every subscriber. An unchanged value is a no-op: every notify repaints all views, so a
	 * re-publish of the same cursor would cause the live "wiggle" when streamed events re-emit the same at-end value. */
	set(v: T): void {
		const before = this.#signal.get();
		if (before === v) return;
		this.#signal.set(v);
		for (const cb of this.#subs) cb(v, before);
	}
	/** Subscribe for this cell's lifetime; returns an unsubscribe. A subscriber is told the value and the value it replaced.
	 *  THE cross-bundle-reliable reactor. */
	subscribe(cb: (v: T, before: T) => void): () => void {
		this.#subs.add(cb);
		return () => this.#subs.delete(cb);
	}
}

/** One move of a machine: the event, and the state before and after it. */
export type TMove<S, E> = { event: E; before: S; after: S };

/**
 * A page-level machine: one state, moved only by events through one pure transition. Its state is a shared cell every
 * component and bundle reads, and each move is told to its followers with the event that made it, so a follower acts
 * on what happened rather than working it out from two states.
 */
export class SharedMachine<S, E> {
	readonly state: SharedSignal<S>;
	readonly #moves: SharedSignal<TMove<S, E> | null>;
	readonly #transition: (state: S, event: E) => S;
	constructor(key: string, initial: S, transition: (state: S, event: E) => S) {
		this.state = new SharedSignal(key, initial);
		this.#moves = new SharedSignal<TMove<S, E> | null>(`${key}:moves`, null);
		this.#transition = transition;
	}
	/** The only writer: raise an event, and every reader sees the next state and every follower the move. An event that
	 *  moves nothing tells no follower. */
	dispatch(event: E): S {
		const before = this.state.get();
		const after = this.#transition(before, event);
		this.state.set(after);
		if (after !== before) this.#moves.set({ event, before, after });
		return after;
	}
	/** Follow each move for as long as the returned function is not called. */
	follow(onMove: (move: TMove<S, E>) => void): () => void {
		return this.#moves.subscribe((move) => {
			if (move) onMove(move);
		});
	}
}

/** Global live time cursor (absolute epoch ms; null = no time filter / "now"). Snapshot-pinned components keep their own cursor and ignore this. */
export const timeCursor = new SharedSignal<number | null>("timeCursor", null);

/** Global active pane: the `columnKey` of the column with actions/keyboard focus (null = none / the query pane). THE one
 *  source of truth for "which column you are on": the chat harvest, every view's `isActiveView`, the strip's active
 *  styling, and the graph dimming all read it, and the pane router is its only writer. Replaces the old split between a
 *  DOM `active` attribute, a `VIEW_ACTIVE` event, and a separate `activeViewId`, which could disagree. */
export const activePane = new SharedSignal<string | null>("activePane", null);

/** What the view the reader acts from states it shows, null until a view states it. The app writes it from each view's
 *  `CONTEXT_CHANGE`, and a view that acts on the page's context reads it wherever the view is placed. */
export const pageContext = new SharedSignal<TPageContext | null>("pageContext", null);

/** A pane in the column strip: its key in `activePane`, the label a breadcrumb names, whether it is the query pane, and
 *  whether it is docked along the bottom of the app rather than laid out as a column. */
export type TStripPane = { key: string; label: string; query: boolean; docked: boolean };

/** The pane docked along the bottom of the app: its key, whether it is open, and whether it is pinned. */
export type TDockedPane = { key: string; open: boolean; pinned: boolean };

/** The pane docked along the bottom of the app, or null where none is. The docked pane is its only writer, and the page
 *  strip reads it to open, close and pin the pane. */
export const dockedPane = new SharedSignal<TDockedPane | null>("dockedPane", null);

/** The types the page searches: what each is called, and the one the search reads now. The actions bar's search is its
 *  only writer, and the page strip offers them beside what the search found. */
export type TPageTypes = { options: ReadonlyArray<TComboboxOption>; selected: string };

export const pageTypes = new SharedSignal<TPageTypes>("pageTypes", { options: [], selected: "" });

/** What the page's breadcrumb names first: the search the query surface describes. The actions bar's search writes it. */
export const pageTrail = new SharedSignal<string>("pageTrail", NOTHING_SELECTED_LABEL);

/** What the page says about itself, which the page strip shows: a failure, a server that didn't answer. */
export const pageStatus = new SharedSignal<string>("pageStatus", "");

/** The panes the column strip holds, in its order. The strip is its only writer. */
export const stripPanes = new SharedSignal<ReadonlyArray<TStripPane>>("stripPanes", []);

// --- Persisted reactive settings -------------------------------------------------------------------------------------
// One mechanism for every global UI setting (data window size, …) so they can't drift into bespoke per-setting wiring.
// localStorage is the durable store; a globalThis-pinned signal is the in-bundle reactive mirror, reading get() in a
// lit render() auto-subscribes the view, so changing a setting in the UI re-renders every view that reads it. (A
// cross-bundle view, a separate IIFE like the polymorphic view, does not track signals across the boundary; a setting that
// must reach one would keep an explicit subscribe, as timeCursor does. Settings consumed in-bundle need none.)

const SETTING_SIGNALS_KEY = "__SHU_SETTING_SIGNALS__";

/** Resolve (creating once) the globalThis-pinned signal backing a setting key, so every importer shares one instance. */
function settingSignal(storageKey: string): Signal.State<string | null> {
	const g = globalThis as unknown as Record<string, Map<string, Signal.State<string | null>> | undefined>;
	const map = (g[SETTING_SIGNALS_KEY] ??= new Map<string, Signal.State<string | null>>());
	let signal = map.get(storageKey);
	if (!signal) {
		signal = new Signal.State<string | null>(null);
		map.set(storageKey, signal);
	}
	return signal;
}

export type PersistedSetting = { get(): string; set(value: string): void };

/** Define a persisted, cross-view reactive setting. `fallback` applies when nothing valid is stored; `isValid` rejects a
 *  stale/foreign stored value. get() reads reactively (auto-subscribes a lit render); set() persists then notifies all. */
/** localStorage may be absent or unusable: a non-DOM test env, or a browser with storage disabled (private mode). */
const canStore = (): boolean => typeof localStorage !== "undefined" && typeof localStorage.getItem === "function";

export function persistedSetting(storageKey: string, fallback: string, isValid: (value: string) => boolean): PersistedSetting {
	const signal = settingSignal(storageKey);
	return {
		get: () => {
			const current = signal.get(); // subscribe; non-null once set() has run this session
			if (current !== null) return current;
			// Lazy seed: read persistence on first use (never at module load), and only when storage is usable; else the fallback.
			const stored = canStore() ? localStorage.getItem(storageKey) : null;
			return stored !== null && isValid(stored) ? stored : fallback;
		},
		set: (value: string) => {
			if (canStore()) localStorage.setItem(storageKey, value);
			signal.set(value); // still notify in-session even when storage is unavailable
		},
	};
}
