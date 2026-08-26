/**
 * <shu-step-detail> — Shows details for a specific step execution identified by seqPath.
 *
 * Displays: step text, stepper/action, duration, dispatch trace, products, and variables set by this step (quads whose
 * provenance includes this seqPath). Entity references are clickable. The trace/quads load is a @lit/trequest keyed on the
 * seqPath, so switching steps cancels the stale load and renders only the latest — no hand-rolled loading flag, no
 * out-of-order overwrite. The step's own events (its start, its end, the trace of its dispatch) come from one request by its
 * seqPath, served from the run's buffer or its log; a still-running step's end arrives on the live stream.
 */
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { html, css, type TemplateResult } from "lit";
import { Task, TaskStatus } from "@lit/task";
import { z } from "zod";
import { eventMarkerStyle } from "../event-marker.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { RPC_METHOD } from "../consts.js";
import { subscribeBatchedEvents } from "../event-stream.js";
import { shuBaseStyles } from "./styles.js";
import { conduit } from "../hypermedia.js";
import { SHU_EVENT } from "../consts.js";
import { getRels } from "../rels-cache.js";
import { appAccessLevel } from "../util.js";
import { parseSeqPath } from "@haibun/core/lib/seq-path.js";
import { PaneState } from "../pane-state.js";

const StateSchema = z.object({
	seqPath: z.array(z.number()).default([]),
	stepEvent: z.record(z.string(), z.unknown()).optional(),
});

type TVar = { name: string; value: unknown; graph: string };
type TStepData = { trace?: Record<string, unknown>; variablesSet: TVar[] };
type TEvent = Record<string, unknown>;

/** Whether an event is one step's own: its lifecycle events carry the seqPath as their id, its dispatch trace is named for it. */
export const ofStep = (e: TEvent, seqKey: string): boolean => e.id === `dispatch.${seqKey}` || parseSeqPath(String(e.id ?? ""))?.join(".") === seqKey;

/** The step's event to show, from its own events: its completed end, else any end, else its start. */
export function stepEventOf(events: readonly TEvent[]): TEvent | undefined {
	const ends = events.filter((e) => e.kind === "lifecycle" && e.stage === "end");
	return ends.find((e) => e.status === "completed") ?? ends[0] ?? events.find((e) => e.kind === "lifecycle" && e.stage === "start");
}

/** The trace of the step's dispatch, from its own events. */
export const traceOf = (events: readonly TEvent[]): Record<string, unknown> | undefined =>
	events.find((e) => e.kind === "artifact" && e.artifactType === "dispatch-trace")?.trace as Record<string, unknown> | undefined;

export class ShuStepDetail extends ShuElement<typeof StateSchema> {
	/** A single step execution as a prov:Activity: the step event, its dispatch trace, and the variables it set. */
	summarizeForKihan(): TLinkedData | null {
		const { seqPath, stepEvent } = this.state;
		if (!stepEvent) return null;
		const data = this.#load.value;
		return {
			"@id": `view:step-${seqPath.join(".")}`,
			"@type": "prov:Activity",
			name: "a step execution detail",
			step: stepEvent,
			...(data?.trace ? { dispatch: data.trace } : {}),
			...(data?.variablesSet.length ? { variablesSet: data.variablesSet } : {}),
		};
	}

