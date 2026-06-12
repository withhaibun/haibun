/**
 * Shared base for every view that renders the clustered-quad snapshot as a graph (the reactive mermaid
 * overview and any imperative canvas renderer a consumer mounts). It owns the one data pathway — fetch, live SSE merge, type filter, cluster +
 * neighborhood expansion, selection — so the two views can't drift. A subclass overrides only `onGraphConnected`
 * (mount its renderer), `onGraphData` (repaint), and `onGraphSelection` (highlight). Data lives on `this.state`:
 * `setState` repaints the overview reactively, while `onGraphData` drives an imperative renderer (e.g. a
 * WebGL canvas) that lit can't reconcile.
 */
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { extractQuadsFromEvents, type TCluster, type TQuad } from "@haibun/core/lib/quad-types.js";
import { isInstrumentationGraph } from "@haibun/core/lib/instrumentation-graphs.js";
import { getRels } from "../rels-cache.js";
import { getGraphSnapshot, currentSnapshot, mergeQuadsIntoSnapshot, subscribeViewContext, DEFAULT_PER_TYPE_LIMIT } from "../quads-snapshot.js";
import { expandNeighborhood } from "../graph-expansion.js";
import { ShuGraphFilter } from "./shu-graph-filter.js";

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
});

/** The state fields every clustered-graph view shares; a subclass spreads this into its own `z.object({...})`. */
export const clusteredGraphStateShape = {
	quads: z.array(QuadFieldSchema).default([]),
	clusters: z.array(ClusterFieldSchema).default([]),
	perTypeLimit: z.number().int().positive().default(DEFAULT_PER_TYPE_LIMIT),
	hiddenGraphs: z.array(z.string()).default([]),
	expandedGraphs: z.array(z.string()).default([]),
};

const ClusteredGraphStateSchema = z.object(clusteredGraphStateShape);
export type TClusteredGraphState = z.infer<typeof ClusteredGraphStateSchema>;

export abstract class ShuClusteredGraphView<T extends z.ZodTypeAny> extends ShuElement<T> {
	protected knownClusters = new Map<string, TCluster>();
	protected fetchedSubjects = new Set<string>();
	private graphInitialized = false;

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

	/** Awaited before the first load — a subclass mounts its renderer here (after its render root exists). */
	protected onGraphConnected(): void | Promise<void> {
		/* no-op default; subclasses override */
	}
	/** Repaint after a data change. The overview repaints reactively via setState, so it leaves this empty; an imperative canvas view redraws here. */
	protected onGraphData(): void {
		/* no-op default; subclasses override */
	}
	/** A selection (from any view) — the overview highlights it; the base also fetches its neighborhood (below). */
	protected onGraphSelection(_subject: string | null, _label: string | null): void {
		/* no-op default; subclasses override */
	}

	/** The time-visible slice of the snapshot: quads at/before the global time cursor (all of them with no cursor).
	 * The ONE time pathway every clustered graph view renders from — never `state.quads` directly — so scrubbing
	 * the shared timeline hides/restores the same objects in every view. */
	protected get visibleQuads(): TQuad[] {
		return this.filterByTime(this.cgState.quads);
	}

	private lastTimeSync = 0;
	private timeSyncTimer = 0;
	/** The cursor moves continuously during timeline play: coalesce repaints to 500ms; the trailing call lands the final position. */
	protected override onTimeSync(): void {
		const apply = () => {
			this.lastTimeSync = Date.now();
			this.refresh(); // the reactive overview re-renders from visibleQuads
			this.onGraphData(); // an imperative renderer re-derives its model from visibleQuads
		};
		if (Date.now() - this.lastTimeSync >= 500) apply();
		else if (!this.timeSyncTimer) {
			this.timeSyncTimer = window.setTimeout(() => {
				this.timeSyncTimer = 0;
				apply();
			}, 500);
		}
	}

