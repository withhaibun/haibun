import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { SseClient, inAction } from "./sse-client.js";
import { getAvailableSteps } from "./rpc-registry.js";

export const DEFAULT_PER_TYPE_LIMIT = 100;

export type TGraphSnapshot = { quads: TQuad[]; clusters: TCluster[] };

/**
 * Shared UI-state that travels alongside the data snapshot. Viewers consult this
 * to decide their behaviour: a non-active viewer still wants to know the active
 * view id (so it can lay itself out for off-screen sync) and the currently
 * selected subject (so it can zoom/highlight without waiting for the next event).
 */
export type TViewContext = { activeViewId: string | null; selectedSubject: string | null; selectedLabel: string | null };

/** Subscribers fired after the cached snapshot or shared view-context changes. */
type SnapshotListener = (snapshot: TGraphSnapshot | null, context: TViewContext) => void;

type CacheEntry = { snapshot: TGraphSnapshot; perTypeLimit: number; typesKey: string };

/**
 * Underlying store. The cache, view context, and listener set live here so a
 * single instance is reachable from every bundle that imports this module via
 * `globalThis.__SHU_QUADS_SNAPSHOT_STORE__` — see `getStore()`.
 */
type Store = {
	cache: CacheEntry | null;
	pending: Promise<TGraphSnapshot> | null;
	viewContext: TViewContext;
	listeners: Set<SnapshotListener>;
};

/**
 * The shu app and external clustered viewers (fisheye) ship as separate IIFE
 * bundles. Each bundle has its own copy of this module's variable bindings, so
 * a Set / object held inside a closure here is duplicated per bundle. Hoisting
 * the live state onto a globalThis-keyed singleton means every importer
 * resolves to the same cache + listener set + view context.
 *
 * Cost is one global property; benefit is one HTTP fetch and one in-memory
 * snapshot for an arbitrarily large dataset, plus selection / data events
 * propagating across bundle boundaries without a DOM round-trip.
 */
const STORE_KEY = "__SHU_QUADS_SNAPSHOT_STORE__";

function getStore(): Store {
	const g = globalThis as unknown as Record<string, Store | undefined>;
	const existing = g[STORE_KEY];
	if (existing) return existing;
	const fresh: Store = {
		cache: null,
		pending: null,
		viewContext: { activeViewId: null, selectedSubject: null, selectedLabel: null },
		listeners: new Set(),
	};
	g[STORE_KEY] = fresh;
	return fresh;
}

export function getViewContext(): TViewContext {
	return getStore().viewContext;
}

export function setActiveViewId(id: string | null): void {
	const s = getStore();
	if (s.viewContext.activeViewId === id) return;
	s.viewContext = { ...s.viewContext, activeViewId: id };
	notify(s);
}

export function setSelectedSubject(subject: string | null, label: string | null): void {
	const s = getStore();
	if (s.viewContext.selectedSubject === subject && s.viewContext.selectedLabel === label) return;
	s.viewContext = { ...s.viewContext, selectedSubject: subject, selectedLabel: label };
	notify(s);
}

/**
 * Subscribe to changes in the shared clustered data and view context. Listeners
 * fire on initial fetch, incremental SSE merges, active-view changes, and
 * selection changes — receiving the current snapshot plus a `TViewContext`
 * carrying `activeViewId` + `selectedSubject` + `selectedLabel`.
 *
 * Implementors should gate expensive re-renders on whether their view is the
 * strip's active pane (`isActiveView` from ShuElement). Inactive viewers can
 * defer the work — the snapshot stays cached and they will pick up the latest
 * state on next activation, while burning no cycles updating a hidden surface.
 * They can still react to context changes (e.g. zoom to selected subject) since
 * those are cheap relative to a full re-layout.
 *
 * Returns an unsubscribe function — call from disconnectedCallback.
 */
export function subscribeSnapshot(listener: SnapshotListener): () => void {
	const s = getStore();
	s.listeners.add(listener);
	return () => s.listeners.delete(listener);
}

/**
 * Convenience wrapper that diffs the shared store's fields between firings and
 * routes each kind of change to a separate callback. Removes the boilerplate
 * each clustered viewer would otherwise repeat (track previous values, compare,
 * dispatch). All callbacks are optional.
 */
export type TViewContextCallbacks = {
	onDataChange?: (snapshot: TGraphSnapshot) => void;
	onSelectionChange?: (subject: string | null, label: string | null) => void;
	onActiveViewChange?: (activeViewId: string | null) => void;
};

