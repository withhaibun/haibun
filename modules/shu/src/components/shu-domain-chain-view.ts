/**
 * ShuDomainChainView — domain-chain visualization.
 *
 * Renders the affordances snapshot through the shared `shu-graph` component:
 * domains as nodes coloured by fact presence and goal-resolver verdict, steps
 * as labeled edges. Schema edges that participate in at least one goal-resolver
 * path are tagged with the path id in the projection (`annotateGoalPaths`) and
 * the renderer paints them as "active" — a distinct stroke colour over the
 * default thin / dashed style. Potential edges (real steps the user could
 * invoke that no current goal-path runs through) keep the kind-based style.
 *
 * The chain view owns: toolbar (layout / zoom / copy via shu-graph),
 * shu-graph-filter integration (kind + stepper axes, cookie-persisted),
 * SSE live updates, URL deep-link selection sync, and click routing through
 * PaneState. Rendering, hover-highlight, selection-highlight, and the mermaid
 * lifecycle live in shu-graph.
 */
import { z } from "zod";
import { SseClient, inAction } from "../sse-client.js";
import { projectDomainChain, waypointNodeId, type TAffordancesSnapshot, type TWaypointSnapshot } from "../graph/project-domain-chain.js";
import { filterGraph, graphAxes } from "../graph/filter-graph.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { SHU_EVENT } from "../consts.js";
import { parseSeqPath } from "@haibun/core/lib/seq-path.js";
import { PaneState } from "../pane-state.js";
import { ShuElement } from "./shu-element.js";
import { ShuGraphFilter } from "./shu-graph-filter.js";
import type { ShuGraph } from "./shu-graph.js";

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
	static domainSelector = "shu-domain-chain-view";

	private affordances: TAffordancesSnapshot | null = null;
	/** Test-only accessor; production reads happen inside `render()`. */
	getAffordances(): TAffordancesSnapshot | null {
		return this.affordances;
	}
	private sseUnsubscribe: (() => void) | null = null;
	private lastSnapshotFingerprint = "";
	private popstateHandler: (() => void) | null = null;
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
	 * a chain-view re-render — the shu-graph element receives setZoom() directly and
	 * applies a CSS transform to its container without re-running mermaid. */
	private zoomPercent = 100;

	static get observedAttributes(): string[] {
		return ["data-show-controls"];
	}

	attributeChangedCallback(name: string): void {
		if (name === "data-show-controls" && this.shadowRoot) this.render();
	}

	override connectedCallback(): void {
		if (!this.hasAttribute("data-testid")) this.setAttribute("data-testid", "shu-domain-chain");
		super.connectedCallback();
		if (this.affordances === null) void this.fetchInitial();
		// Live updates: subscribe to the goal-resolver's `affordances.<seqPath>` events
		// so the chain repaints as the graph state changes. Each step's afterStep emits
		// an event regardless of whether it changed anything, so dedup against a fingerprint
		// of the fields we actually render — otherwise every step kicks a full mermaid
		// re-render even when the snapshot is byte-identical.
		try {
			const sse = SseClient.for("");
			this.sseUnsubscribe = sse.onEvent(
				(event) => {
					const body = event.json as { affordances?: TAffordancesSnapshot } | undefined;
					if (!body?.affordances) return;
					this.applySseSnapshot(body.affordances);
				},
				(event) => typeof event.id === "string" && event.id.startsWith("affordances."),
			);
		} catch {
			// No SSE in this environment (jsdom, standalone). Ignore.
		}
		// React to URL changes so the highlight (`?aff-goal=` / `?aff-waypoint=`) follows
		// the address bar. Selection lives outside the state schema, so we update the
		// shu-graph's selectedNodeId directly — no mermaid re-layout, no graph movement.
		this.popstateHandler = () => {
			this.syncSelectionFromUrl();
			this.applySelectionToGraph();
		};
		window.addEventListener("popstate", this.popstateHandler);
	}

	disconnectedCallback(): void {
		this.sseUnsubscribe?.();
		this.sseUnsubscribe = null;
		if (this.popstateHandler) window.removeEventListener("popstate", this.popstateHandler);
		this.popstateHandler = null;
	}

	/** View-open contract — pane-opener assigns producer products on mount. */
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
		this.setState({ loadState: "loaded", fetchError: "" });
	}

	private async fetchInitial(): Promise<void> {
		this.setState({ loadState: "fetching" });
		let sse: SseClient;
		try {
			sse = SseClient.for("");
		} catch (err) {
			// No EventSource (jsdom, standalone). Surface the empty state with the reason.
			this.setState({ loadState: "empty", fetchError: `SSE unavailable: ${errorDetail(err)}` });
			return;
		}
		const candidates = ["ActivitiesStepper-showWaypoints", "GoalResolutionStepper-showAffordances"];
		let lastError = "";
		for (const method of candidates) {
			try {
				const response = await inAction((scope) => sse.rpc<Record<string, unknown>>(scope, method, {}));
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
		this.setState({ loadState: "empty", fetchError: lastError });
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		const a = this.affordances;
		const { loadState, fetchError, layout } = this.state;
		if (!a) {
			if (loadState === "fetching") {
				this.shadowRoot.innerHTML = `<style>${STYLES}</style><shu-spinner visible status="Loading domain chain…"></shu-spinner>`;
				return;
			}
			const errHtml = fetchError ? `<div class="error" data-testid="domain-chain-error">${fetchError}</div>` : "";
			this.shadowRoot.innerHTML = `<style>${STYLES}</style>${errHtml}<div class="empty" data-testid="domain-chain-empty">No chain data yet. Invoke <code>show waypoints</code> or <code>show affordances</code> from the actions bar (Step mode), or run any step.</div>`;
			return;
		}

		const rawGraph = projectDomainChain(a);
		rawGraph.direction = layout;
		const hiddenSteppers = new Set(this.state.hiddenSteppers);
		const hiddenKinds = new Set(this.state.hiddenKinds);
		const graph = filterGraph(rawGraph, { hiddenSteppers, hiddenKinds });
		graph.direction = layout;

		// View controls — zoom, layout, axis filter. All gated together by `data-show-controls`
		// (the column-pane's gear); per the view-controls convention, no per-control gating.
		const toolbar = `<div class="view-controls" data-testid="domain-chain-toolbar">
			<button data-action="layout" title="Toggle layout direction">${layout}</button>
			<button data-action="zoom-out" title="Zoom out">&minus;</button>
			<span class="zoom-label">${this.zoomPercent}%</span>
			<button data-action="zoom-in" title="Zoom in">+</button>
			<shu-graph-filter data-axis-cookie-key="${FILTER_KEY}"></shu-graph-filter>
		</div>`;

		this.shadowRoot.innerHTML = `<style>${STYLES}</style>
			<div class="header">
				<h3>Domain chain</h3>
			</div>
			<details class="explanation">
				<summary>How to read this</summary>
				<p>Attributed property graph of the schemas. Nodes: domains, waypoints, fact instances. Edges: steps from input domains to output domain.</p>
				<p><strong>Node colour</strong> — green: fact exists; blue: reachable; amber: blocked. Unreachable nodes are hidden by default; open view settings to unhide them.</p>
				<p><strong>Edge style</strong> — solid bold: ready; dashed: blocked. Edges traversed by a goal-resolver path render in amber to mark which steps the resolver currently routes through. A ⚷ on the label means the step needs a capability that has not been granted.</p>
				<p>Click a domain or waypoint to open it in the affordances panel. Click a fact instance to open its producing step.</p>
			</details>
			${toolbar}
			<shu-graph data-testid="domain-chain-graph"></shu-graph>`;

		const filterEl = this.shadowRoot.querySelector("shu-graph-filter") as (ShuGraphFilter & HTMLElement) | null;
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

		const graphEl = this.shadowRoot.querySelector("shu-graph") as (ShuGraph & HTMLElement) | null;
		if (graphEl) {
			graphEl.products = { graph, options: {} };
			graphEl.setZoom(this.zoomPercent);
			graphEl.addEventListener(SHU_EVENT.GRAPH_NODE_CLICK as string, (e) => {
				const detail = (e as CustomEvent).detail as { nodeId?: string; node?: { id?: string; kind?: string; link?: { href?: string }; wasGeneratedBy?: { factId: string; domain: string } } | null };
				const node = detail?.node;
				if (!detail?.nodeId || !node) {
					// Background click: clear selection + drop deep-link params.
					this.selectedNodeId = "";
					graphEl.selectedNodeId = "";
					this.clearAffordanceUrl();
					return;
				}
				this.selectedNodeId = detail.nodeId;
				graphEl.selectedNodeId = detail.nodeId;
				this.routeNodeClick(node);
			});
			// Apply the URL-derived selection after the graph mounts.
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

	/** Map the URL's `aff-goal` / `aff-waypoint` params to a node id and update selection. */
	private syncSelectionFromUrl(): void {
		const url = new URL(window.location.href);
		const goal = url.searchParams.get("aff-goal");
		const waypoint = url.searchParams.get("aff-waypoint");
		this.selectedNodeId = goal ? goal : waypoint ? waypointNodeId(waypoint) : "";
	}

	/** Drop the deep-link params so deselecting in the chain clears the affordance URL state too. */
	private clearAffordanceUrl(): void {
		const url = new URL(window.location.href);
		let changed = false;
		for (const key of ["aff-goal", "aff-waypoint"]) {
			if (url.searchParams.has(key)) {
				url.searchParams.delete(key);
				changed = true;
			}
		}
		if (changed) {
			window.history.pushState(window.history.state, "", url.toString());
			window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
		}
	}

	/**
	 * SSE-snapshot reducer. Public for testability.
	 *
	 * Three invariants enforced:
	 *  - Identical snapshots are dropped (cheap fingerprint diff) — every step's afterStep
	 *    emits an event regardless of whether the graph changed, so most snapshots are no-ops.
	 *  - A "downgrade" (incoming forward strictly shorter than current) is dropped — some
	 *    emit contexts publish a partial view (subprocess, scoped resolver). Keeping the
	 *    richer snapshot prevents most of the graph from disappearing mid-session.
	 *  - Accepted snapshots merge over the previous so fields that only `showWaypoints`
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
		// Fact-instance nodes carry the producing seqPath as `wasGeneratedBy.factId`.
		// Open the step-detail pane so the user can inspect the producing step.
		if (node.kind === "fact-instance" && node.wasGeneratedBy?.factId) {
			const factId = node.wasGeneratedBy.factId;
			const seqPath = parseSeqPath(factId);
			if (seqPath) {
				PaneState.request({ paneType: "step-detail", seqPath });
				console.log(`[chain] routeNodeClick: opened step-detail for seqPath ${factId}`);
			} else {
				console.log(`[chain] routeNodeClick: fact-instance factId "${factId}" is not a parseable seqPath`);
			}
			return;
		}
		const href = node.link?.href;
		if (typeof href === "string" && href.startsWith("?")) {
			const url = new URL(window.location.href);
			const incoming = new URLSearchParams(href.slice(1));
			for (const [k, v] of incoming) url.searchParams.set(k, v);
			window.history.pushState(window.history.state, "", url.toString());
			window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
			PaneState.request({ paneType: "component", tag: "shu-affordances-panel", label: "Affordances" });
			console.log(`[chain] routeNodeClick: deep-linked ${href}`);
			return;
		}
		// Every node in the chain projection carries `link.href` (deep-link to the
		// affordances panel) or is a fact-instance handled above. A node reaching this
		// point has neither — surface it so the projection bug is visible.
		console.log("[chain] routeNodeClick: node has no link.href to open; check the projection emitted a deep-link", node);
	}
}

const STYLES = `
	:host { display: flex; flex-direction: column; height: 100%; font-family: inherit; }
	.header { display: flex; justify-content: space-between; align-items: baseline; padding: 8px 12px 4px; flex-shrink: 0; }
	.header h3 { margin: 0; font-size: 13px; color: #444; }
	.explanation { padding: 0 12px; flex-shrink: 0; }
	.explanation summary { cursor: pointer; font-size: 12px; color: #555; padding: 4px 0; }
	.explanation p { margin: 4px 0; font-size: 12px; color: #333; }
	.empty { color: #555; font-size: 12px; padding: 12px; margin: 12px; background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 4px; }
	.empty code { background: #eee; padding: 1px 4px; border-radius: 2px; font-size: 11px; }
	.error { color: #a02828; font-size: 12px; padding: 8px 12px; margin: 8px 12px; background: #fdecec; border: 1px solid #f5c6c6; border-radius: 3px; }
	/* View controls (zoom + layout + axis filter) toggle together as one group via
	   the column-pane's gear (which mirrors its state onto data-show-controls on us). */
	.view-controls { display: flex; gap: 4px; align-items: center; padding: 4px 8px; border-bottom: 1px solid #ddd; background: #fff; flex-shrink: 0; flex-wrap: wrap; }
	.view-controls button { padding: 2px 8px; cursor: pointer; }
	.view-controls shu-graph-filter { flex: 1; min-width: 0; }
	:host(:not([data-show-controls])) .view-controls { display: none; }
	.zoom-label { color: #666; font-size: 12px; min-width: 38px; text-align: center; }
	shu-graph { flex: 1; min-height: 0; overflow: hidden; }
`;
