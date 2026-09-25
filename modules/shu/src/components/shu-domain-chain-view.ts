/**
 * ShuDomainChainView: domain-chain visualization.
 *
 * Renders the affordances snapshot through the shared `shu-graph` component:
 * domains as nodes coloured by fact presence and goal-resolver verdict, steps
 * as labeled edges. Schema edges that participate in at least one goal-resolver
 * path are tagged with the path id in the projection (`annotateGoalPaths`) and
 * the renderer paints them as "active": a distinct stroke colour over the
 * default thin / dashed style. Potential edges (invokable steps that no current
 * goal-path runs through) keep the kind-based style.
 *
 * The chain view owns: toolbar (layout / zoom / copy via shu-graph),
 * shu-graph-filter integration (kind + stepper axes, cookie-persisted),
 * SSE live updates, URL deep-link selection sync, and click routing through
 * PaneState. Rendering, hover-highlight, selection-highlight, and the render
 * lifecycle live in shu-graph.
 */
import { html, css, type TemplateResult } from "lit";
import { shuBaseStyles } from "./styles.js";
import { z } from "zod";
import { conduit } from "../hypermedia.js";
import { type TEvent } from "../event-stream.js";
import { AFFORDANCE_EVENT_PREFIX } from "@haibun/core/lib/affordances.js";
import { projectDomainChain, waypointNodeId, type TAffordancesSnapshot, type TWaypointSnapshot } from "../graph/project-domain-chain.js";
import { filterGraph, graphAxes } from "../graph/filter-graph.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { SHU_EVENT, AFFORDANCE_PARAM, DEEP_LINK_PREFIX, SHU_TAG } from "../consts.js";
import { RPC_METHOD } from "../consts.js";
import * as ViewHash from "../view-hash.js";
import { factSeqPath } from "@haibun/core/lib/seq-path.js";
import { openRef } from "./ref-navigation.js";
import { domainRef, stepRef } from "./shu-ref.js";
import { LINT_FINDING, LintFindingSchema, type TLintFinding } from "@haibun/core/lib/domain-chain-lint.js";
import { stepMethodName } from "@haibun/core/lib/step-registry.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { PaneState } from "../pane-state.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { ShuGraphFilter } from "./shu-graph-filter.js";
import type { ShuGraph } from "./shu-graph.js";
import { NODE_KIND } from "../graph/types.js";
import { linkTo } from "../rpc-registry.js";

const FILTER_KEY = "domain-chain";
void ShuGraphFilter;

const StateSchema = z.object({
	loadState: z.enum(["idle", "fetching", "loaded", "empty"]).default("idle"),
	fetchError: z.string().default(""),
	hiddenSteppers: z.array(z.string()).default([]),
	hiddenKinds: z.array(z.string()).default([]),
	layout: z.enum(["TB", "LR"]).default("LR"),
});

export class ShuDomainChainView extends ShuElement<typeof StateSchema> {
	/** Delegates to the embedded shu-graph, which summarizes the domain-chain nodes and edges. */
	summarizeForKihan(): TLinkedData | null {
		if (!this.affordances) return null;
		return (this.shadowRoot?.querySelector("shu-graph") as ShuGraph | null)?.summarizeForKihan() ?? null;
	}

	static styles = [
		shuBaseStyles,
		css`
		:host { display: flex; flex-direction: column; height: 100%; font-family: inherit; }
		.header { display: flex; justify-content: space-between; align-items: baseline; padding: var(--shu-space-4) var(--shu-space-5) var(--shu-space-2); flex-shrink: 0; }
		.header h3 { margin: 0; font-size: var(--shu-font-md); color: var(--shu-fg-muted); }
		.explanation { padding: 0 var(--shu-space-5); flex-shrink: 0; }
		.explanation summary { cursor: pointer; font-size: var(--shu-font-md); color: var(--shu-fg-muted); padding: var(--shu-space-2) 0; }
		.explanation p { margin: var(--shu-space-2) 0; font-size: var(--shu-font-md); color: var(--shu-fg); }
		.empty {
			color: var(--shu-fg-muted); font-size: var(--shu-font-md); padding: var(--shu-space-5); margin: var(--shu-space-5);
			background: var(--shu-bg-soft); border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius);
		}
		.empty code { background: var(--shu-bg-elevated); padding: var(--shu-space-1) var(--shu-space-2); border-radius: var(--shu-radius); font-size: var(--shu-font-sm); }
		.error {
			color: var(--shu-error); font-size: var(--shu-font-md); padding: var(--shu-space-4) var(--shu-space-5); margin: var(--shu-space-4) var(--shu-space-5);
			background: var(--shu-bg-error-soft); border: var(--shu-border-w) solid var(--shu-error); border-radius: var(--shu-radius);
		}
		.view-controls {
			display: flex; gap: var(--shu-space-2); align-items: center; padding: var(--shu-space-2) var(--shu-space-4);
			border-bottom: var(--shu-border-w) solid var(--shu-border); background: var(--shu-bg); flex-shrink: 0; flex-wrap: wrap;
		}
		.view-controls button { padding: var(--shu-space-1) var(--shu-space-4); cursor: pointer; }
		.view-controls shu-graph-filter { flex: 1; min-width: 0; }
		:host(:not([data-show-controls])) .view-controls { display: none; }
		.zoom-label { color: var(--shu-fg-muted); font-size: var(--shu-font-md); min-width: 38px; text-align: center; }
		shu-graph { flex: 1; min-height: 0; overflow: hidden; }
	`,
	];
	static domainSelector = SHU_TAG.DOMAIN_CHAIN_VIEW;

