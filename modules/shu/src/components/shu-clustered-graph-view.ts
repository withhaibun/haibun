/**
 * Shared base for every view that hosts a <shu-graph-scene> over the clustered-quad snapshot: the graph view and the
 * class browser today, and any other host of the same scene. It owns the one data pathway, fetch, live SSE merge,
 * type filter, cluster + neighborhood expansion, selection, and the one scene pathway: the light DOM the scene needs,
 * the model pushed to it, the cursor paint, and the scene outputs relayed as app events. A host declares what it is
 * (`rootTestId`) and what slice of the data its scene shows (`buildSceneModel`), and overrides a hook only where it
 * differs, so two hosts of one scene cannot drift apart.
 */
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { extractQuadsFromEvents, type TCluster, type TQuad } from "@haibun/core/lib/quad-types.js";
import { getRels } from "../rels-cache.js";
import { getGraphSnapshot, currentSnapshot, mergeQuadsIntoSnapshot, subscribeViewContext, DEFAULT_PER_TYPE_LIMIT, MAX_PER_TYPE_LIMIT } from "../quads-snapshot.js";
import { expandNeighborhood } from "../graph-expansion.js";
import { ShuGraphFilter } from "./shu-graph-filter.js";
import "../graph/polymorphic/polymorphic-scene.js";
import { type ShuGraphScene, GRAPH_SCENE_EVENT, type GraphSceneModel } from "../graph/polymorphic/polymorphic-scene.js";
import { effectiveHiddenTypes } from "../graph-filter-projection.js";

const QuadFieldSchema = z.object({
	subject: z.string(),
	predicate: z.string(),
	object: z.unknown(),
	namedGraph: z.string(),
	// Omitting objectType makes setState's Zod parse strip it, leaving every edge (which resolves to its node via the range) undrawable.
	objectType: z.string().optional(),
	timestamp: z.number(),
	properties: z.record(z.string(), z.unknown()).optional(),
});

const ClusterFieldSchema = z.object({
	type: z.string(),
	totalCount: z.number(),
	sampledCount: z.number(),
	omittedCount: z.number(),
	sampledSubjects: z.array(z.string()),
	displayLabels: z.record(z.string(), z.string()),
	// Site principal per sampled subject served by a FEDERATED peer (omitting it makes the parse strip the federation stamp).
	sites: z.record(z.string(), z.string()).optional(),
});

/** The state fields every clustered-graph view shares; a subclass spreads this into its own `z.object({...})`. */
export const clusteredGraphStateShape = {
	quads: z.array(QuadFieldSchema).default([]),
	clusters: z.array(ClusterFieldSchema).default([]),
	/** The responding instance's site principal: the serving site of every subject a cluster's `sites` doesn't override. */
	site: z.string().optional(),
	perTypeLimit: z.number().int().positive().default(DEFAULT_PER_TYPE_LIMIT),
	hiddenGraphs: z.array(z.string()).default([]),
	// The predicates whose edges are hidden (the filter's properties group). Node visibility is per type; edge
	// visibility is per predicate: the two travel together from the one filter.
	hiddenPredicates: z.array(z.string()).default([]),
	expandedGraphs: z.array(z.string()).default([]),
};

const ClusteredGraphStateSchema = z.object(clusteredGraphStateShape);
export type TClusteredGraphState = z.infer<typeof ClusteredGraphStateSchema>;

export abstract class ShuClusteredGraphView<T extends z.ZodTypeAny> extends ShuElement<T> {
	protected knownClusters = new Map<string, TCluster>();
	protected fetchedSubjects = new Set<string>();
	private graphInitialized = false;
	// The user's explicit per-type visibility choices (from <shu-graph-filter>, persisted there). hiddenGraphs is DERIVED
	// from these + the instrumentation-default predicate via effectiveHiddenTypes, never stored as the truth, so
	// instrumentation's default-hidden is re-applied every load and a toggle is the only thing that sticks.
	private filterOverrides: Record<string, boolean> = {};

	/** The persistence scope of this view's filter choices: "" (the main graph's shared store) by default; a scoped host
	 *  (a class browser) overrides with its own name and sets the same value as `data-persist-scope` on its filter. */
	protected get filterPersistScope(): string {
		return "";
	}

	/** The view's snapshot scope: "" (the shared main-graph snapshot) by default. A view with its own scope fetches and
	 *  holds an independent snapshot: its refetches (chip toggles, per-type limit) never replace another scope's data,
	 *  and another view's never replace its. Live SSE observations extend every scope. */
	protected get snapshotScope(): string {
		return "";
	}

