/**
 * <shu-sequence-diagram> — Renders dispatch traces as a mermaid sequence diagram.
 *
 * Shows step dispatch routing: local vs remote vs subprocess, with capability
 * checks and timing. Reusable in both shu SPA and monitor-browser.
 *
 * Usage: element.setTraces(traces) or set the "traces" attribute as JSON.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { conduit } from "../hypermedia.js";
import { requireStep } from "../rpc-registry.js";
import { TIME_SYNC_STYLE } from "../time-sync.js";


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

export class ShuSequenceDiagram extends ShuElement<typeof StateSchema> {
	static styles = [shuBaseStyles, css`
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
	`];

	private diagramId = `shu-seq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	constructor() {
		super(StateSchema, { traces: [], zoom: 100, currentIndex: -1 });
	}

	protected override async onConnected(): Promise<void> {
		try {
			const data = await conduit().follow<{ traces: TDispatchTrace[] }>({ method: "MonitorStepper-getDispatchTraces" }, "sequence-diagram: backfill dispatch traces");
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

		if (this.hasAttribute("data-snapshot-time")) return;

		// Live updates via SSE — capture each batch's dispatch-trace artifacts and
		// run a single setState. Per-event setState would re-render the diagram
		// once per trace; a replay-window burst would re-render N times.
		this.autoTeardown(
			this.subscribeBatched({
				onBatch: (events) => {
					const additions: TDispatchTrace[] = [];
					for (const event of events) {
						const e = event as { kind?: string; artifactType?: string; trace?: TDispatchTrace; timestamp?: number };
						if (e.kind !== "artifact" || e.artifactType !== "dispatch-trace" || !e.trace) continue;
						const parsed = DispatchTrace.safeParse({ ...e.trace, timestamp: e.timestamp ?? Date.now() });
						if (parsed.success) additions.push(parsed.data);
					}
					if (additions.length > 0) this.setState({ traces: [...this.state.traces, ...additions] });
				},
			}),
		);
	}

	protected override onTimeSync(): void {
		this.applyTimeDimming();
	}

	setTraces(traces: TDispatchTrace[]): void {
		this.setState({ traces });
	}

	private onZoomIn = (): void => {
		this.setState({ zoom: Math.min(200, this.state.zoom + 10) });
	};
	private onZoomOut = (): void => {
		this.setState({ zoom: Math.max(10, this.state.zoom - 10) });
	};
	private onCopy = (): void => {
		navigator.clipboard.writeText(buildMermaidSource(this.state.traces));
	};

	protected updated(): void {
		void this.renderMermaid(this.state.traces);
	}

	render(): TemplateResult {
		const { traces, zoom } = this.state;
		if (traces.length === 0) return html`<div class="empty">No dispatch traces yet.</div>`;
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

	private async renderMermaid(traces: TDispatchTrace[]): Promise<void> {
		const source = buildMermaidSource(traces);
		try {
			const { svg } = await conduit().follow<{ svg: string }>({ method: requireStep("renderMermaid"), params: { source } }, "sequence-diagram: render mermaid");
			const container = this.shadowRoot?.querySelector(".diagram-container");
			if (container) container.innerHTML = `<div>${svg}</div>`;
			this.applyTimeDimming();
		} catch (err) {
			const container = this.shadowRoot?.querySelector(".diagram-container");
			if (container) container.innerHTML = `<pre style="color:var(--shu-error)">${err instanceof Error ? err.message : err}</pre>`;
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
