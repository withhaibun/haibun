/**
 * <shu-step-detail> — Shows details for a specific step execution identified by seqPath.
 *
 * Displays: step text, stepper/action, duration, dispatch trace, products,
 * and variables set by this step (quads whose provenance includes this seqPath).
 * Entity references are clickable.
 */
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { SseClient } from "../sse-client.js";
import { SHU_EVENT } from "../consts.js";
import { getRels } from "../rels-cache.js";
import { openQuadDetailPane } from "../quad-detail-pane.js";

const StateSchema = z.object({
	seqPath: z.array(z.number()).default([]),
	stepEvent: z.record(z.string(), z.unknown()).optional(),
	trace: z.record(z.string(), z.unknown()).optional(),
	variablesSet: z.array(z.object({ name: z.string(), value: z.unknown(), graph: z.string() })).default([]),
	allQuads: z.array(z.object({ subject: z.string(), predicate: z.string(), object: z.unknown(), namedGraph: z.string(), timestamp: z.number(), properties: z.record(z.string(), z.unknown()).optional() })).default([]),
	loading: z.boolean().default(true),
});

function escHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const STYLES = `
:host { display: block; overflow: auto; font-size: 13px; }
.step-detail { padding: 8px; }
.step-detail h4 { margin: 0 0 8px; font-size: 14px; }
.step-detail .field { margin-bottom: 6px; }
.step-detail .label { font-weight: 600; color: #555; }
.step-detail .value { margin-left: 4px; }
.step-detail pre { background: #f5f5f5; padding: 6px; border-radius: 4px; font-size: 12px; white-space: pre-wrap; word-break: break-all; margin: 4px 0; }
.step-detail .entity-link { color: #1a6b3c; cursor: pointer; text-decoration: underline; }
.step-detail .section { border-top: 1px solid #eee; padding-top: 6px; margin-top: 8px; }
.step-detail .var-row { display: flex; gap: 8px; padding: 2px 0; }
.step-detail .var-name { font-weight: 600; min-width: 120px; }
.step-detail .var-value { word-break: break-all; }
.empty { padding: 16px; color: #888; }
`;

export class ShuStepDetail extends ShuElement<typeof StateSchema> {
	constructor() {
		super(StateSchema, { seqPath: [], loading: true, variablesSet: [], allQuads: [] });
	}

