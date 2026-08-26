import type { TCluster, TClusteredQuads, TQuad, IQuadStore } from "@haibun/core/lib/quad-types.js";
import { QuadGraphModel } from "@haibun/core/lib/quad-graph-model.js";
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { appAccessLevel } from "./util.js";
import { conduit } from "./hypermedia.js";
import { getRels, getDisplayLabelRel } from "./rels-cache.js";
import { getAvailableSteps } from "./rpc-registry.js";
import { originGraphStore } from "./client-cache/index.js";

export const DEFAULT_PER_TYPE_LIMIT = 100;
/** Ceiling for the per-type sample, everywhere the limit can be set (the filter slider AND the +N-more cluster expand) — so no path can silently inflate the budget past what the slider expresses. */
export const MAX_PER_TYPE_LIMIT = 1000;

/** Off-heap persistent backing for the client graph: live merges + each backfill are written here, and a reload seeds
 *  the model from it (instant graph; an offline context serves it). Degrades to a no-op when IndexedDB is unavailable. */
/** The graph this page caches. The client's own store on a served origin; a report installs a memory-backed one holding
 *  the graph it carries, so the same reads serve both. */
type TCachedGraphStore = IQuadStore & { setMany(quads: TQuad[]): Promise<void> };
let graphStore: TCachedGraphStore = originGraphStore;

/** Install the store the graph is cached in (a report: memory, holding what the report carries). */
export function setGraphStore(store: TCachedGraphStore): void {
	graphStore = store;
}

/** The store the graph is cached in. */
export function cachedGraphStore(): TCachedGraphStore {
	return graphStore;
}

/** The client-held graph snapshot IS the wire shape (quads + clusters + the responding site) — one type, no drift. */
export type TGraphSnapshot = TClusteredQuads;

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
	/** The shared graph model owns the quads, dedup index, clusters, and pins; the cache pairs it with its fetch key. */
	model: QuadGraphModel;
	perTypeLimit: number;
	typesKey: string;
	/** Visibility ceiling the snapshot was fetched under; a change refetches so the view never shows nodes the new ceiling hides. */
	accessLevel: string;
};

/** One view scope's cached snapshot + in-flight fetch. Scope "" is the shared main-graph scope; a view that needs an
 *  independent data source (the class browser) declares its own scope, so its fetches and chip choices never replace
 *  another scope's snapshot. The view context (selection, active view) stays global across scopes. */
type ScopeState = {
	cache: CacheEntry | null;
	pending: Promise<TGraphSnapshot> | null;
};

/** Underlying store: the per-scope caches, global view context, and listener set live here so a single instance is
 *  reachable from every bundle that imports this module via `globalThis.__SHU_QUADS_SNAPSHOT_STORE__` — see getStore(). */
type Store = {
	scopes: Map<string, ScopeState>;
	viewContext: TViewContext;
	listeners: Set<{ scope: string; fn: SnapshotListener }>;
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
		scopes: new Map(),
		viewContext: { activeViewId: null, selectedSubject: null, selectedLabel: null },
		listeners: new Set(),
	};
	g[STORE_KEY] = fresh;
	return fresh;
}

export function getViewContext(): TViewContext {
	return getStore().viewContext;
}

// activeViewId (which column has keyboard/actions focus) and selectedSubject (which subject every view dims around)
// are ORTHOGONAL axes on one context: each setter writes only its own axis and never derives or clears the other.
// A body click legitimately does both (clears selection AND activates the column) precisely because they don't conflict.
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

/** What a CONTEXT_CHANGE means for the selection axis. A context publish addresses selection only when it names a
 *  subject (select it) or carries an explicitly EMPTY patterns array (the empty-space click — clear it). A query
 *  context (label/predicate/object patterns, no subject) says nothing about selection and must leave it untouched —
 *  e.g. the graph view publishing its query at boot must not clear the selection a just-opened column published. */
