/**
 * Shared lit signals for cross-component reactive state.
 *
 * SCOPE — signals are NOT a cross-bundle transport. Two things must be shared for
 * a signal to work across the app's separate IIFE bundles (main app vs the fisheye
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