	#own: TEvent[] = []; // the step's own events, as requested and as they arrive live
	#unsubscribeLive?: () => void;
	static styles = [
		shuBaseStyles,
		css`
			:host { display: block; overflow: auto; font-size: var(--shu-font-md); }
			.step-detail { padding: var(--shu-space-4); }
			.step-detail h4 { margin: 0 0 var(--shu-space-4); font-size: var(--shu-font-lg); }
			.step-detail .field { margin-bottom: var(--shu-space-3); }
			.step-detail .label { font-weight: 600; color: var(--shu-fg-muted); }
			.step-detail .value { margin-left: var(--shu-space-2); }
			.step-detail pre { background: var(--shu-bg-elevated); padding: var(--shu-space-3); border-radius: var(--shu-radius); font-size: var(--shu-font-md); white-space: pre-wrap; word-break: break-all; margin: var(--shu-space-2) 0; }
			.step-detail .entity-link { color: var(--shu-accent); cursor: pointer; text-decoration: underline; }
			.step-detail .section { border-top: var(--shu-border-w) solid var(--shu-border); padding-top: var(--shu-space-3); margin-top: var(--shu-space-4); }
			.step-detail .var-row { display: flex; gap: var(--shu-space-4); padding: var(--shu-space-1) 0; }
			.step-detail .var-name { font-weight: 600; min-width: 120px; }
			.step-detail .var-value { word-break: break-all; }
			.empty { padding: var(--shu-space-6); color: var(--shu-fg-faded); }
		`,
	];

	constructor() {
		super(StateSchema, { seqPath: [] });
	}