export function selectionFromContext(detail: {
	patterns?: Array<Record<string, unknown>>;
	label?: unknown;
}): { action: "select"; subject: string; label: string | null } | { action: "clear" } | { action: "none" } {
	const subject = detail.patterns?.[0]?.s;
	if (typeof subject === "string") return { action: "select", subject, label: typeof detail.label === "string" ? detail.label : null };
	if (Array.isArray(detail.patterns) && detail.patterns.length === 0) return { action: "clear" };
	return { action: "none" };
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
export function subscribeSnapshot(listener: SnapshotListener, scope = ""): () => void {
	const s = getStore();
	const entry = { scope, fn: listener };
	s.listeners.add(entry);
	return () => s.listeners.delete(entry);
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

export function subscribeViewContext(callbacks: TViewContextCallbacks, scope = ""): () => void {
	const s = getStore();
	let prevSnap: TGraphSnapshot | null = null;
	let prevSelected: string | null = s.viewContext.selectedSubject;
	let prevActive: string | null = s.viewContext.activeViewId;
	// A selection made BEFORE this subscription (an embedding column publishes its subject, then this view boots)
	// must still reach the subscriber: deliver the current selection once, so a late-booting view highlights it.
	if (s.viewContext.selectedSubject !== null) queueMicrotask(() => callbacks.onSelectionChange?.(s.viewContext.selectedSubject, s.viewContext.selectedLabel));
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
	}, scope);
}

function scopeState(s: Store, scope: string): ScopeState {
	let st = s.scopes.get(scope);
	if (!st) {
		st = { cache: null, pending: null };
		s.scopes.set(scope, st);
	}
	return st;
}

/** Fire listeners with THEIR scope's snapshot: a data change names its scope (only that scope's listeners fire); a
 *  context change (selection/active view) passes undefined and reaches every listener — context is global. */