	// The shared fields, typed: every subclass schema includes clusteredGraphStateShape, so the cast is sound.
	protected get cgState(): TClusteredGraphState {
		return this.state as unknown as TClusteredGraphState;
	}
	protected setGraphState(partial: Partial<TClusteredGraphState>): void {
		this.setState(partial as Partial<z.infer<T>>);
	}

	/** External-data mode (subclass supplies quads; no RPC/SSE/selection). The overview overrides it for setQuads. */
	protected get usesExternalData(): boolean {
		return false;
	}

	/** Light DOM: the scene resolves its A-Frame camera through the document, and its chrome positions against the host. */
	createRenderRoot(): HTMLElement {
		return this;
	}

	/** The test id a feature waits on before driving this host, declared by the host it belongs to. */
	protected abstract get rootTestId(): string;

	/** The slice of the snapshot this host's scene shows: the whole graph, or the part a scoped host is a view of. */
	protected abstract buildSceneModel(): GraphSceneModel;

	/** The scene is a child of the host, and on a host that hides it (a text tab) it is out of the DOM rather than
	 *  hidden, so its render loop never runs where it is not shown. */
	protected get scene(): ShuGraphScene | null {
		return this.querySelector<ShuGraphScene>("shu-graph-scene");
	}

	protected get filterEl(): ShuGraphFilter | null {
		return this.querySelector("shu-graph-filter");
	}

	/** Feed the scene the current data slice and refresh the filter's chip source (the filter is host-owned). */
	protected pushSceneModel(): void {
		this.filterEl?.setSource(this.knownClusters, this.cgState.quads);
		this.scene?.setModel(this.buildSceneModel());
	}