	/** Load this step's own events (its start and end, and the trace of its dispatch, one request by its seqPath) and the quads
	 *  it set, keyed on the seqPath. The quad query is a fuller per-step provenance fetch (perTypeLimit 1000) — NOT the
	 *  budgeted display snapshot the graph views share via quads-snapshot, which would drop the very quads whose provenance
	 *  names this step. */
	#load = new Task(this, {
		args: () => [this.state.seqPath.join(".")] as const,
		task: async ([seqKey]): Promise<TStepData> => {
			if (!seqKey) return { variablesSet: [] };
			const { own, quadsData } = await conduit().group("step-detail: load one step's events + quads", async (g) => {
				const own = await g.follow<{ events?: TEvent[] }>({ method: RPC_METHOD.GET_EVENTS, params: { filter: { seqPath: seqKey, limit: 8 } } }, "step-detail: the step's own events");
				const quadsData = await g.follow<{
					quads: Array<{ subject: string; predicate: string; object: unknown; namedGraph: string; timestamp: number; properties?: Record<string, unknown> }>;
				}>({ method: "MonitorStepper-getClusteredQuads", params: { perTypeLimit: 1000, accessLevel: appAccessLevel() } }, "step-detail: clustered quads");
				return { own, quadsData };
			});
			this.#own = own.events ?? [];
			const trace = traceOf(this.#own);
			const variablesSet: TVar[] = (quadsData.quads ?? [])
				.filter((q) => {
					const prov = q.properties?.provenance;
					return Array.isArray(prov) && prov.some((p: unknown) => Array.isArray(p) && (p as number[]).join(".") === seqKey);
				})
				.map((q) => ({ name: q.subject, value: q.object, graph: q.namedGraph }));
			return { trace: trace ?? undefined, variablesSet };
		},
		onComplete: () => this.refreshStepEvent(),
	});

	/** Called by the pane afterAttach hook with the step's seqPath; setting the state re-keys the load task. Awaits the
	 *  settle so the caller's attach sequence still completes after the data lands (an error surfaces in render). */
	async open(seqPath: number[]): Promise<void> {
		this.setState({ seqPath, stepEvent: undefined });
		await this.updateComplete;
		await this.#load.taskComplete.catch(() => undefined);
	}

	protected override onConnected(): void {
		// A still-running step's end, or its trace, arrives after the load: the step's own events are taken from the live
		// stream as they come (no RPC), so the pane does not go stale. In snapshot mode nothing is live.
		if (this.hasAttribute("data-snapshot-time")) return;
		this.#unsubscribeLive = subscribeBatchedEvents({
			onBatch: (events) => {
				const seqKey = this.state.seqPath.join(".");
				if (!seqKey) return;
				const mine = events.filter((e) => ofStep(e as TEvent, seqKey));
				if (mine.length === 0) return;
				this.#own = [...this.#own, ...(mine as TEvent[])];
				if (this.#load.status === TaskStatus.COMPLETE) this.refreshStepEvent();
			},
		});
		this.autoTeardown(() => this.#unsubscribeLive?.());
	}

	private refreshStepEvent(): void {
		const stepEvent = stepEventOf(this.#own);
		if (stepEvent) this.setState({ stepEvent });
		this.requestUpdate(); // a trace that arrived live shows without a new load
	}

	private onLink = (subject: string, label: string, isVertex: boolean) => (): void => {
		if (!subject || !label) return;
		if (isVertex) {
			this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_OPEN, { detail: { subject, label }, bubbles: true, composed: true }));
			return;
		}
		const head = subject.includes("#") ? subject.slice(0, subject.indexOf("#")) : subject;
		const seqPath = parseSeqPath(head);
		if (seqPath) PaneState.request({ paneType: "step-detail", seqPath });
	};

	render(): TemplateResult {
		const key = this.state.seqPath.join(".");
		if (!key) return html`<div class="empty"><shu-spinner></shu-spinner> Loading step…</div>`;
		return this.#load.render({
			initial: () => html`<div class="empty"><shu-spinner></shu-spinner> Loading step [${key}]...</div>`,
			pending: () => html`<div class="empty"><shu-spinner></shu-spinner> Loading step [${key}]...</div>`,
			error: (e) => html`<div class="empty" style="color:var(--shu-error)">Failed to load step [${key}]: ${errorDetail(e)}</div>`,
			complete: (data) => this.renderContent(key, data),
		});
	}

	private renderContent(key: string, data: TStepData): TemplateResult {
		const { stepEvent } = this.state;
		const { variablesSet } = data;
		const trace = traceOf(this.#own) ?? data.trace;
		// The same glyph the log and the rail use, so a speculative try or a handed-out call is not shown as a fault.
		const status = stepEvent?.status ? eventMarkerStyle({ ...stepEvent, kind: "lifecycle", type: "step" }).icon : "";
		const stepIn = String(stepEvent?.in ?? "");
		const actionName = String(stepEvent?.actionName ?? "");
		const stepperName = String(stepEvent?.stepperName ?? "");
		const transport = String(trace?.transport ?? "local");
		const duration = trace?.durationMs ? `${trace.durationMs}ms` : "";
		const products = Array.isArray(trace?.productKeys) ? (trace.productKeys as string[]).join(", ") : "";
		const capability = trace?.capabilityRequired ? `cap: ${trace.capabilityRequired}` : "";

		const hasContent = stepEvent || trace || variablesSet.length > 0;
		if (!hasContent) return html`<div class="empty">No data found for step [${key}]</div>`;

		return html`<div class="step-detail">
			<h4>Step [${key}]</h4>
			${
				stepEvent
					? html`
				<div class="field"><span class="label">Step:</span> <span class="value">${stepIn}</span></div>
				<div class="field"><span class="label">Action:</span> <span class="value">${status} ${stepperName}.${actionName}</span></div>
				${stepEvent.error ? html`<div class="field"><span class="label">Error:</span> <span class="value" style="color:var(--shu-error)">${String(stepEvent.error)}</span></div>` : ""}
			`
					: ""
			}
			${
				trace
					? html`
				<div class="section"><span class="label">Transport:</span> <span class="value">${transport} ${duration}</span></div>
				${capability ? html`<div class="field"><span class="label">Capability:</span> <span class="value">${capability}</span></div>` : ""}
				${products ? html`<div class="field"><span class="label">Products:</span> <span class="value">${products}</span></div>` : ""}
			`
					: ""
			}
			${
				variablesSet.length > 0
					? html`
				<div class="section"><span class="label">Data set (${variablesSet.length}):</span>
					${variablesSet.map((v) => {
						const isVertex = !!getRels(v.graph);
						return html`<div class="var-row"><span style="color:var(--shu-fg-faded);font-size:var(--shu-font-sm)">${v.graph}</span> <span class="entity-link" @click=${this.onLink(v.name, v.graph, isVertex)}>${v.name}</span></div>`;
					})}
				</div>
			`
					: ""
			}
			${stepEvent ? html`<details class="section"><summary class="label">Raw event</summary><pre>${JSON.stringify(stepEvent, null, 2)}</pre></details>` : ""}
		</div>`;
	}
}
