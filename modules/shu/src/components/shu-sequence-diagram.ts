/**
 * <shu-sequence-diagram> — Renders step dispatch traces as an SVG sequence diagram.
 *
 * Shows step dispatch routing: local vs remote vs subprocess, with capability
 * checks and timing, as actor lifelines and ordered call/return messages.
 *
 * Usage: element.setTraces(traces) or set the "traces" attribute as JSON.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { EventsController } from "../controllers/index.js";
import { emptyOrLoading } from "./empty-state.js";
import { shuBaseStyles } from "./styles.js";
import { copyText } from "../copy-util.js";
import { TIME_SYNC_STYLE } from "../time-sync.js";
import { sequenceToSvg, sequenceToText, type TSeqModel, type TSeqMessage } from "../graph/sequence-renderer.js";

import { DispatchTraceSchema, type TDispatchTrace } from "../schemas.js";
const DispatchTrace = DispatchTraceSchema;

const FEATURE = "Feature";

/** Map dispatch traces to the renderer-agnostic sequence model, plus a per-message timestamp parallel array (for time-dimming). */
export function tracesToModel(traces: TDispatchTrace[]): { model: TSeqModel; timestamps: number[] } {
	const actors: TSeqModel["actors"] = [{ id: FEATURE, label: FEATURE }];
	const seen = new Set([FEATURE]);
	const messages: TSeqMessage[] = [];
	const timestamps: number[] = [];
	const push = (m: TSeqMessage, ts: number): void => {
		messages.push(m);
		timestamps.push(ts);
	};
	for (const t of traces) {
		const target = t.transport === "remote" && t.remoteHost ? t.remoteHost : t.transport === "subprocess" ? "Subprocess" : "Local";
		if (!seen.has(target)) {
			seen.add(target);
			actors.push({ id: target, label: target });
		}
		const ms = t.durationMs !== undefined ? ` (${t.durationMs}ms)` : "";
		const ts = t.timestamp ?? 0;
		if (t.capabilityRequired && !t.authorized) {
			push({ from: FEATURE, to: target, label: `${t.stepName}${ms}`, kind: "denied", note: `denied: ${t.capabilityRequired}` }, ts);
			continue;
		}
		const note = t.capabilityRequired ? `${t.capabilityRequired} ✓ ${(t.capabilityGranted ?? ["none"]).join(", ")}` : undefined;
		push({ from: FEATURE, to: target, label: `${t.stepName}${ms}`, kind: "call", note }, ts);
		const products = t.productKeys?.length ? ` {${t.productKeys.join(", ")}}` : "";
		push({ from: target, to: FEATURE, label: `ok${products}`, kind: "return" }, ts);
	}
	return { model: { actors, messages }, timestamps };
}

const StateSchema = z.object({
	traces: z.array(DispatchTrace).default([]),
	zoom: z.number().default(100),
	currentIndex: z.number().default(-1),
});

export class ShuSequenceDiagram extends ShuElement<typeof StateSchema> {
	/** The step-dispatch sequence as an ordered collection of call/return/denied messages between participants. */
	summarizeForKihan(): unknown | null {
		if (this.state.traces.length === 0) return null;
		const { model } = tracesToModel(this.state.traces);
		return { "@id": "view:sequence", "@type": "as:OrderedCollection", name: `a step-dispatch sequence across ${model.actors.length} participants`, participants: model.actors.map((a) => a.label), totalItems: model.messages.length,
			items: model.messages.map((m) => ({ from: m.from, to: m.to, label: m.label, kind: m.kind, ...(m.note ? { note: m.note } : {}) })) };
	}

	#events = new EventsController(this, () => this.onEventsChanged());
	static styles = [
		shuBaseStyles,
		css`
		:host { display: block; font-family: ui-sans-serif, system-ui, sans-serif; }
		:host(:not([data-show-controls])) .toolbar { display: none; }
		.toolbar {
			display: flex; gap: var(--shu-space-4); align-items: center;
			padding: var(--shu-space-2) var(--shu-space-4); background: var(--shu-bg-soft);
			border-bottom: var(--shu-border-w) solid var(--shu-border); font-size: var(--shu-font-md);
		}
		.toolbar button {
			padding: var(--shu-space-1) var(--shu-space-4); cursor: pointer;
			border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); background: var(--shu-bg);
		}
		.toolbar button:hover { background: var(--shu-bg-hover); }
		.diagram-container { overflow: auto; padding: var(--shu-space-4); }
		.zoom-label { color: var(--shu-fg-muted); }
		.trace-count { color: var(--shu-fg-faded); margin-left: auto; }
		.empty { padding: var(--shu-space-6); color: var(--shu-fg-faded); text-align: center; }
	`,
	];