	private affordances: TAffordancesSnapshot | null = null;
	/** Test-only accessor; production reads happen inside `render()`. */
	getAffordances(): TAffordancesSnapshot | null {
		return this.affordances;
	}
	private lastSnapshotFingerprint = "";
	/** UI-only selection, kept outside the Zod state so toggling it doesn't trigger
	 * a re-render. Pushed to the embedded shu-graph via its `selectedNodeId` property. */
	private selectedNodeId = "";

	constructor() {
		const persisted = ShuGraphFilter.getPersistedAxes(FILTER_KEY);
		super(StateSchema, {
			loadState: "idle",
			fetchError: "",
			hiddenSteppers: persisted.stepper ?? [],
			// First-time visitors see only actionable nodes; "unreachable" stays available
			// via view settings so users debugging a missing producer can opt back in.
			hiddenKinds: persisted.kind ?? ["unreachable"],
			layout: "LR",
		});
	}

	/** UI-only zoom percentage. Lives outside Zod state so changing it never triggers
	 * a chain-view re-render: the shu-graph element receives setZoom() directly and
	 * applies a CSS transform to its container without re-running the layout. */
	private zoomPercent = 100;

	protected override onConnected(): void {
		if (!this.hasAttribute("data-testid")) this.setAttribute("data-testid", "shu-domain-chain");
		if (this.affordances === null) void this.fetchInitial();
		// Subscribe to the goal-resolver's `affordances.<seqPath>` events so the chain
		// repaints as the graph state changes. Each step's afterStep emits an event
		// regardless of whether it changed anything, so dedup against a fingerprint of
		// the rendered fields, otherwise every step kicks a full re-render
		// even when the snapshot is byte-identical.
		// Batch the subscription: on reload the stream replays the whole `affordances.` history at once (thousands of
		// events). Per-event this re-fetched + re-rendered the mermaid graph once per replayed step: the reload-jank that
		// pins the page for tens of seconds. subscribeBatchedEvents collapses the replay to one re-fetch per frame.
		try {
			this.autoTeardown(
				this.subscribeBatched({
					// afterStep emits a lean change signal (no payload), quietly re-fetch the current snapshot, once per batch.
					onBatch: () => void this.fetchInitial(true),
					filter: (event: TEvent) => typeof event.id === "string" && (event.id as string).startsWith(AFFORDANCE_EVENT_PREFIX),
				}),
			);
		} catch {
			// No EventStream installed (early jsdom test, standalone). Ignore.
		}
		// React to view-state changes so the highlight follows the address. Selection lives outside the state schema, so
		// update the shu-graph's selectedNodeId directly: no re-layout, no graph movement.
		this.autoTeardown(
			ViewHash.onHashChanged(() => {
				this.syncSelectionFromUrl();
				this.applySelectionToGraph();
			}),
		);
	}

