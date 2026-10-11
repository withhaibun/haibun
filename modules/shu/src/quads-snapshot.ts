import { SHARED_GRAPH, type TCluster, type TClusteredQuads, type TQuad } from "@haibun/core/lib/quad-types.js";
import { QuadGraphModel } from "@haibun/core/lib/quad-graph-model.js";
import { reportFailure } from "./client-log.js";
import { reads } from "./page/domains/links.js";
import { conduit } from "./page/controllers/conduit-controller.js";
import { getRels, getTitledBy } from "./page/controllers/catalog-controller.js";
import { getAvailableSteps, requireStep } from "./page/controllers/registry-controller.js";
import { cachedGraph, servedGraph } from "./page/client-cache/controllers/device-controller.js";
import { pagePinned } from "./page/adapters/page-held.js";
import { EDGE, type AccessLevel } from "@haibun/core/lib/resources.js";
import { VARIABLE_FIELD } from "@haibun/core/lib/records/domains/variables.js";
import { appAccessLevel } from "./view-query.js";

export const DEFAULT_PER_TYPE_LIMIT = 100;
/** Ceiling for the per-type sample, everywhere the limit can be set (the filter slider AND the +N-more cluster expand), so a path can't silently inflate the limit past what the slider expresses. */
export const MAX_PER_TYPE_LIMIT = 1000;

/** The client-held graph snapshot IS the wire shape (quads + clusters + the responding site): one type, so the shapes don't drift. */
type TGraphSnapshot = TClusteredQuads;

/**
 * Shared UI-state that travels alongside the data snapshot. Viewers consult this
 * to decide their behaviour: a non-active viewer still wants to know the active
 * view id (so it can lay itself out for off-screen sync) and the currently
 * selected subject (so it can zoom/highlight without waiting for the next event).
 */
type TViewContext = { activeViewId: string | null };

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
type ScopeState = { cache: CacheEntry | null; pending: Promise<TGraphSnapshot> | null };

/** Underlying store: the per-scope caches, global view context, and listener set live here so a single instance is
 *  reachable from every bundle that imports this module, as the page's, see getStore(). */
type Store = { scopes: Map<string, ScopeState>; viewContext: TViewContext; listeners: Set<{ scope: string; fn: SnapshotListener }> };

/**
 * The shu app and external clustered viewers ship as separate IIFE
 * bundles. Each bundle has its own copy of this module's variable bindings, so
 * a Set / object held inside a closure here is duplicated per bundle. Hoisting
 * the live state onto the page means every importer
 * resolves to the same cache + listener set + view context.
 *
 * One global property changes; the effect is one HTTP fetch and one in-memory
 * snapshot for an arbitrarily large dataset, plus selection / data events
 * propagating across bundle boundaries without a DOM round-trip.
 */
const STORE_KEY = "__SHU_QUADS_SNAPSHOT_STORE__";

function getStore(): Store {
	return pagePinned(STORE_KEY, (): Store => ({ scopes: new Map(), viewContext: { activeViewId: null }, listeners: new Set() }));
}

export function getViewContext(): TViewContext {
	return getStore().viewContext;
}

/** Which column has keyboard and actions focus. The active record, which every view dims around and an ask carries, is
 *  not held here: the current-subject machine holds it. */
export function setActiveViewId(id: string | null): void {
	const s = getStore();
	if (s.viewContext.activeViewId === id) return;
	s.viewContext = { ...s.viewContext, activeViewId: id };
	notify(s);
}

/**
 * Subscribe to changes in the shared clustered data and the active view. Listeners
 * fire on initial fetch, incremental SSE merges and active-view changes, receiving
 * the current snapshot plus a `TViewContext` carrying `activeViewId`.
 *
 * Implementors should gate slow re-renders on whether their view is the
 * strip's active pane (`isActiveView` from ShuElement). Inactive viewers can
 * defer the work: the snapshot stays cached and they will pick up the latest
 * state on next activation, without spending cycles updating a hidden surface.
 * They can still react to context changes (e.g. zoom to selected subject) since
 * those are fast relative to a full re-layout.
 *
 * Returns an unsubscribe function, call from disconnectedCallback.
 */
export function subscribeSnapshot(listener: SnapshotListener, scope = ""): () => void {
	const s = getStore();
	const entry = { scope, fn: listener };
	s.listeners.add(entry);
	return () => s.listeners.delete(entry);
}

function scopeState(s: Store, scope: string): ScopeState {
	let st = s.scopes.get(scope);
	if (!st) {
		st = { cache: null, pending: null };
		s.scopes.set(scope, st);
	}
	return st;
}

/** Fire listeners with THEIR scope's snapshot: a data change names its scope (only that scope's listeners fire); an
 *  active-view change passes undefined and reaches every listener, since the active view is global. */
