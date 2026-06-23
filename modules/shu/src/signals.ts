/**
 * Shared lit signals for cross-component reactive state.
 *
 * SCOPE — signals are NOT a cross-bundle transport. Two things must be shared for
 * a signal to work across the app's separate IIFE bundles (main app vs an external viewer
 * viewer), and the library gives neither for free:
 *   1. The signal INSTANCE — a `Signal.State` is a per-module object, so each bundle
 *      gets its own unless the singleton is pinned on `globalThis` (the same trick
 *      `quads-snapshot.ts` uses). `getSignals()` below does that pinning.
 *   2. The polyfill's dependency-tracking context — `signal-polyfill` keeps its
 *      "current consumer" in a module-level variable with no globalThis pinning, so
 *      a `SignalWatcher` in one bundle does NOT reactively track a signal read whose
 *      getter runs in another bundle's copy of the library.
 *
 * Net: signals are the in-(main)-bundle reactive layer. Cross-bundle state keeps the
 * `globalThis` store + its explicit subscribe API as the source of truth and bus;
 * signals mirror it for ergonomic auto-rerender of main-bundle lit components.
 */
import { Signal } from "@lit-labs/signals";

const SIGNALS_KEY = "__SHU_SIGNALS__";

type ShuSignals = {
	/** Global live time cursor (absolute epoch ms; null = no time filter). Snapshot-pinned components keep their own cursor and ignore this. */
	timeCursor: Signal.State<number | null>;
};

/** Resolve the one signal set, pinned on globalThis so every importer in this realm shares the same instances. */
function getSignals(): ShuSignals {
	const g = globalThis as unknown as Record<string, ShuSignals | undefined>;
	const existing = g[SIGNALS_KEY];
	if (existing) return existing;
	const fresh: ShuSignals = {
		timeCursor: new Signal.State<number | null>(null),
	};
	g[SIGNALS_KEY] = fresh;
	return fresh;
}

export const timeCursorSignal = getSignals().timeCursor;

/** Cross-bundle explicit subscribe for the time cursor (signal reactive tracking doesn't cross esbuild bundle
 * boundaries because the polyfill's dependency context is module-level). Any bundle — including external viewers
 * bundled separately from the shu-app — can subscribe here; the callback list lives on globalThis so both sides
 * share it regardless of which bundle calls subscribe or notify. */
const CURSOR_SUBS_KEY = "__SHU_TIME_CURSOR_SUBS__";

function getCursorSubscribers(): Set<(cursor: number | null) => void> {
	const g = globalThis as unknown as Record<string, Set<(cursor: number | null) => void>>;
	return (g[CURSOR_SUBS_KEY] ??= new Set());
}

export function subscribeTimeCursor(cb: (cursor: number | null) => void): () => void {
	const subs = getCursorSubscribers();
	subs.add(cb);
	return () => subs.delete(cb);
}

export function notifyTimeCursorSubscribers(cursor: number | null): void {
	for (const cb of getCursorSubscribers()) cb(cursor);
}

// --- Persisted reactive settings -------------------------------------------------------------------------------------
// One mechanism for every global UI setting (data window size, …) so they can't drift into bespoke per-setting wiring.
// localStorage is the durable store; a globalThis-pinned signal is the in-bundle reactive mirror — reading get() in a
// lit render() auto-subscribes the view, so changing a setting in the UI re-renders every view that reads it. (A
// cross-bundle view — a separate IIFE like the fisheye — does not track signals across the boundary; a setting that
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
/** localStorage may be absent or unusable — a non-DOM test env, or a browser with storage disabled (private mode). */
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