	/** View-open contract, pane-opener assigns producer products on mount. */
	set products(p: Record<string, unknown>) {
		if (!Array.isArray(p.forward) || !Array.isArray(p.goals)) {
			throw new Error(
				`shu-domain-chain-view requires products with \`forward\` and \`goals\` arrays. Received keys: [${Object.keys(p).join(", ")}]. The step's productsDomain schema must include forward+goals; the action must populate them.`,
			);
		}
		this.affordances = {
			forward: p.forward as TAffordancesSnapshot["forward"],
			goals: p.goals as TAffordancesSnapshot["goals"],
			composites: p.composites as TAffordancesSnapshot["composites"],
			waypoints: Array.isArray(p.waypoints) ? (p.waypoints as TWaypointSnapshot[]) : undefined,
			satisfiedDomains: Array.isArray(p.satisfiedDomains) ? (p.satisfiedDomains as string[]) : undefined,
			satisfiedFacts: typeof p.satisfiedFacts === "object" && p.satisfiedFacts !== null ? (p.satisfiedFacts as Record<string, string[]>) : undefined,
		};
		// A chain lint report carries its findings beside the chain.
		this.findings = p.findings === undefined ? [] : z.array(LintFindingSchema).parse(p.findings);
		this.setState({ loadState: "loaded", fetchError: "" });
	}

	/** What a chain lint report found, when the view shows one. */
	private findings: TLintFinding[] = [];

	/** One finding, its step and its domain each a link to its view. */
	private findingTpl(f: TLintFinding): TemplateResult {
		const step = (stepperName: string, stepName: string) => stepRef(stepMethodName(stepperName, stepName));
		switch (f.kind) {
			case LINT_FINDING.ORPHAN_STEP:
				return html`${step(f.stepperName, f.stepName)} returns ${domainRef(f.outputDomain)}, which no step takes`;
			case LINT_FINDING.UNSUPPLIED_STEP:
				return html`${step(f.stepperName, f.stepName)} takes ${domainRef(f.inputDomain)}, which no step returns and a caller doesn't write`;
			case LINT_FINDING.UNREACHABLE_DOMAIN:
				return html`no step takes or returns ${domainRef(f.domain)}`;
			case LINT_FINDING.UNPRODUCED_DOMAIN:
				return html`a step takes ${domainRef(f.domain)}, and no step returns it`;
			case LINT_FINDING.STRING_PARAM:
				return html`${step(f.stepperName, f.stepName)} takes ${f.param} as ${domainRef(f.domain)}, which says nothing of what the value is`;
			case LINT_FINDING.UNNAMED_PRODUCTS:
				return html`${step(f.stepperName, f.stepName)} returns products with a schema and no domain`;
		}
	}

	private async fetchInitial(quiet = false): Promise<void> {
		// `quiet` (a live re-fetch on a change signal) skips the loadState transitions so the chain never flashes.
		if (!quiet) this.setState({ loadState: "fetching" });
		const candidates = [RPC_METHOD.AFFORDANCES_ON_OFFER];
		let lastError = "";
		for (const method of candidates) {
			try {
				const response = await conduit().follow<Record<string, unknown>>(linkTo(method), `domain-chain-view: ${method}`);
				if (Array.isArray(response?.forward) && Array.isArray(response?.goals)) {
					this.affordances = {
						forward: response.forward as TAffordancesSnapshot["forward"],
						goals: response.goals as TAffordancesSnapshot["goals"],
						composites: response.composites as TAffordancesSnapshot["composites"],
						waypoints: Array.isArray(response.waypoints) ? (response.waypoints as TWaypointSnapshot[]) : undefined,
						satisfiedDomains: Array.isArray(response.satisfiedDomains) ? (response.satisfiedDomains as string[]) : undefined,
						satisfiedFacts: typeof response.satisfiedFacts === "object" && response.satisfiedFacts !== null ? (response.satisfiedFacts as Record<string, string[]>) : undefined,
					};
					this.setState({ loadState: "loaded", fetchError: "" });
					return;
				}
				lastError = `${method} returned an unrecognised shape; expected {forward[], goals[]}`;
			} catch (err) {
				lastError = `RPC ${method} failed: ${errorDetail(err)}`;
			}
		}
		if (!quiet) this.setState({ loadState: "empty", fetchError: lastError });
	}