function notify(s: Store, changedScope?: string): void {
	for (const { scope, fn } of s.listeners) {
		if (changedScope !== undefined && scope !== changedScope) continue;
		try {
			fn(s.scopes.get(scope)?.cache?.model.snapshot ?? null, s.viewContext);
		} catch (err) {
			reportFailure("quads-snapshot", "a listener to the graph snapshot failed", err);
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
		const model = new QuadGraphModel(perTypeLimit, getRels, getTitledBy);
		try {
			const steps = await getAvailableSteps();
			if (!steps?.length) throw new Error("getAvailableSteps() returned empty, step registry not yet populated");
			const data = await conduit().follow<{ quads: TQuad[]; clusters: TCluster[]; site?: string }>(
				reads(requireStep("getClusteredQuads"), { perTypeLimit, types: opts.types, accessLevel }),
				"quads-snapshot: fetch clustered quads",
			);
			if (!Array.isArray(data.quads)) throw new Error("getClusteredQuads returned non-array quads");
			// The server already clustered (true totals + SQL body labels); the model adopts that snapshot, then live SSE extends it.
			model.seed({ quads: data.quads, clusters: data.clusters ?? [], site: data.site });
			if (priorPinned) model.pin(priorPinned);
			st.cache = { model, perTypeLimit, typesKey: tk, accessLevel };
			void servedGraph().setMany(data.quads); // persist the fresh snapshot off-heap (fire-and-forget; online path unchanged)
			notify(s, scope);
			return model.snapshot;
		} catch (err) {
			// The server didn't answer: the graph this page caches is the graph, and it answers the question the server was asked, so the
			// sample, its totals and its `+N more` nodes are what they would have been.
			const clustered = await cachedGraph().getClusteredQuads({ perTypeLimit, types: opts.types, accessLevel: accessLevel as AccessLevel });
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

/** A scope's current snapshot, read synchronously (without a fetch). Empty before anything loads. */
export function currentSnapshot(scope = ""): TGraphSnapshot {
	return getStore().scopes.get(scope)?.cache?.model.snapshot ?? { quads: [], clusters: [] };
}

function ensureCache(st: ScopeState): CacheEntry {
	if (!st.cache)
		st.cache = { model: new QuadGraphModel(DEFAULT_PER_TYPE_LIMIT, getRels, getTitledBy), perTypeLimit: DEFAULT_PER_TYPE_LIMIT, typesKey: "*", accessLevel: appAccessLevel() };
	return st.cache;
}

/**
 * Pin subjects into the working set so streamed data can never evict them. Used by
 * node-expansion: a neighborhood the user explicitly revealed stays visible even
 * once a type is at its per-type limit. Bounded by how much the user expands.
 */
export function pinSubjects(subjects: Iterable<string>, scope = ""): void {
	ensureCache(scopeState(getStore(), scope)).model.pin(subjects);
}

/**
 * Merge newly observed quads into the shared model, bounded by the cached per-type limit plus pinned
 * subjects (see QuadGraphModel). SSE may arrive before (or without) a getClusteredQuads RPC, so start a
 * cache for the merge to land in.
 */
export function mergeQuadsIntoSnapshot(quads: TQuad[]): void {
	if (quads.length === 0) return;
	const s = getStore();
	// Live observations extend EVERY scope's model, each bounded by its own limit (merge dedups by fact, so a batch
	// delivered through two views' subscriptions lands once per scope). The default scope always exists, SSE may
	// arrive before any fetch.
	ensureCache(scopeState(s, ""));
	for (const [scope, st] of getStore().scopes) {
		if (!st.cache) continue;
		st.cache.model.merge(quads);
		notify(s, scope);
	}
	void servedGraph().setMany(quads); // persist live observations off-heap for the next reload
}

/** One variable a step set: its name, the value its record holds, and the type of its record. */
export type TVariableSet = { name: string; value: unknown; graph: string };

/** Returns the variables a step set, from quads that hold the variables' records: each variable whose record has a
 *  `wasGeneratedBy` edge to the step's record. */
export function variablesSetBy(quads: readonly TQuad[], stepRecordName: string): TVariableSet[] {
	const ofVariables = quads.filter((q) => q.namedGraph === SHARED_GRAPH);
	const names = new Set(ofVariables.filter((q) => q.predicate === EDGE.wasGeneratedBy && q.object === stepRecordName).map((q) => q.subject));
	return [...names].map((name) => ({ name, value: ofVariables.find((q) => q.subject === name && q.predicate === VARIABLE_FIELD.value)?.object, graph: SHARED_GRAPH }));
}

/** Query the off-heap snapshot store (the serialized-report / offline backing). The reverse walks a display needs: an
 *  annotation's SpecificResource points AT its source, so finding a subject's annotations reads incoming edges the IDB
 *  store indexes only by subject/namedGraph. Callers scan a namedGraph and filter, since object is not an IDB index. */
export function queryStoredQuads(pattern: { subject?: string; predicate?: string; object?: unknown; namedGraph?: string }): Promise<TQuad[]> {
	return cachedGraph().query(pattern);
}
