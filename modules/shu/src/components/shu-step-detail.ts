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
import { shuBaseStyles } from "./styles.js";
import { conduit } from "../hypermedia.js";
import { SHU_EVENT } from "../consts.js";
import { getRels } from "../rels-cache.js";
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
});

export class ShuStepDetail extends ShuElement<typeof StateSchema> {
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
		this.setState({ seqPath, loading: true });
		const seqKey = seqPath.join(".");
		try {
			const { eventsData, tracesData, quadsData } = await conduit().group("step-detail: load events + traces + quads for one step", async (g) => {
				const eventsData = await g.follow<{ events: Array<Record<string, unknown>> }>(
					{ method: "MonitorStepper-getEvents", params: { filter: { kind: "lifecycle" } } },
					"step-detail: events",
				);
				const tracesData = await g.follow<{ traces: Array<Record<string, unknown>> }>({ method: "MonitorStepper-getDispatchTraces" }, "step-detail: dispatch traces");
				const quadsData = await g.follow<{
					quads: Array<{ subject: string; predicate: string; object: unknown; namedGraph: string; timestamp: number; properties?: Record<string, unknown> }>;
				}>({ method: "MonitorStepper-getClusteredQuads", params: { perTypeLimit: 1000 } }, "step-detail: clustered quads");
				return { eventsData, tracesData, quadsData };
			});
			const stepEvent =
				eventsData.events?.find((e) => e.stage === "end" && e.status === "completed" && Array.isArray(e.seqPath) && (e.seqPath as number[]).join(".") === seqKey) ??
				eventsData.events?.find((e) => e.stage === "end" && Array.isArray(e.seqPath) && (e.seqPath as number[]).join(".") === seqKey);
			const trace = tracesData.traces?.find((t) => Array.isArray(t.seqPath) && (t.seqPath as number[]).join(".") === seqKey);
			const variablesSet = (quadsData.quads ?? [])
				.filter((q) => {
					const prov = q.properties?.provenance;
					if (!Array.isArray(prov)) return false;
					return prov.some((p: unknown) => Array.isArray(p) && (p as number[]).join(".") === seqKey);
				})
				.map((q) => ({ name: q.subject, value: q.object, graph: q.namedGraph }));
			this.setState({ stepEvent: stepEvent ?? undefined, trace: trace ?? undefined, variablesSet, allQuads: quadsData.quads ?? [], loading: false });
		} catch {
			this.setState({ loading: false });
		}
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
		const { seqPath, stepEvent, trace, variablesSet, loading } = this.state;
		const key = seqPath.join(".");
		if (loading) return html`<div class="empty"><shu-spinner></shu-spinner> Loading step [${key}]...</div>`;

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