	render(): TemplateResult {
		const a = this.affordances;
		const { loadState, fetchError, layout } = this.state;
		if (!a) {
			if (loadState === "fetching") return html`<shu-spinner visible status="Loading domain chain…"></shu-spinner>`;
			return html`
				${fetchError ? html`<div class="error" data-testid=${SHU_TEST_IDS.DOMAIN_CHAIN.ERROR}>${fetchError}</div>` : ""}
				<div class="empty" data-testid=${SHU_TEST_IDS.DOMAIN_CHAIN.EMPTY}>No chain data yet. Invoke <code>show affordances</code> from the actions bar (Step mode), or run any step.</div>
			`;
		}
		return html`
			<div class="header"><h3>Domain chain</h3></div>
			<details class="explanation">
				<summary>How to read this</summary>
				<p>Attributed property graph of the schemas. Nodes: domains, waypoints, fact instances. Edges: steps from input domains to output domain.</p>
				<p><strong>Node colour</strong>, green: fact exists; blue: reachable; amber: blocked. Unreachable nodes are hidden by default; open view settings to unhide them.</p>
				<p><strong>Edge style</strong>, solid bold: ready; dashed: blocked. Edges traversed by a goal-resolver path render in amber to mark which steps the resolver currently routes through. A ⚷ on the label means the step needs a capability that has not been granted.</p>
				<p>Click a domain or waypoint to open it in the affordances panel. Click a fact instance to open its producing step.</p>
			</details>
			<div class="view-controls" data-testid=${SHU_TEST_IDS.DOMAIN_CHAIN.CONTROLS}>
				<button data-action="layout" title="Toggle layout direction">${layout}</button>
				<button data-action="zoom-out" title="Zoom out">−</button>
				<span class="zoom-label"></span>
				<button data-action="zoom-in" title="Zoom in">+</button>
				<shu-graph-filter data-axis-cookie-key=${FILTER_KEY}></shu-graph-filter>
			</div>
			<shu-graph data-testid=${SHU_TEST_IDS.DOMAIN_CHAIN.GRAPH}></shu-graph>
			${
				this.findings.length
					? html`<details class="findings" open data-testid=${SHU_TEST_IDS.DOMAIN_CHAIN.FINDINGS}>
							<summary>${this.findings.length} findings</summary>
							<ul>${this.findings.map((f) => html`<li data-testid=${SHU_TEST_IDS.DOMAIN_CHAIN.FINDING}>${this.findingTpl(f)}</li>`)}</ul>
						</details>`
					: ""
			}
		`;
	}

	protected updated(): void {
		const zoomLabel = this.shadowRoot?.querySelector(".zoom-label");
		if (zoomLabel) zoomLabel.textContent = `${this.zoomPercent}%`;
		const a = this.affordances;
		if (!a) return;
		const rawGraph = projectDomainChain(a);
		rawGraph.direction = this.state.layout;
		const hiddenSteppers = new Set(this.state.hiddenSteppers);
		const hiddenKinds = new Set(this.state.hiddenKinds);
		const graph = filterGraph(rawGraph, { hiddenSteppers, hiddenKinds });
		graph.direction = this.state.layout;

		const filterEl = this.shadowRoot?.querySelector("shu-graph-filter") as (ShuGraphFilter & HTMLElement) | null;
		if (filterEl) {
			if (this.showControls) filterEl.setAttribute("show-controls", "");
			else filterEl.removeAttribute("show-controls");
			const axes = graphAxes(rawGraph);
			filterEl.setAxes({ stepper: axes.steppers, kind: axes.kinds });
			filterEl.addEventListener(SHU_EVENT.GRAPH_FILTER_CHANGE as string, (e) => {
				const d = (e as CustomEvent).detail as { hiddenByAxis?: Record<string, string[]> };
				const hba = d.hiddenByAxis ?? {};
				this.setState({ hiddenSteppers: hba.stepper ?? [], hiddenKinds: hba.kind ?? [] });
			});
		}

		const graphEl = this.shadowRoot?.querySelector("shu-graph") as (ShuGraph & HTMLElement) | null;
		if (graphEl) {
			graphEl.products = { graph, options: {} };
			graphEl.setZoom(this.zoomPercent);
			graphEl.addEventListener(SHU_EVENT.GRAPH_NODE_CLICK as string, (e) => {
				const detail = (e as CustomEvent).detail as {
					nodeId?: string;
					node?: { id?: string; kind?: string; link?: { href?: string }; wasGeneratedBy?: { factId: string; domain: string } } | null;
				};
				const node = detail?.node;
				if (!detail?.nodeId || !node) {
					this.selectedNodeId = "";
					graphEl.selectedNodeId = "";
					this.clearAffordanceUrl();
					return;
				}
				this.selectedNodeId = detail.nodeId;
				graphEl.selectedNodeId = detail.nodeId;
				this.routeNodeClick(node);
			});
			this.syncSelectionFromUrl();
			queueMicrotask(() => this.applySelectionToGraph());
		}

		this.bindToolbar();
	}