	private diagramId = `shu-seq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	/** Timestamp of the trace each painted message came from, indexed by the message's `data-index`. Drives time-dimming. */
	private lastTimestamps: number[] = [];
	constructor() {
		super(StateSchema, { traces: [], zoom: 100, currentIndex: -1 });
	}

	/** Dispatch traces are derived from the shared event log (ShuEventConsumer backfills, lives, and DEDUPS it): the
	 *  dispatch-trace artifact events, parsed. Deriving from the deduped log fixes the double-count that a backfill plus an
	 *  SSE replay-window overlap used to produce — the old concat had no dedup key. */
	private onEventsChanged(): void {
		const traces: TDispatchTrace[] = [];
		for (const event of this.#events.all) {
			const e = event as { kind?: string; artifactType?: string; trace?: TDispatchTrace; timestamp?: number };
			if (e.kind !== "artifact" || e.artifactType !== "dispatch-trace" || !e.trace) continue;
			const parsed = DispatchTrace.safeParse({ ...e.trace, timestamp: e.timestamp ?? 0 });
			if (parsed.success) traces.push(parsed.data);
		}
		this.setState({ traces });
	}

	protected override onTimeSync(): void {
		this.applyTimeDimming();
	}

	private onZoomIn = (): void => {
		this.setState({ zoom: Math.min(200, this.state.zoom + 10) });
	};
	private onZoomOut = (): void => {
		this.setState({ zoom: Math.max(10, this.state.zoom - 10) });
	};
	private onCopy = async (e: Event): Promise<void> => {
		// copyText falls back to execCommand when the async Clipboard API is blocked (e.g. a file:// report).
		const ok = await copyText(sequenceToText(tracesToModel(this.state.traces).model));
		const btn = e.currentTarget as HTMLElement | null;
		if (!btn) return;
		btn.textContent = ok ? "Copied" : "Copy failed";
		setTimeout(() => {
			btn.textContent = "Copy";
		}, 1500);
	};

	protected updated(): void {
		const host = this.shadowRoot?.getElementById(this.diagramId);
		if (!host) return; // empty state renders no diagram leaf
		const { model, timestamps } = tracesToModel(this.state.traces);
		this.lastTimestamps = timestamps;
		host.innerHTML = sequenceToSvg(model);
		this.applyTimeDimming();
	}

	render(): TemplateResult {
		const { traces, zoom } = this.state;
		if (traces.length === 0) return emptyOrLoading(this.#events.loaded, "No dispatch traces yet.");
		return html`
			<div class="toolbar" data-testid="monitor-sequence-diagram">
				<button data-action="zoom-out" @click=${this.onZoomOut}>−</button>
				<span class="zoom-label">${zoom}%</span>
				<button data-action="zoom-in" @click=${this.onZoomIn}>+</button>
				<button data-action="copy" @click=${this.onCopy}>Copy</button>
				<span class="trace-count">${traces.length} steps</span>
			</div>
			<div class="diagram-container" style=${`transform: scale(${zoom / 100}); transform-origin: top left;`}>
				<div id=${this.diagramId}></div>
			</div>
		`;
	}

	private applyTimeDimming(): void {
		const host = this.shadowRoot?.getElementById(this.diagramId);
		if (!host) return;
		const cursor = this.timeCursor;
		const messages = Array.from(host.querySelectorAll<SVGGElement>(".seq-message"));
		if (cursor === null) {
			for (const el of messages) el.style.opacity = "";
			return;
		}
		// Each message carries the timestamp of its producing trace; dim the ones still in the future.
		const dimmed = String(TIME_SYNC_STYLE.DIMMED_OPACITY);
		let lastVisible: SVGGElement | null = null;
		for (const el of messages) {
			const ts = this.lastTimestamps[Number(el.getAttribute("data-index"))] ?? Number.POSITIVE_INFINITY;
			const future = ts > cursor;
			el.style.opacity = future ? dimmed : "";
			if (!future) lastVisible = el;
		}
		lastVisible?.scrollIntoView({ block: "center", behavior: "smooth" });
	}
}

// Registered via component-registry.ts