	/** Awaited before the first load: the host's scene child exists by then, so the scene outputs every host relays the
	 *  same way are wired here. A host adds its own outputs after awaiting this. */
	protected async onGraphConnected(): Promise<void> {
		await this.updateComplete; // renders the filter and creates the <shu-graph-scene> child
		this.setAttribute("data-testid", this.rootTestId);
		this.autoListen(this, GRAPH_SCENE_EVENT.NODE_CLICK, ((e: CustomEvent<{ label: string; subject: string; addToSelection: boolean }>) => {
			this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_OPEN, { detail: e.detail, bubbles: true, composed: true }));
		}) as EventListener);
		this.autoListen(this, GRAPH_SCENE_EVENT.NODE_OPEN_PANE, ((e: CustomEvent) => {
			this.dispatchEvent(new CustomEvent(SHU_EVENT.PANE_OPEN, { detail: e.detail, bubbles: true, composed: true }));
		}) as EventListener);
		// Hovering a type chip previews its cluster: every other type dims while the pointer is on it.
		this.autoListen(this, SHU_EVENT.GRAPH_TYPE_PREVIEW, ((e: CustomEvent<{ type: string | null }>) => {
			this.scene?.setPreviewType(e.detail?.type ?? null);
		}) as EventListener);
	}
	/** Repaint after a data change: the scene takes the new slice. */
	protected onGraphData(): void {
		this.pushSceneModel();
	}
	/** A selection (from any view): the scene highlights it; the base also fetches its neighborhood (below). */
	protected onGraphSelection(subject: string | null, _label: string | null): void {
		this.scene?.setSelectedSubject(subject);
	}

	/** The time-visible slice of the snapshot: quads at/before the global time cursor (all of them with no cursor).
	 * The ONE time pathway every clustered graph view renders from, never `state.quads` directly, so scrubbing
	 * the shared timeline hides/restores the same objects in every view. */
	protected get visibleQuads(): TQuad[] {
		return this.filterByTime(this.cgState.quads);
	}

	private lastTimeSync = 0;
	private timeSyncTimer = 0;
	/** Coalesce window for cursor moves during a continuous scrub/play. Overridable: an imperative view that re-styles
	 *  quickly on a cursor move uses a shorter window for a snappier scrub. */
	protected get timeSyncCoalesceMs(): number {
		return 500;
	}
	/** Imperative repaint for a cursor move. Default routes through the data path; an imperative view overrides to
	 *  re-STYLE promptly: a cursor move re-places depth without changing the model, so it need not wait on the
	 *  streamed-data coalesce (and must not stack a second debounce on top of this one). */
	protected onTimeCursorPaint(): void {
		this.pushSceneModel();
		this.scene?.setTimeCursorValue(this.timeCursor);
	}
	/** The cursor moves continuously during a scrub/play: coalesce to `timeSyncCoalesceMs` (the leading edge paints a
	 *  single move at once; the trailing call lands the final position). */
	protected override onTimeSync(): void {
		const apply = () => {
			this.lastTimeSync = Date.now();
			this.refresh(); // the reactive overview re-renders from visibleQuads
			this.onTimeCursorPaint(); // an imperative renderer re-styles from visibleQuads
		};
		if (Date.now() - this.lastTimeSync >= this.timeSyncCoalesceMs) apply();
		else if (!this.timeSyncTimer) {
			this.timeSyncTimer = window.setTimeout(() => {
				this.timeSyncTimer = 0;
				apply();
			}, this.timeSyncCoalesceMs);
		}
	}

	protected override async onConnected(): Promise<void> {
		if (this.graphInitialized) return;
		this.graphInitialized = true;

		this.autoListen(this, SHU_EVENT.GRAPH_FILTER_CHANGE, ((e: CustomEvent<{ overrides: Record<string, boolean>; hiddenPredicates?: string[]; perTypeLimit: number }>) => {
			// The filter reports the user's explicit overrides; hidden = those combined with each cluster's declared default.
			this.filterOverrides = e.detail.overrides ?? {};
			this.setGraphState({ hiddenPredicates: e.detail.hiddenPredicates ?? [] });
			const hiddenGraphs = this.computeHiddenGraphs();
			const visibleTypes = [...this.allKnownGraphs()].filter((t) => !hiddenGraphs.includes(t));
			this.commitHidden(hiddenGraphs, visibleTypes.length > 0 ? visibleTypes : undefined, e.detail.perTypeLimit);
		}) as EventListener);
		this.autoListen(this, SHU_EVENT.GRAPH_CLUSTER_EXPAND, (() => {
			// Raise the sample toward the SAME ceiling the filter slider expresses, never silently past it. The filter
			// owns the limit: raising it there persists the value and its dispatch drives the one refetch path a slider
			// change takes. Only a filterless host (external-data views) refetches directly.
			const nextLimit = Math.min(MAX_PER_TYPE_LIMIT, Math.max(this.cgState.perTypeLimit * 2, this.cgState.perTypeLimit + 100));
			if (nextLimit === this.cgState.perTypeLimit) return;
			const filter = this.renderRoot.querySelector<ShuGraphFilter>("shu-graph-filter");
			if (filter) {
				filter.raiseLimitTo(nextLimit);
				return;
			}
			const visibleTypes = [...this.knownClusters.keys()].filter((t) => !this.cgState.hiddenGraphs.includes(t));
			void this.refetchSnapshot({ types: visibleTypes.length > 0 ? visibleTypes : undefined, perTypeLimit: nextLimit });
		}) as EventListener);

		if (this.usesExternalData) {
			await this.onGraphConnected();
			return;
		}

		// One persistence source for the overrides + limit across every clustered view: the embedded <shu-graph-filter>,
		// read per the view's declared scope (filterPersistScope) so a scoped host (a class browser) never shares the main
		// graph's choices. hiddenGraphs is computed (defaults + overrides) once the snapshot's clusters arrive, in refetchSnapshot.
		const initial = ShuGraphFilter.getPersistedFilter(this.filterPersistScope);
		this.filterOverrides = initial.overrides;
		this.setGraphState({ hiddenPredicates: initial.hiddenPredicates });
		await this.onGraphConnected();
		await this.refetchSnapshot({ perTypeLimit: initial.perTypeLimit });

		if (this.hasAttribute("data-snapshot-time")) return; // snapshot mode: one fetch, no live updates

		this.autoTeardown(
			this.subscribeBatched({
				onBatch: (events) => {
					const quads = extractQuadsFromEvents(events);
					if (quads.length === 0) return;
					mergeQuadsIntoSnapshot(quads);
					// Repaint on EVERY batch. Instrumentation graphs (SeqPath, observation/*, variables, facts) are ordinary
					// toggleable graph elements, not a special case: they must stream in and render like any other type. The
					// render→RPC→observe→render loop this once guarded against is gone: the overview now paints client-side
					// (graphToSvg), so a repaint issues no RPC to re-observe. Frequent batches are coalesced by the paint debounce.
					this.syncFromSnapshot();
				},
				// What was written while the stream was down arrived in no batch, so the snapshot is read again through the
				// same commit a visibility change makes, at the scope and limit the view is already reading at.
				onReconnect: () => this.applyHiddenChange({}),
			}),
		);
		this.autoTeardown(
			subscribeViewContext(
				{
					onSelectionChange: (subject, label) => {
						this.onGraphSelection(subject, label);
						if (subject && label) void this.fetchIfMissing(subject, label);
					},
				},
				this.snapshotScope,
			),
		);
	}

	// Snapshot clusters plus types seen only in live quads.
	protected allKnownGraphs(): Set<string> {
		const all = new Set<string>(this.knownClusters.keys());
		for (const q of this.cgState.quads) all.add(q.namedGraph);
		return all;
	}

	/** hiddenGraphs is DERIVED, never the stored truth: the instrumentation-default predicate combined with the user's
	 *  explicit overrides, applied to every known type (snapshot clusters AND types seen only in live quads, so a graph
	 *  that streams in mid-run, with no server cluster yet, is classified the moment it appears). */
	private hiddenGraphsFor(types: Iterable<string>): string[] {
		return effectiveHiddenTypes(types, this.filterOverrides);
	}
	private computeHiddenGraphs(): string[] {
		return this.hiddenGraphsFor(this.allKnownGraphs());
	}
	/** The hidden set for a freshly-arrived snapshot: its clusters AND the named graphs of its quads (the latter catch a
	 *  type that exists only as streamed quads, with no cluster record yet). */
	private hiddenForSnapshot(snap: { clusters: ReadonlyArray<TCluster>; quads: ReadonlyArray<TQuad> }): string[] {
		const types = new Set<string>();
		for (const c of snap.clusters) types.add(c.type);
		for (const q of snap.quads) types.add(q.namedGraph);
		return this.hiddenGraphsFor(types);
	}

	/** Whether a visibility change narrows the refetch to the visible types (the main graph's limit optimization).
	 *  A small-scope view (the class browser) overrides to false: it always fetches the full set and applies visibility
	 *  client-side, so the served schema is always pruned against complete evidence. */
	protected get narrowsRefetchToVisible(): boolean {
		return true;
	}

	protected commitHidden(hiddenGraphs: string[], visibleTypes: string[] | undefined, perTypeLimit: number): void {
		this.setGraphState({ hiddenGraphs });
		void this.refetchSnapshot({ types: this.narrowsRefetchToVisible ? visibleTypes : undefined, perTypeLimit });
	}

	/** Hide/show delta: the control-products setter calls this; the on-screen filter sets the visible set directly via commitHidden. */
	applyHiddenChange(change: { hide?: string[]; show?: string[] }): void {
		for (const t of change.hide ?? []) this.filterOverrides[t] = false;
		for (const t of change.show ?? []) this.filterOverrides[t] = true;
		const hidden = this.computeHiddenGraphs();
		const visibleTypes = [...this.allKnownGraphs()].filter((t) => !hidden.includes(t));
		this.commitHidden(hidden, visibleTypes.length > 0 ? visibleTypes : undefined, this.cgState.perTypeLimit);
	}

	protected async refetchSnapshot(opts: { perTypeLimit: number; types?: string[] }): Promise<void> {
		try {
			const snap = await getGraphSnapshot({ perTypeLimit: opts.perTypeLimit, types: opts.types, forceRefresh: true, scope: this.snapshotScope });
			for (const c of snap.clusters) this.knownClusters.set(c.type, c);
			// On-demand subjects are in the fresh snapshot now; clearing lets one re-load if a new limit sampled it out.
			this.fetchedSubjects.clear();
			this.setGraphState({ quads: snap.quads, clusters: snap.clusters, site: snap.site, perTypeLimit: opts.perTypeLimit, hiddenGraphs: this.hiddenForSnapshot(snap) });
			this.onGraphData();
		} catch {
			/* stepper may not be loaded */
		}
	}

	protected syncFromSnapshot(extra: Partial<TClusteredGraphState> = {}): void {
		const snap = currentSnapshot(this.snapshotScope);
		for (const c of snap.clusters) this.knownClusters.set(c.type, c);
		// Recompute hiddenGraphs on every live SSE batch so a graph that FIRST appears mid-run (e.g. a new observation/*
		// type from a web interaction) is classified the moment it streams in, not left visible until the next refetch.
		// Safe to do every batch because an imperative renderer keys its repaint off the VISIBLE model, not this set: a
		// hidden-only change leaves the visible model untouched, so it never triggers a re-layout (it once did, which both
		// showed mid-run instrumentation and re-spread the graph off-frame).
		this.setGraphState({ quads: snap.quads, clusters: snap.clusters, site: snap.site, hiddenGraphs: this.hiddenForSnapshot(snap), ...extra });
		this.onGraphData();
	}

	/** Reveal a selected subject's bounded neighborhood (both directions, pinned), once per view lifetime. */
	protected async fetchIfMissing(subject: string, label: string): Promise<void> {
		if (this.fetchedSubjects.has(subject)) return;
		if (!getRels(label)) return; // non-individual graphs (facts, observation/*, variables) have no neighborhood
		this.fetchedSubjects.add(subject);
		try {
			const types = await expandNeighborhood(label, subject);
			if (types.size === 0) return;
			// Expand every touched type so revealed nodes render instead of staying inside a collapsed cluster.
			const expanded = [...new Set([...this.cgState.expandedGraphs, ...types])];
			this.syncFromSnapshot({ expandedGraphs: expanded });
		} catch {
			this.fetchedSubjects.delete(subject);
		}
	}
}