	private bindToolbar(): void {
		for (const btn of Array.from(this.shadowRoot?.querySelectorAll<HTMLButtonElement>(".view-controls button[data-action]") ?? [])) {
			btn.addEventListener("click", () => {
				const action = btn.dataset.action;
				if (action === "zoom-in" || action === "zoom-out") {
					this.zoomPercent = action === "zoom-in" ? Math.min(400, this.zoomPercent + 10) : Math.max(10, this.zoomPercent - 10);
					const graphEl = this.shadowRoot?.querySelector("shu-graph") as (ShuGraph & HTMLElement) | null;
					graphEl?.setZoom(this.zoomPercent);
					const label = this.shadowRoot?.querySelector(".zoom-label");
					if (label) label.textContent = `${this.zoomPercent}%`;
					return;
				}
				if (action === "layout") {
					this.setState({ layout: this.state.layout === "TB" ? "LR" : "TB" });
					return;
				}
			});
		}
	}

	/** Push the current selection to the embedded shu-graph if it exists. */
	private applySelectionToGraph(): void {
		const graphEl = this.shadowRoot?.querySelector("shu-graph") as (ShuGraph & HTMLElement) | null;
		if (graphEl) graphEl.selectedNodeId = this.selectedNodeId;
	}

	/** Map the deep-link params to a node id and update selection. */
	private syncSelectionFromUrl(): void {
		const goal = ViewHash.hashParam(AFFORDANCE_PARAM.GOAL);
		const waypoint = ViewHash.hashParam(AFFORDANCE_PARAM.WAYPOINT);
		this.selectedNodeId = goal ? goal : waypoint ? waypointNodeId(waypoint) : "";
	}

	/** Drop the deep-link params so deselecting in the chain clears the affordance view state too. */
	private clearAffordanceUrl(): void {
		ViewHash.mergeHashParams({ [AFFORDANCE_PARAM.GOAL]: "", [AFFORDANCE_PARAM.WAYPOINT]: "" });
	}

	/**
	 * SSE-snapshot reducer. Public for testability.
	 *
	 * Three invariants enforced:
	 *  - Identical snapshots are dropped (a fast fingerprint diff): every step's afterStep
	 *    emits an event regardless of whether the graph changed, so most snapshots are no-ops.
	 *  - A "downgrade" (incoming forward strictly shorter than current) is dropped: some
	 *    emit contexts publish a partial view (subprocess, scoped resolver). Keeping the
	 *    richer snapshot prevents most of the graph from disappearing mid-session.
	 *  - Accepted snapshots merge over the previous so fields that only some snapshots
	 *    supplies (waypoints, satisfiedDomains) survive afterStep updates that omit them.
	 *
	 * Returns true when the snapshot was applied, false when dropped. The caller stays
	 * thin so this method can be unit-tested without DOM / SSE setup.
	 */
	applySseSnapshot(incoming: TAffordancesSnapshot): boolean {
		const currentForward = this.affordances?.forward?.length ?? 0;
		const incomingForward = incoming.forward?.length ?? 0;
		if (currentForward > 0 && incomingForward < currentForward) {
			console.log(`[chain] SSE: skipping downgrade (current forward=${currentForward}, incoming=${incomingForward})`);
			return false;
		}
		const fingerprint = JSON.stringify([incoming.forward, incoming.goals, incoming.satisfiedDomains, incoming.waypoints, incoming.composites]);
		if (fingerprint === this.lastSnapshotFingerprint) return false;
		this.lastSnapshotFingerprint = fingerprint;
		this.affordances = { ...this.affordances, ...incoming };
		this.setState({ loadState: "loaded" });
		return true;
	}

	/** Click router for a graph node. Public for testability. */
	routeNodeClick(node: { id?: string; kind?: string; link?: { href?: string }; wasGeneratedBy?: { factId: string; domain: string } }): void {
		// A fact-instance node opens the step that produced the fact.
		if (node.kind === NODE_KIND.factInstance && node.wasGeneratedBy?.factId) {
			const seqPath = factSeqPath(node.wasGeneratedBy.factId);
			if (!seqPath) throw new Error(`fact "${node.wasGeneratedBy.factId}" names no step: a fact's id is the seqPath of the step that produced it`);
			openRef(this, "seqPath", { seqPath });
			return;
		}
		// Every other node of the chain projection deep-links into the affordances panel.
		const href = node.link?.href;
		if (typeof href !== "string" || !href.startsWith(DEEP_LINK_PREFIX)) throw new Error(`chain node ${node.id ?? "(no id)"} has no deep link to open`);
		ViewHash.mergeHashParams(Object.fromEntries(ViewHash.hashParams(href)));
		PaneState.requestFrom(this, { paneType: "component", tag: SHU_TAG.AFFORDANCES_PANEL, label: "Affordances" });
	}
}
