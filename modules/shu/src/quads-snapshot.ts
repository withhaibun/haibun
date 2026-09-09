import { GraphQuerySchema, type TCluster, type TClusteredQuads, type TGraphQueryResult, type TQuad, type IQuadStore, type TDensityQuery, type TDensityResult, type TQuadEdge, type TIndividualWithEdges } from "@haibun/core/lib/quad-types.js";
import { individualWithEdges, incomingEdgesOf } from "@haibun/core/lib/quad-store.js";
import type { TRunGraph } from "./client-cache/run-graph.js";
import { QuadGraphModel } from "@haibun/core/lib/quad-graph-model.js";
import { queryQuadStore } from "@haibun/core/lib/quad-store.js";
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { appAccessLevel } from "./util.js";
import { conduit } from "./hypermedia.js";
import { getRels, getDisplayLabelRel, getSelectFields } from "./rels-cache.js";
import { getAvailableSteps, requireStep } from "./rpc-registry.js";
import { originGraphStore } from "./client-cache/index.js";
import { pagePinned } from "./page-pinned.js";
import type { AccessLevel } from "@haibun/core/lib/resources.js";

export const DEFAULT_PER_TYPE_LIMIT = 100;
/** Ceiling for the per-type sample, everywhere the limit can be set (the filter slider AND the +N-more cluster expand) — so no path can silently inflate the budget past what the slider expresses. */
export const MAX_PER_TYPE_LIMIT = 1000;

/** Off-heap persistent backing for the client graph: live merges + each backfill are written here, and a reload seeds
 *  the model from it (instant graph; an offline context serves it). Degrades to a no-op when IndexedDB is unavailable. */
/** The graph this page caches. The client's own store on a served origin; a report installs a memory-backed one holding
 *  the graph it carries, so the same reads serve both. Held by the page, not by a bundle: the app installs it and a
 *  view a deployment adds reads the same one, which is how a report's graph reaches a view in its own bundle. */
type TCachedGraphStore = IQuadStore & { setMany(quads: TQuad[]): Promise<void> };
const GRAPH_STORE_KEY = "__SHU_CACHED_GRAPH_STORE__";
const graphStoreSlot = (): { store: TCachedGraphStore } => pagePinned(GRAPH_STORE_KEY, () => ({ store: originGraphStore }));

/** Install the store the graph is cached in (a report: memory, holding what the report carries). */
export function setGraphStore(store: TCachedGraphStore): void {
	graphStoreSlot().store = store;
}