export function subscribeViewContext(callbacks: TViewContextCallbacks): () => void {
	const s = getStore();
	let prevSnap: TGraphSnapshot | null = null;
	let prevSelected: string | null = s.viewContext.selectedSubject;
	let prevActive: string | null = s.viewContext.activeViewId;
	return subscribeSnapshot((snap, ctx) => {
		if (snap && snap !== prevSnap) {
			prevSnap = snap;
			callbacks.onDataChange?.(snap);
		}
		if (ctx.selectedSubject !== prevSelected) {
			prevSelected = ctx.selectedSubject;
			callbacks.onSelectionChange?.(ctx.selectedSubject, ctx.selectedLabel);
		}
		if (ctx.activeViewId !== prevActive) {
			prevActive = ctx.activeViewId;
			callbacks.onActiveViewChange?.(ctx.activeViewId);
		}
	});
}

function notify(s: Store): void {
	const snap = s.cache?.snapshot ?? null;
	for (const fn of s.listeners) {
		try {
			fn(snap, s.viewContext);
		} catch (err) {
			console.error("[quads-snapshot] listener failed:", err);
		}
	}
}

function typesKey(types?: string[]): string {
	return types?.length ? [...types].sort().join(",") : "*";
}

/**
 * Fetch a type-bounded graph snapshot. Returns sampled quads + cluster
 * summaries with omitted counts so the view can render an "+N more" cluster
 * node per type. The snapshot is cached per (perTypeLimit, types) tuple;
 * passing different opts triggers a fresh fetch.
 */
export async function getGraphSnapshot(opts: { perTypeLimit?: number; types?: string[]; forceRefresh?: boolean } = {}): Promise<TGraphSnapshot> {
	const s = getStore();
	const perTypeLimit = opts.perTypeLimit ?? DEFAULT_PER_TYPE_LIMIT;
	const tk = typesKey(opts.types);
	if (opts.forceRefresh || !s.cache || s.cache.perTypeLimit !== perTypeLimit || s.cache.typesKey !== tk) {
		s.cache = null;
		s.pending = null;
	}
	if (s.cache) return s.cache.snapshot;
	if (s.pending) return s.pending;
	s.pending = (async () => {
		const steps = await getAvailableSteps();
		if (!steps?.length) throw new Error("getAvailableSteps() returned empty — step registry not yet populated");
		const client = SseClient.for("");
		const data = await inAction((scope) =>
			client.rpc<{ quads: TQuad[]; clusters: TCluster[] }>(scope, "MonitorStepper-getClusteredQuads", { perTypeLimit, types: opts.types }),
		);
		if (!Array.isArray(data.quads)) throw new Error("MonitorStepper-getClusteredQuads returned non-array quads");
		const snapshot = { quads: data.quads, clusters: data.clusters ?? [] };
		s.cache = { snapshot, perTypeLimit, typesKey: tk };
		notify(s);
		return snapshot;
	})();
	try {
		return await s.pending;
	} finally {
		s.pending = null;
	}
}

/**
 * Merge newly observed quads into the shared snapshot cache. Updates each
 * affected cluster: a new subject promotes from omitted to sampled (caps at
 * the requested limit; further omitted subjects bump `totalCount`).
 */
export function mergeQuadsIntoSnapshot(quads: TQuad[]): void {
	const s = getStore();
	if (quads.length === 0 || !s.cache) return;
	const snap = s.cache.snapshot;
	const clusterByType = new Map<string, TCluster>();
	const sampledByType = new Map<string, Set<string>>();
	for (const c of snap.clusters) {
		clusterByType.set(c.type, c);
		sampledByType.set(c.type, new Set(c.sampledSubjects));
	}
	for (const q of quads) {
		snap.quads.push(q);
		let cluster = clusterByType.get(q.namedGraph);
		if (!cluster) {
			cluster = { type: q.namedGraph, totalCount: 0, sampledCount: 0, omittedCount: 0, sampledSubjects: [] };
			snap.clusters.push(cluster);
			clusterByType.set(q.namedGraph, cluster);
			sampledByType.set(q.namedGraph, new Set());
		}
		const sampled = sampledByType.get(q.namedGraph) ?? new Set<string>();
		if (sampled.has(q.subject)) continue;
		sampled.add(q.subject);
		cluster.sampledSubjects.push(q.subject);
		cluster.sampledCount = sampled.size;
		cluster.totalCount = Math.max(cluster.totalCount + 1, cluster.sampledCount);
		cluster.omittedCount = Math.max(0, cluster.totalCount - cluster.sampledCount);
	}
	notify(s);
}