	async open(seqPath: number[]): Promise<void> {
		this.setState({ seqPath, loading: true });
		const client = SseClient.for("");
		const seqKey = seqPath.join(".");

		try {
			// Fetch step lifecycle event
			const eventsData = await client.rpc<{ events: Array<Record<string, unknown>> }>("MonitorStepper-getEvents", { kind: "lifecycle" });
			const stepEvent =
				eventsData.events?.find((e) => e.stage === "end" && e.status === "completed" && Array.isArray(e.seqPath) && (e.seqPath as number[]).join(".") === seqKey) ??
				eventsData.events?.find((e) => e.stage === "end" && Array.isArray(e.seqPath) && (e.seqPath as number[]).join(".") === seqKey);

			// Fetch dispatch trace
			const tracesData = await client.rpc<{ traces: Array<Record<string, unknown>> }>("MonitorStepper-getDispatchTraces");
			const trace = tracesData.traces?.find((t) => Array.isArray(t.seqPath) && (t.seqPath as number[]).join(".") === seqKey);

			// Fetch quads whose provenance includes this seqPath
			const quadsData = await client.rpc<{ quads: Array<{ subject: string; predicate: string; object: unknown; namedGraph: string; timestamp: number; properties?: Record<string, unknown> }> }>(
				"MonitorStepper-getQuads",
			);
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

	protected render(): void {
		if (!this.shadowRoot) return;
		const { seqPath, stepEvent, trace, variablesSet, loading } = this.state;

		if (loading) {
			this.shadowRoot.innerHTML = `${this.css(STYLES)}<div class="empty"><shu-spinner></shu-spinner> Loading step [${seqPath.join(".")}]...</div>`;
			return;
		}

		const sections: string[] = [];

		// Step info
		if (stepEvent) {
			const stepIn = String(stepEvent.in ?? "");
			const actionName = String(stepEvent.actionName ?? "");
			const stepperName = String(stepEvent.stepperName ?? "");
			const status = stepEvent.status === "completed" ? "\u2705" : stepEvent.status === "failed" ? "\u274c" : "";
			sections.push(`<div class="field"><span class="label">Step:</span> <span class="value">${escHtml(stepIn)}</span></div>`);
			sections.push(`<div class="field"><span class="label">Action:</span> <span class="value">${status} ${escHtml(stepperName)}.${escHtml(actionName)}</span></div>`);
			if (stepEvent.error)
				sections.push(`<div class="field"><span class="label">Error:</span> <span class="value" style="color:red">${escHtml(String(stepEvent.error))}</span></div>`);
		}

		// Dispatch trace
		if (trace) {
			const transport = String(trace.transport ?? "local");
			const duration = trace.durationMs ? `${trace.durationMs}ms` : "";
			const products = Array.isArray(trace.productKeys) ? (trace.productKeys as string[]).join(", ") : "";
			const capability = trace.capabilityRequired ? `cap: ${trace.capabilityRequired}` : "";
			sections.push(`<div class="section"><span class="label">Transport:</span> <span class="value">${escHtml(transport)} ${escHtml(duration)}</span></div>`);
			if (capability) sections.push(`<div class="field"><span class="label">Capability:</span> <span class="value">${escHtml(capability)}</span></div>`);
			if (products) sections.push(`<div class="field"><span class="label">Products:</span> <span class="value">${escHtml(products)}</span></div>`);
		}

		// Variables set — name is clickable link, graph shown as context
		if (variablesSet.length > 0) {
			const varRows = variablesSet
				.map((v) => {
					const isVertex = !!getRels(v.graph);
					return `<div class="var-row"><span style="color:#888;font-size:11px">${escHtml(v.graph)}</span> <span class="entity-link" data-subject="${escHtml(v.name)}" data-label="${escHtml(v.graph)}" data-vertex="${isVertex}">${escHtml(v.name)}</span></div>`;
				})
				.join("");
			sections.push(`<div class="section"><span class="label">Data set (${variablesSet.length}):</span>${varRows}</div>`);
		}

		// Raw event data
		if (stepEvent) {
			const rawJson = JSON.stringify(stepEvent, null, 2).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
			sections.push(`<details class="section"><summary class="label">Raw event</summary><pre>${rawJson}</pre></details>`);
		}

		if (sections.length === 0) {
			this.shadowRoot.innerHTML = `${this.css(STYLES)}<div class="empty">No data found for step [${seqPath.join(".")}]</div>`;
			return;
		}

		this.shadowRoot.innerHTML = `${this.css(STYLES)}<div class="step-detail"><h4>Step [${seqPath.join(".")}]</h4>${sections.join("")}</div>`;

		// Bind entity links
		this.shadowRoot.querySelectorAll(".entity-link").forEach((el) => {
			el.addEventListener("click", () => {
				const subject = (el as HTMLElement).dataset.subject ?? "";
				const label = (el as HTMLElement).dataset.label ?? "";
				const isVertex = (el as HTMLElement).dataset.vertex === "true";
				if (!subject || !label) return;
				if (isVertex) {
					this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_OPEN, { detail: { subject, label }, bubbles: true, composed: true }));
				} else {
					this.showQuadDetail(label, subject);
				}
			});
		});
	}

	private showQuadDetail(graph: string, subject: string): void {
		const quads = this.state.allQuads.filter((q) => q.subject === subject && q.namedGraph === graph);
		openQuadDetailPane(graph, subject, quads, this);
	}
}