function notify(s: Store, changedScope?: string): void {
	for (const { scope, fn } of s.listeners) {
		if (changedScope !== undefined && scope !== changedScope) continue;
		try {
			fn(s.scopes.get(scope)?.cache?.model.snapshot ?? null, s.viewContext);
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
export async function getGraphSnapshot(opts: { perTypeLimit?: number; types?: string[]; forceRefresh?: boolean; scope?: string } = {}): Promise<TGraphSnapshot> {
	const s = getStore();
	const st = scopeState(s, opts.scope ?? "");
	const scope = opts.scope ?? "";
	const perTypeLimit = opts.perTypeLimit ?? DEFAULT_PER_TYPE_LIMIT;
	const tk = typesKey(opts.types);
	const accessLevel = appAccessLevel();
	const priorPinned = st.cache?.model.pinnedSubjects;
	if (opts.forceRefresh || !st.cache || st.cache.perTypeLimit !== perTypeLimit || st.cache.typesKey !== tk || st.cache.accessLevel !== accessLevel) {
		st.cache = null;
		st.pending = null;
	}
	if (st.cache) return st.cache.model.snapshot;
	if (st.pending) return st.pending;
	st.pending = (async () => {
		const model = new QuadGraphModel(perTypeLimit, getRels, getDisplayLabelRel);
		try {
			const steps = await getAvailableSteps();
			if (!steps?.length) throw new Error("getAvailableSteps() returned empty — step registry not yet populated");
			const data = await conduit().follow<{ quads: TQuad[]; clusters: TCluster[]; site?: string }>(
				{ method: "MonitorStepper-getClusteredQuads", params: { perTypeLimit, types: opts.types, accessLevel } },
				"quads-snapshot: fetch clustered quads",
			);
			if (!Array.isArray(data.quads)) throw new Error("MonitorStepper-getClusteredQuads returned non-array quads");
			// The server already clustered (true totals + SQL body labels); the model adopts that snapshot, then live SSE extends it.
			model.seed({ quads: data.quads, clusters: data.clusters ?? [], site: data.site });
			if (priorPinned) model.pin(priorPinned);
			st.cache = { model, perTypeLimit, typesKey: tk, accessLevel };
			void graphStore.setMany(data.quads); // persist the fresh snapshot off-heap (fire-and-forget; online path unchanged)
			notify(s, scope);
			return model.snapshot;
		} catch (err) {
			// Offline / RPC unavailable: serve the persisted graph if one survived a prior session (survives reload/disconnect).
			const persisted = await graphStore.all();
			if (persisted.length === 0) throw err;
			model.merge(persisted);
			if (priorPinned) model.pin(priorPinned);
			st.cache = { model, perTypeLimit, typesKey: tk, accessLevel };
			notify(s, scope);
			return model.snapshot;
		}
	})();
	try {
		return await st.pending;
	} finally {
		st.pending = null;
	}
}

/** A scope's current snapshot, read synchronously (no fetch). Empty before anything loads. */
export function currentSnapshot(scope = ""): TGraphSnapshot {
	return getStore().scopes.get(scope)?.cache?.model.snapshot ?? { quads: [], clusters: [] };
}

function ensureCache(st: ScopeState): CacheEntry {
	if (!st.cache)
		st.cache = {
			model: new QuadGraphModel(DEFAULT_PER_TYPE_LIMIT, getRels, getDisplayLabelRel),
			perTypeLimit: DEFAULT_PER_TYPE_LIMIT,
			typesKey: "*",
			accessLevel: appAccessLevel(),
		};
	return st.cache;
}

/**
 * Pin subjects into the working set so streamed data can never evict them. Used by
 * node-expansion: a neighborhood the user explicitly revealed stays visible even
 * once a type is at its per-type budget. Bounded by how much the user expands.
 */
export function pinSubjects(subjects: Iterable<string>, scope = ""): void {
	ensureCache(scopeState(getStore(), scope)).model.pin(subjects);
}

/**
 * Merge newly observed quads into the shared model — bounded by the cached per-type budget plus pinned
 * subjects (see QuadGraphModel). SSE may arrive before (or without) a getClusteredQuads RPC, so start a
 * cache for the merge to land in.
 */
export function mergeQuadsIntoSnapshot(quads: TQuad[]): void {
	if (quads.length === 0) return;
	const s = getStore();
	// Live observations extend EVERY scope's model, each bounded by its own budget (merge dedups by fact, so a batch
	// delivered through two views' subscriptions lands once per scope). The default scope always exists — SSE may
	// arrive before any fetch.
	ensureCache(scopeState(s, ""));
	for (const [scope, st] of getStore().scopes) {
		if (!st.cache) continue;
		st.cache.model.merge(quads);
		notify(s, scope);
	}
	void graphStore.setMany(quads); // persist live observations off-heap for the next reload
}

/**
 * Deref a persisted individual's vertex from the off-heap store — scalar/property quads only (topology edges, marked by
 * `objectType`, need the live graph). Used as an offline / RPC-down fallback so a previously-seen entity still opens.
 * Returns undefined when the individual was never persisted. The shape mirrors the entity views' result (vertex + edges
 * + incomingCount) so a caller applies it the same way as a live fetch.
 */
export async function derefStoredEntity(label: string, id: string): Promise<{ vertex: Record<string, unknown>; edges: unknown[]; incomingCount: number } | undefined> {
	const quads = await graphStore.query({ subject: id, namedGraph: label });
	if (quads.length === 0) return undefined;
	const vertex: Record<string, unknown> = { "@id": id, "@type": label };
	for (const q of quads) if (!q.objectType) vertex[q.predicate] = q.object;
	return { vertex, edges: [], incomingCount: 0 };
}

/** Query the off-heap snapshot store (the serialized-report / offline backing). The reverse walks a display needs — an
 *  annotation's SpecificResource points AT its source, so finding a subject's annotations reads incoming edges the IDB
 *  store indexes only by subject/namedGraph. Callers scan a namedGraph and filter, since object is not an IDB index. */
export function queryStoredQuads(pattern: { subject?: string; predicate?: string; object?: unknown; namedGraph?: string }): Promise<TQuad[]> {
	return graphStore.query(pattern);
}
