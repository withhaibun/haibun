import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { displayLabelForQuads } from "@haibun/core/lib/hypermedia.js";
import { BODY_LABEL } from "@haibun/core/lib/resources.js";
import { appAccessLevel } from "./util.js";
import { conduit } from "./hypermedia.js";
import { getRels } from "./rels-cache.js";
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

type CacheEntry = {
	snapshot: TGraphSnapshot;
	perTypeLimit: number;
	typesKey: string;
	/** Visibility ceiling the snapshot was fetched under; a change refetches so the view never shows nodes the new ceiling hides. */
	accessLevel: string;
	/** Dedup index `(namedGraph|subject|predicate) → snapshot quad index`, maintained incrementally so a merge never rescans `snapshot.quads`. */
	quadIndex: Map<string, number>;
	/** Subjects the user explicitly expanded (node-neighborhood fetch). Retained in the working set regardless of the per-type budget; never evicted by streamed data. */
	pinned: Set<string>;
};

const quadKey = (q: TQuad): string => `${q.namedGraph}|${q.subject}|${q.predicate}`;

function buildQuadIndex(quads: TQuad[]): Map<string, number> {
	const index = new Map<string, number>();
	for (let i = 0; i < quads.length; i++) index.set(quadKey(quads[i]), i);
	return index;
}

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
 * The shu app and external clustered viewers ship as separate IIFE
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
			failFastOrLog("[quads-snapshot] listener failed:", err);
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
	const accessLevel = appAccessLevel();
	const priorPinned = s.cache?.pinned;
	if (opts.forceRefresh || !s.cache || s.cache.perTypeLimit !== perTypeLimit || s.cache.typesKey !== tk || s.cache.accessLevel !== accessLevel) {
		s.cache = null;
		s.pending = null;
	}
	if (s.cache) return s.cache.snapshot;
	if (s.pending) return s.pending;
	s.pending = (async () => {
		const steps = await getAvailableSteps();
		if (!steps?.length) throw new Error("getAvailableSteps() returned empty — step registry not yet populated");
		const data = await conduit().follow<{ quads: TQuad[]; clusters: TCluster[] }>(
			{ method: "MonitorStepper-getClusteredQuads", params: { perTypeLimit, types: opts.types, accessLevel } },
			"quads-snapshot: fetch clustered quads",
		);
		if (!Array.isArray(data.quads)) throw new Error("MonitorStepper-getClusteredQuads returned non-array quads");
		const snapshot = { quads: data.quads, clusters: data.clusters ?? [] };
		s.cache = { snapshot, perTypeLimit, typesKey: tk, accessLevel, quadIndex: buildQuadIndex(snapshot.quads), pinned: priorPinned ?? new Set() };
		notify(s);
		return snapshot;
	})();
	try {
		return await s.pending;
	} finally {
		s.pending = null;
	}
}

/** The shared store's current snapshot, read synchronously (no fetch). Empty before anything loads. */
export function currentSnapshot(): TGraphSnapshot {
	return getStore().cache?.snapshot ?? { quads: [], clusters: [] };
}

/**
 * Pin subjects into the working set so streamed data can never evict them. Used by
 * node-expansion: a neighborhood the user explicitly revealed stays visible even
 * once a type is at its per-type budget. Bounded by how much the user expands.
 */
export function pinSubjects(subjects: Iterable<string>): void {
	const s = getStore();
	if (!s.cache)
		s.cache = {
			snapshot: { quads: [], clusters: [] },
			perTypeLimit: DEFAULT_PER_TYPE_LIMIT,
			typesKey: "*",
			accessLevel: appAccessLevel(),
			quadIndex: new Map(),
			pinned: new Set(),
		};
	for (const id of subjects) s.cache.pinned.add(id);
}

/**
 * Merge newly observed quads into the shared snapshot cache, bounded by the cached
 * `perTypeLimit` budget: a quad for an already-present subject updates in place; a
 * brand-new subject is admitted only while its type is under budget (or it is pinned),
 * otherwise it is counted as omitted and its quad is dropped. So `snapshot.quads`
 * stays bounded by the budget (+ pinned subjects) no matter how much streams in — the
 * working set tracks what the user chose to materialize, not total DB size.
 *
 * The dedup index lives on the cache and is updated per quad (no rescan of
 * `snapshot.quads`), and every retained subject is labelled via the shared
 * `composeDisplayLabel`, so a node's title comes from one rule across all views.
 */