/** The store the graph is cached in. */
export function cachedGraphStore(): TCachedGraphStore {
	return graphStoreSlot().store;
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
				{ method: requireStep("getClusteredQuads"), params: { perTypeLimit, types: opts.types, accessLevel } },
				"quads-snapshot: fetch clustered quads",
			);
			if (!Array.isArray(data.quads)) throw new Error("getClusteredQuads returned non-array quads");
			// The server already clustered (true totals + SQL body labels); the model adopts that snapshot, then live SSE extends it.
			model.seed({ quads: data.quads, clusters: data.clusters ?? [], site: data.site });
			if (priorPinned) model.pin(priorPinned);
			st.cache = { model, perTypeLimit, typesKey: tk, accessLevel };
			void cachedGraphStore().setMany(data.quads); // persist the fresh snapshot off-heap (fire-and-forget; online path unchanged)
			notify(s, scope);
			return model.snapshot;
		} catch (err) {
			// No server: the graph this page caches is the graph, and it answers the question the server was asked, so the
			// sample, its totals and its `+N more` nodes are what they would have been.
			const clustered = await cachedGraphStore().getClusteredQuads({ perTypeLimit, types: opts.types, accessLevel: accessLevel as AccessLevel });
			if (clustered.quads.length === 0) throw err;
			model.seed({ quads: clustered.quads, clusters: clustered.clusters ?? [], site: clustered.site });
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

/**
 * The one rule for reading the graph: ask the site, and when nothing answers, give the answer from what this page
 * holds. `held` returns undefined when the page cannot answer either, and then the site's own failure is what the
 * caller is told, since a question this page cannot answer is not one to be quiet about.
 */
async function askElseHeld<T>(ask: () => Promise<T>, held: () => Promise<T | undefined>): Promise<T> {
	try {
		await getAvailableSteps();
		return await ask();
	} catch (err) {
		const own = await held();
		if (own === undefined) throw err;
		return own;
	}
}

/**
 * A label's dropdown values: what the site answers, and when nothing answers, the distinct values its context fields
 * hold in the graph this page caches. The site derives its answer from the same declaration over the same fields, so a
 * reader with no server offered the values in the graph they hold is offered the same fields, narrowed to what is there.
 */
export function selectValuesFor(label: string): Promise<Record<string, string[]>> {
	return askElseHeld(
		async () => (await conduit().follow<{ values: Record<string, string[]> }>({ method: requireStep("getSelectValues"), params: { label } }, `select values for ${label}`)).values ?? {},
		async () => {
			// A type the site never declared is a question this page cannot answer at all; a declared type with no context
			// field has no dropdowns, which is an answer.
			if (!getRels(label)) return undefined;
			const values: Record<string, string[]> = {};
			for (const field of getSelectFields(label)) values[field] = await cachedGraphStore().distinctPropertyValues(label, field);
			return values;
		},
	);
}

/**
 * The run as this page reads it: the site's answer, and what the page holds when nothing answers. The one reading a
 * live page uses, stated rather than reached for, so what a view reads a run through is visible where the view is made.
 */
export function pageRunGraph(): TRunGraph {
	return { query: (query) => queryGraph(query as unknown as Record<string, unknown>), density: densityOf, declares: (label) => !!getRels(label) };
}

/**
 * How many records fall in each division of a span, by how each turned out: what the site answers, and when nothing
 * answers, the same count over the graph this page caches. The site counts over the whole run it holds; a page with no
 * site counts over what it has read, which is what a reader with no site has.
 */
export function densityOf(query: TDensityQuery): Promise<TDensityResult> {
	return askElseHeld(
		() => conduit().follow<TDensityResult>({ method: requireStep("density"), params: { query } }, `the shape of ${query.label}`),
		async () => (getRels(query.label) ? await cachedGraphStore().density(query) : undefined),
	);
}

/**
 * The rows a graph query names: what the site answers, and when nothing answers, the same query over the graph this
 * page caches. The site's own inherent query is that function over its store, so a reader with no server is given the
 * answer the site would have given, bounded by what they hold. A type the site never declared, or a query a store of
 * quads cannot answer, is reported as the failure it is.
 */
export function queryGraph(query: Record<string, unknown>): Promise<TGraphQueryResult> {
	return askElseHeld(
		() => conduit().follow<TGraphQueryResult>({ method: requireStep("graphQuery"), params: { query } }, `query: ${(query.label as string) || "(any)"}`),
		async () => {
			const parsed = GraphQuerySchema.safeParse(query);
			return parsed.success && getRels(parsed.data.label ?? "") ? await queryQuadStore(cachedGraphStore(), parsed.data) : undefined;
		},
	);
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
	void cachedGraphStore().setMany(quads); // persist live observations off-heap for the next reload
}

/**
 * One individual with its edges: what the site answers, and when nothing answers, the individual as the page holds it.
 * Undefined only when the site answered that there is no such individual; anything else the site said is reported.
 */
export function readIndividual(label: string, id: string, accessLevel: string): Promise<TIndividualWithEdges> {
	return askElseHeld(
		() => conduit().follow<TIndividualWithEdges>({ method: requireStep("getIndividualWithEdges"), params: { label, id, accessLevel } }, `read ${label}:${id}`),
		() => individualWithEdges(cachedGraphStore(), label, id),
	);
}

/**
 * What points at an individual: what the site answers, and when nothing answers, the edges the page holds that point at
 * it, windowed the same way. The count is what the reader can reach, which offline is what they hold.
 */
export function incomingEdges(label: string, id: string, window: { limit: number; offset: number }): Promise<{ edges: TQuadEdge[]; total: number }> {
	return askElseHeld(
		() =>
			conduit().follow<{ edges: TQuadEdge[]; total: number }>(
				{ method: requireStep("getIncomingEdges"), params: { label, id, accessLevel: appAccessLevel(), ...window } },
				`what points at ${label}:${id}`,
			),
		// The window is taken before a record is read, so a hub costs the page a window rather than every edge of it.
		() => (getRels(label) ? incomingEdgesOf(cachedGraphStore(), id, window) : Promise.resolve(undefined)),
	);
}

/** Query the off-heap snapshot store (the serialized-report / offline backing). The reverse walks a display needs — an
 *  annotation's SpecificResource points AT its source, so finding a subject's annotations reads incoming edges the IDB
 *  store indexes only by subject/namedGraph. Callers scan a namedGraph and filter, since object is not an IDB index. */
export function queryStoredQuads(pattern: { subject?: string; predicate?: string; object?: unknown; namedGraph?: string }): Promise<TQuad[]> {
	return cachedGraphStore().query(pattern);
}
