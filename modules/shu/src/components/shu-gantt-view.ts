/**
 * <shu-gantt-view> — a calendar/Gantt paint of the quad store: task-like nodes (those carrying a `ganttStart`-kind
 * property) drawn as bars on a linear time axis, with effort as an inner bar and `dependsOn` as arrows between bars.
 *
 * It is a paint of the SAME engine as the graph and sequence views: it subclasses ShuClusteredGraphView for the one
 * data pathway (RPC snapshot + live SSE merge + time-cursor filtering), then projects the time-visible quads through
 * `quadsToGanttModel` and paints `ganttToSvg`. A node's gantt fields are recognised by their declared upper concept
 * (rdfs:subPropertyOf walk), so any vocabulary sitting under the gantt concepts is picked up — not a fixed predicate list.
 */
import { html, css, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { z } from "zod";
import { ShuClusteredGraphView, clusteredGraphStateShape } from "./shu-clustered-graph-view.js";
import { shuBaseStyles } from "./styles.js";
import { copyText } from "../copy-util.js";
import { getRelSync, getEdgeRelMap } from "../rels-cache.js";
import { edgeRel as coreEdgeRel } from "@haibun/core/lib/resources.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { quadsToGanttModel } from "../graph/gantt-model.js";
import { ganttToSvg, ganttToText } from "../graph/gantt-renderer.js";

/** Resolve a stored predicate to its link relation the way the browser graph view does, so real (IRI/short) predicates
 *  map onto the canonical gantt rels before the upper-concept walk. Falls back to the predicate itself (canonical rels). */
const relOf = (predicate: string, graph: string): string => getRelSync(graph, predicate) ?? getEdgeRelMap()[predicate] ?? coreEdgeRel(predicate) ?? predicate;

const StateSchema = z.object({ ...clusteredGraphStateShape, zoom: z.number().default(100), dataSource: z.enum(["rpc", "external"]).default("rpc") });

const ZOOM_STEP = 25; // percent per zoom click — matches the graph view

export class ShuGanttView extends ShuClusteredGraphView<typeof StateSchema> {
	static styles = [
		shuBaseStyles,
		css`
		:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
		:host(:not([data-show-controls])) .toolbar { display: none; }
		.toolbar { display: flex; gap: var(--shu-space-2); align-items: center; padding: var(--shu-space-2) var(--shu-space-4); border-bottom: var(--shu-border-w) solid var(--shu-border); flex-shrink: 0; background: var(--shu-bg); }
		.toolbar button { padding: var(--shu-space-1) var(--shu-space-4); cursor: pointer; border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); background: var(--shu-bg); }
		.toolbar button:hover { background: var(--shu-bg-hover); }
		.zoom-label { color: var(--shu-fg-muted); }
		.task-count { color: var(--shu-fg-faded); margin-left: auto; }
		.gantt-scroll { flex: 1; overflow: auto; }
		.diagram-container { padding: var(--shu-space-4); transform-origin: top left; }
		.diagram-container g.gantt-task text { fill: var(--shu-fg); }
		.empty { padding: var(--shu-space-6); color: var(--shu-fg-faded); text-align: center; }
	`,
	];

	constructor() {
		super(StateSchema, {});
	}

	static observedHtmlAttributes = ["data-source"];

	protected override onAttributeChanged(name: string, _old: string | null, val: string | null): void {
		if (name === "data-source" && (val === "rpc" || val === "external")) this.state = { ...this.state, dataSource: val };
	}

	protected override get usesExternalData(): boolean {
		return this.state.dataSource === "external";
	}

	/** Provide quads externally (inline/affordance mount) — sets dataSource to external, skipping the RPC snapshot. */
	setQuads(quads: TQuad[]): void {
		this.setState({ quads, dataSource: "external" });
	}

	private buildModel() {
		const labelsByType = new Map<string, Record<string, string>>();
		for (const c of this.cgState.clusters) labelsByType.set(c.type, c.displayLabels);
		return quadsToGanttModel(this.visibleQuads, { relOf, displayLabel: (graph, subject) => labelsByType.get(graph)?.[subject] });
	}

	private onZoomIn = (): void => this.setState({ zoom: Math.min(200, this.state.zoom + ZOOM_STEP) });
	private onZoomOut = (): void => this.setState({ zoom: Math.max(25, this.state.zoom - ZOOM_STEP) });
	private onCopy = async (e: Event): Promise<void> => {
		const ok = await copyText(ganttToText(this.buildModel()));
		const btn = e.currentTarget as HTMLElement | null;
		if (!btn) return;
		btn.textContent = ok ? "Copied" : "Copy failed";
		setTimeout(() => {
			btn.textContent = "Copy";
		}, 1500);
	};

	render(): TemplateResult {
		const model = this.buildModel();
		if (model.tasks.length === 0) return html`<div class="empty">No scheduled tasks yet.</div>`;
		const { zoom } = this.state;
		return html`
			<div class="toolbar" data-testid="shu-gantt-toolbar">
				<button data-action="zoom-out" @click=${this.onZoomOut}>−</button>
				<span class="zoom-label">${zoom}%</span>
				<button data-action="zoom-in" @click=${this.onZoomIn}>+</button>
				<button data-action="copy" @click=${this.onCopy}>Copy</button>
				<span class="task-count">${model.tasks.length} tasks</span>
			</div>
			<div class="gantt-scroll">
				<div class="diagram-container" style=${`transform: scale(${zoom / 100});`}>${unsafeHTML(ganttToSvg(model))}</div>
			</div>
		`;
	}
}

// Registered via component-registry.ts