export function mergeQuadsIntoSnapshot(quads: TQuad[]): void {
	const s = getStore();
	if (quads.length === 0) return;
	// SSE may populate the snapshot before (or without) a getClusteredQuads RPC; start a cache so the merge has somewhere to land.
	if (!s.cache)
		s.cache = {
			snapshot: { quads: [], clusters: [] },
			perTypeLimit: DEFAULT_PER_TYPE_LIMIT,
			typesKey: "*",
			accessLevel: appAccessLevel(),
			quadIndex: new Map(),
			pinned: new Set(),
		};
	const { snapshot: snap, quadIndex, pinned, perTypeLimit: budget } = s.cache;
	const clusterByType = new Map<string, TCluster>();
	const sampledByType = new Map<string, Set<string>>();
	for (const c of snap.clusters) {
		clusterByType.set(c.type, c);
		sampledByType.set(c.type, new Set(c.sampledSubjects));
	}
	// Count each genuinely-new subject once per call, even when it arrives as many quads — its
	// later quads (omitted, so unindexed) would otherwise re-inflate totalCount.
	const countedThisCall = new Set<string>();
	const touched = new Set<string>();
	for (const q of quads) {
		const key = quadKey(q);
		const existingIdx = quadIndex.get(key);
		// The live stream can emit the same fact twice (a property quad on upsert and the edge
		// quad on createEdge); replace in place so the later arrival wins.
		if (existingIdx !== undefined) {
			snap.quads[existingIdx] = q;
			touched.add(q.subject);
			continue;
		}
		let cluster = clusterByType.get(q.namedGraph);
		if (!cluster) {
			cluster = { type: q.namedGraph, totalCount: 0, sampledCount: 0, omittedCount: 0, sampledSubjects: [], displayLabels: {} };
			snap.clusters.push(cluster);
			clusterByType.set(q.namedGraph, cluster);
			sampledByType.set(q.namedGraph, new Set());
		}
		const sampled = sampledByType.get(q.namedGraph) ?? new Set<string>();
		const known = sampled.has(q.subject) || pinned.has(q.subject);
		if (!known) {
			const subjectKey = `${q.namedGraph}|${q.subject}`;
			if (!countedThisCall.has(subjectKey)) {
				countedThisCall.add(subjectKey);
				cluster.totalCount += 1;
			}
			if (sampled.size < budget) {
				sampled.add(q.subject);
				cluster.sampledSubjects.push(q.subject);
				cluster.sampledCount = sampled.size;
			} else {
				// Type is at budget and the subject isn't pinned — omit it: count it, drop its quad.
				cluster.omittedCount = Math.max(0, cluster.totalCount - cluster.sampledCount);
				continue;
			}
		}
		quadIndex.set(key, snap.quads.length);
		snap.quads.push(q);
		cluster.omittedCount = Math.max(0, cluster.totalCount - cluster.sampledCount);
		touched.add(q.subject);
	}
	relabelTouched(snap, clusterByType, touched);
	notify(s);
}

/** Recompute `displayLabels` for the subjects a merge touched, via the one shared rule. */
function relabelTouched(snap: TGraphSnapshot, clusterByType: Map<string, TCluster>, touched: Set<string>): void {
	if (touched.size === 0) return;
	// Body content + each touched subject's quads, gathered in one pass over the (bounded) snapshot.
	const bodyContentBySubject = new Map<string, string>();
	const quadsBySubject = new Map<string, TQuad[]>();
	for (const q of snap.quads) {
		if (q.namedGraph === BODY_LABEL && q.predicate === "content" && typeof q.object === "string") bodyContentBySubject.set(q.subject, q.object);
		if (!touched.has(q.subject)) continue;
		let bucket = quadsBySubject.get(q.subject);
		if (!bucket) {
			bucket = [];
			quadsBySubject.set(q.subject, bucket);
		}
		bucket.push(q);
	}
	for (const [subject, subjectQuads] of quadsBySubject) {
		const type = subjectQuads[0]?.namedGraph ?? "";
		const cluster = clusterByType.get(type);
		if (!cluster) continue;
		cluster.displayLabels[subject] = displayLabelForQuads(type, subject, subjectQuads, (b) => bodyContentBySubject.get(b), getRels(type));
	}
}