	protected override async onConnected(): Promise<void> {
		if (this.graphInitialized) return;
		this.graphInitialized = true;

		this.autoListen(this, SHU_EVENT.GRAPH_FILTER_CHANGE, ((e: CustomEvent<{ types: string[]; perTypeLimit: number }>) => {
			// The filter reports the VISIBLE types; hidden is the complement over all known types.
			const visible = new Set(e.detail.types);
			const hiddenGraphs = [...this.allKnownGraphs()].filter((t) => !visible.has(t));
			this.commitHidden(hiddenGraphs, e.detail.types, e.detail.perTypeLimit);
		}) as EventListener);
		this.autoListen(this, SHU_EVENT.GRAPH_CLUSTER_EXPAND, (() => {
			const nextLimit = Math.max(this.cgState.perTypeLimit * 2, this.cgState.perTypeLimit + 100);
			const visibleTypes = [...this.knownClusters.keys()].filter((t) => !this.cgState.hiddenGraphs.includes(t));
			void this.refetchSnapshot({ types: visibleTypes.length > 0 ? visibleTypes : undefined, perTypeLimit: nextLimit });
		}) as EventListener);

		if (this.usesExternalData) {
			await this.onGraphConnected();
			return;
		}

		// One persistence source for the hidden set + budget across every clustered view: the embedded <shu-graph-filter>.
		const initial = ShuGraphFilter.getPersistedFilter();
		this.setGraphState({ hiddenGraphs: initial.hiddenTypes });
		await this.onGraphConnected();
		await this.refetchSnapshot({ perTypeLimit: initial.perTypeLimit });

		if (this.hasAttribute("data-snapshot-time")) return; // snapshot mode: one fetch, no live updates

		this.autoTeardown(
			this.subscribeBatched({
				onBatch: (events) => {
					const quads = extractQuadsFromEvents(events);
					if (quads.length === 0) return;
					mergeQuadsIntoSnapshot(quads);
					// An instrumentation-only batch is this view's own observed RPCs; re-rendering on it loops render→RPC→observe→render.
					if (quads.some((q) => !isInstrumentationGraph(q.namedGraph))) this.syncFromSnapshot();
				},
			}),
		);
		this.autoTeardown(
			subscribeViewContext({
				onSelectionChange: (subject, label) => {
					this.onGraphSelection(subject, label);
					if (subject && label) void this.fetchIfMissing(subject, label);
				},
			}),
		);
	}

	// Snapshot clusters plus types seen only in live quads.
	protected allKnownGraphs(): Set<string> {
		const all = new Set<string>(this.knownClusters.keys());
		for (const q of this.cgState.quads) all.add(q.namedGraph);
		return all;
	}

	protected commitHidden(hiddenGraphs: string[], visibleTypes: string[] | undefined, perTypeLimit: number): void {
		this.setGraphState({ hiddenGraphs });
		void this.refetchSnapshot({ types: visibleTypes, perTypeLimit });
	}

	/** Hide/show delta — the control-products setter calls this; the on-screen filter sets the visible set directly via commitHidden. */
	applyHiddenChange(change: { hide?: string[]; show?: string[] }): void {
		const hidden = new Set(this.cgState.hiddenGraphs);
		for (const t of change.hide ?? []) hidden.add(t);
		for (const t of change.show ?? []) hidden.delete(t);
		const visibleTypes = [...this.allKnownGraphs()].filter((t) => !hidden.has(t));
		this.commitHidden([...hidden], visibleTypes.length > 0 ? visibleTypes : undefined, this.cgState.perTypeLimit);
	}

	protected async refetchSnapshot(opts: { perTypeLimit: number; types?: string[] }): Promise<void> {
		try {
			const snap = await getGraphSnapshot({ perTypeLimit: opts.perTypeLimit, types: opts.types, forceRefresh: true });
			for (const c of snap.clusters) this.knownClusters.set(c.type, c);
			// On-demand subjects are in the fresh snapshot now; clearing lets one re-load if a new budget sampled it out.
			this.fetchedSubjects.clear();
			this.setGraphState({ quads: snap.quads, clusters: snap.clusters, perTypeLimit: opts.perTypeLimit });
			this.onGraphData();
		} catch {
			/* stepper may not be loaded */
		}
	}

	protected syncFromSnapshot(extra: Partial<TClusteredGraphState> = {}): void {
		const snap = currentSnapshot();
		for (const c of snap.clusters) this.knownClusters.set(c.type, c);
		this.setGraphState({ quads: snap.quads, clusters: snap.clusters, ...extra });
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
			// Expand every touched type so revealed nodes render instead of staying folded in a collapsed cluster.
			const expanded = [...new Set([...this.cgState.expandedGraphs, ...types])];
			this.syncFromSnapshot({ expandedGraphs: expanded });
		} catch {
			this.fetchedSubjects.delete(subject);
		}
	}
}
