/**
 * <shu-sequence-diagram> — Renders dispatch traces as a mermaid sequence diagram.
 *
 * Shows step dispatch routing: local vs remote vs subprocess, with capability
 * checks and timing. Reusable in both shu SPA and monitor-browser.
 *
 * Usage: element.setTraces(traces) or set the "traces" attribute as JSON.
 */
import { z } from "zod";
import mermaid from "mermaid";
import { ShuElement } from "./shu-element.js";
import { SseClient } from "../sse-client.js";
import { TIME_SYNC_STYLE } from "../time-sync.js";

let mermaidInitialized = false;

import { DispatchTraceSchema, type TDispatchTrace } from "../schemas.js";
const DispatchTrace = DispatchTraceSchema;

const StateSchema = z.object({
	traces: z.array(DispatchTrace).default([]),
	zoom: z.number().default(100),
	currentIndex: z.number().default(-1),
});

function escapeLabel(label: string): string {
	return label
		.replace(/"/g, "")
		.replace(/'/g, "")
		.replace(/@/g, " at ")
		.replace(/:/g, "-")
		.replace(/\|/g, "")
		.replace(/\n/g, " ")
		.replace(/[[\]{}()<>]/g, "")
		.replace(/[#;&]/g, "")
		.replace(/\//g, "-")
		.replace(/\*/g, "");
}

function sanitizeId(name: string): string {
	return (
		name
			.replace(/[^a-zA-Z0-9]/g, "_")
			.replace(/^_+|_+$/g, "")
			.substring(0, 30) || "node"
	);
}

function buildMermaidSource(traces: TDispatchTrace[]): string {
	const participants = new Set<string>();
	participants.add("Feature");

	for (const t of traces) {
		if (t.transport === "remote" && t.remoteHost) participants.add(sanitizeId(t.remoteHost));
		else if (t.transport === "subprocess") participants.add("Subprocess");
		else participants.add("Local");
	}

	let src = "sequenceDiagram\n";
	for (const p of participants) src += `  participant ${p}\n`;

	for (const t of traces) {
		const label = escapeLabel(t.stepName);
		const ms = t.durationMs !== undefined ? ` (${t.durationMs}ms)` : "";
		let target: string;
		if (t.transport === "remote" && t.remoteHost) target = sanitizeId(t.remoteHost);
		else if (t.transport === "subprocess") target = "Subprocess";
		else target = "Local";

		if (t.capabilityRequired && !t.authorized) {
			src += `  Feature-x${target}: ${label}${ms}\n`;
			src += `  Note right of ${target}: denied (cap-${escapeLabel(t.capabilityRequired)})\n`;
		} else {
			src += `  Feature->>${target}: ${label}${ms}\n`;
			if (t.capabilityRequired) {
				const granted = t.capabilityGranted?.map(escapeLabel).join(", ") ?? "none";
				src += `  Note right of ${target}: cap-${escapeLabel(t.capabilityRequired)} granted-${granted}\n`;
			}
			const products = t.productKeys?.length ? ` {${t.productKeys.map(escapeLabel).join(", ")}}` : "";
			src += `  ${target}-->>Feature: ok${products}\n`;
		}
	}
	return src;
}

const STYLES = `
:host { display: block; font-family: ui-sans-serif, system-ui, sans-serif; }
:host(:not([data-show-controls])) .toolbar { display: none; }
.toolbar { display: flex; gap: 8px; align-items: center; padding: 4px 8px; background: #f5f5f5; border-bottom: 1px solid #ddd; font-size: 12px; }
.toolbar button { padding: 2px 8px; cursor: pointer; border: 1px solid #ccc; border-radius: 3px; background: #fff; }
.toolbar button:hover { background: #e8e8e8; }
.diagram-container { overflow: auto; padding: 8px; }
.zoom-label { color: #666; }
.trace-count { color: #888; margin-left: auto; }
.empty { padding: 16px; color: #888; text-align: center; }
`;

export class ShuSequenceDiagram extends ShuElement<typeof StateSchema> {
	private diagramId = `shu-seq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	private unsubscribe?: () => void;

	constructor() {
		super(StateSchema, { traces: [], zoom: 100, currentIndex: -1 });
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		const client = SseClient.for("");

		// One-time backfill from stepper
		try {
			const data = await client.rpc<{ traces: TDispatchTrace[] }>("MonitorStepper-getDispatchTraces");
			if (data.traces?.length) {
				const parsed = data.traces
					.map((t) => DispatchTrace.safeParse(t))
					.filter((r) => r.success)
					.map((r) => r.data);
				if (parsed.length) this.setState({ traces: parsed });
			}
		} catch {
			/* stepper may not be loaded */
		}

		// Live updates via SSE — capture event timestamp onto the trace
		this.unsubscribe = client.onEvent((event) => {
			const e = event as { kind?: string; artifactType?: string; trace?: TDispatchTrace; timestamp?: number };
			if (e.kind === "artifact" && e.artifactType === "dispatch-trace" && e.trace) {
				const parsed = DispatchTrace.safeParse({ ...e.trace, timestamp: e.timestamp ?? Date.now() });
				if (parsed.success) this.setState({ traces: [...this.state.traces, parsed.data] });
			}
		});
	}

	protected override onTimeSync(): void {
		this.applyTimeDimming();
	}

	disconnectedCallback(): void {
		this.unsubscribe?.();
	}

	setTraces(traces: TDispatchTrace[]): void {
		this.setState({ traces });
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		const { traces, zoom } = this.state;

		if (traces.length === 0) {
			this.shadowRoot.innerHTML = `${this.css(STYLES)}<div class="empty">No dispatch traces yet.</div>`;
			return;
		}

		const toolbar = `<div class="toolbar" data-testid="monitor-sequence-diagram">
			<button data-action="zoom-out">−</button>
			<span class="zoom-label">${zoom}%</span>
			<button data-action="zoom-in">+</button>
			<button data-action="copy">Copy</button>
			<span class="trace-count">${traces.length} steps</span>
		</div>`;
		this.shadowRoot.innerHTML = `${this.css(STYLES)}${toolbar}
			<div class="diagram-container" style="transform: scale(${zoom / 100}); transform-origin: top left;">
				<div id="${this.diagramId}"></div>
			</div>`;

		this.bindToolbar();
		void this.renderMermaid(traces);
	}

	private bindToolbar(): void {
		this.shadowRoot?.querySelectorAll("[data-action]").forEach((btn) => {
			btn.addEventListener("click", () => {
				const action = (btn as HTMLElement).dataset.action;
				if (action === "zoom-in") this.setState({ zoom: Math.min(200, this.state.zoom + 10) });
				else if (action === "zoom-out") this.setState({ zoom: Math.max(10, this.state.zoom - 10) });
				else if (action === "copy") navigator.clipboard.writeText(buildMermaidSource(this.state.traces));
			});
		});
	}

	private async renderMermaid(traces: TDispatchTrace[]): Promise<void> {
		if (!mermaidInitialized) {
			mermaid.initialize({
				startOnLoad: false,
				theme: "default",
				securityLevel: "loose",
				fontFamily: "ui-sans-serif, system-ui, sans-serif",
			});
			mermaidInitialized = true;
		}
		const source = buildMermaidSource(traces);
		try {
			const { svg } = await mermaid.render(this.diagramId, source);
			const container = this.shadowRoot?.querySelector(".diagram-container");
			if (container) container.innerHTML = `<div>${svg}</div>`;
			this.applyTimeDimming();
		} catch (err) {
			const container = this.shadowRoot?.querySelector(".diagram-container");
			if (container) container.innerHTML = `<pre style="color:red">${err instanceof Error ? err.message : err}</pre>`;
		}
	}

	private applyTimeDimming(): void {
		const container = this.shadowRoot?.querySelector(".diagram-container");
		if (!container) return;
		const cursor = this.timeCursor;
		const messages = container.querySelectorAll(".messageText");
		const lines = container.querySelectorAll(".messageLine0, .messageLine1");
		if (cursor === null) {
			messages.forEach((el) => {
				(el as SVGElement).style.opacity = "";
			});
			lines.forEach((el) => {
				(el as SVGElement).style.opacity = "";
			});
			return;
		}
		const traces = this.state.traces;
		const futureIdx = traces.findIndex((t) => (t.timestamp ?? Infinity) > cursor);
		const dimmed = String(TIME_SYNC_STYLE.DIMMED_OPACITY);
		let lastVisibleIdx = -1;
		for (let i = 0; i < messages.length; i++) {
			const isFuture = futureIdx >= 0 && i >= futureIdx;
			(messages[i] as SVGElement).style.opacity = isFuture ? dimmed : "";
			if (!isFuture) lastVisibleIdx = i;
		}
		for (let i = 0; i < lines.length; i++) {
			(lines[i] as SVGElement).style.opacity = futureIdx >= 0 && i >= futureIdx ? dimmed : "";
		}
		// Scroll the current (last visible) trace into view
		if (lastVisibleIdx >= 0 && messages[lastVisibleIdx]) {
			(messages[lastVisibleIdx] as SVGElement).scrollIntoView({ block: "center", behavior: "smooth" });
		}
	}
}

// Registered via component-registry.ts
