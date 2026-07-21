/**
 * <shu-step-detail> — Shows details for a specific step execution identified by seqPath.
 *
 * Displays: step text, stepper/action, duration, dispatch trace, products,
 * and variables set by this step (quads whose provenance includes this seqPath).
 * Entity references are clickable.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { EventsController } from "../controllers/index.js";
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
	trace: z.record(z.string(), z.unknown()).optional(),
	variablesSet: z.array(z.object({ name: z.string(), value: z.unknown(), graph: z.string() })).default([]),
	allQuads: z
		.array(
			z.object({
				subject: z.string(),
				predicate: z.string(),
				object: z.unknown(),
				namedGraph: z.string(),
				timestamp: z.number(),
				properties: z.record(z.string(), z.unknown()).optional(),
			}),
		)
		.default([]),
	loading: z.boolean().default(true),
	error: z.string().optional(),
});

export class ShuStepDetail extends ShuElement<typeof StateSchema> {
	/** Presents data but does not yet summarize it for the Kihan — replace this null with the view's linked data. */
	summarizeForKihan(): unknown | null {
		return null;
	}

	#events = new EventsController(this, () => this.onEventsChanged());
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
		super(StateSchema, { seqPath: [], loading: true, variablesSet: [], allQuads: [] });
	}

	async open(seqPath: number[]): Promise<void> {
		this.setState({ seqPath, loading: true, error: undefined });
		const seqKey = seqPath.join(".");
		try {
			// Traces + this step's provenance quads, alongside the shared event backfill. The quad query is intentionally a
			// fuller per-step provenance fetch (perTypeLimit 1000) — NOT the budgeted display snapshot the graph views share
			// via quads-snapshot, which would drop the very quads whose provenance names this step. Events come from the
			// shared log (ShuEventConsumer), so there is no second getEvents backfill here.
			const [{ tracesData, quadsData }] = await Promise.all([
				conduit().group("step-detail: load traces + quads for one step", async (g) => {
					const tracesData = await g.follow<{ traces: Array<Record<string, unknown>> }>({ method: "MonitorStepper-getDispatchTraces" }, "step-detail: dispatch traces");
					const quadsData = await g.follow<{
						quads: Array<{ subject: string; predicate: string; object: unknown; namedGraph: string; timestamp: number; properties?: Record<string, unknown> }>;
					}>({ method: "MonitorStepper-getClusteredQuads", params: { perTypeLimit: 1000, accessLevel: appAccessLevel() } }, "step-detail: clustered quads");
					return { tracesData, quadsData };
				}),
				this.#events.ensureLoaded(),
			]);
			const trace = tracesData.traces?.find((t) => Array.isArray(t.seqPath) && (t.seqPath as number[]).join(".") === seqKey);
			const variablesSet = (quadsData.quads ?? [])
				.filter((q) => {
					const prov = q.properties?.provenance;
					if (!Array.isArray(prov)) return false;
					return prov.some((p: unknown) => Array.isArray(p) && (p as number[]).join(".") === seqKey);
				})
				.map((q) => ({ name: q.subject, value: q.object, graph: q.namedGraph }));
			this.setState({ trace: trace ?? undefined, variablesSet, allQuads: quadsData.quads ?? [], loading: false, error: undefined });
			this.refreshStepEvent();
		} catch (e) {
			// Surface the failure — a swallowed error rendered the same generic "no data" as a genuinely empty step.
			this.setState({ loading: false, error: e instanceof Error ? e.message : String(e) });
		}
	}

	/** The step's lifecycle event lives in the shared log; a still-running step's `end` arrives after open(). Re-find it
	 *  cheaply on each live batch (no RPC) so the pane stops going stale. */
	private onEventsChanged(): void {
		if (this.state.seqPath.length > 0 && !this.state.loading) this.refreshStepEvent();
	}

	private refreshStepEvent(): void {
		const seqKey = this.state.seqPath.join(".");
		const matches = (e: Record<string, unknown>) => Array.isArray(e.seqPath) && (e.seqPath as number[]).join(".") === seqKey;
		const events = this.#events.all;
		const stepEvent =
			events.find((e) => e.kind === "lifecycle" && e.stage === "end" && e.status === "completed" && matches(e)) ??
			events.find((e) => e.kind === "lifecycle" && e.stage === "end" && matches(e)) ??
			events.find((e) => e.kind === "lifecycle" && e.stage === "start" && matches(e));
		if (stepEvent) this.setState({ stepEvent });
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
		const { seqPath, stepEvent, trace, variablesSet, loading, error } = this.state;
		const key = seqPath.join(".");
		if (loading) return html`<div class="empty"><shu-spinner></shu-spinner> Loading step [${key}]...</div>`;
		if (error) return html`<div class="empty" style="color:var(--shu-error)">Failed to load step [${key}]: ${error}</div>`;

		const status = stepEvent?.status === "completed" ? "✅" : stepEvent?.status === "failed" ? "❌" : "";
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
