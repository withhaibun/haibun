/**
 * <shu-step-detail>: one step of a run, as its own record states it.
 *
 * A step is a record: what was asked for, what ran, how it went and why it failed, how long it took, where it ran, and
 * what it had to hold to run. This reads that record and the quads whose provenance names the step, so the pane is a
 * read of the graph rather than a second account of the same act. The read is a @lit/task keyed on the step, so
 * switching steps cancels the stale read and renders only the latest.
 */
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { jsonDisclosure } from "./json-disclosure.js";
import { html, css, type TemplateResult } from "lit";
import { Task, TaskStatus } from "@lit/task";
import { z } from "zod";
import { eventMarkerStyle } from "../event-marker.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { RPC_METHOD } from "../consts.js";
import { shuBaseStyles } from "./styles.js";
import { reads, conduit } from "../hypermedia.js";
import { subscribeBatchedEvents } from "../event-stream.js";
import { readIndividual } from "../quads-snapshot.js";
import { SHU_EVENT } from "../consts.js";
import { getRels } from "../rels-cache.js";
import { appAccessLevel } from "../util.js";
import { formatRecordName, formatSeqPath, parseSeqPath, SEQ_PATH_FIELD } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { readingExecution } from "../client-cache/index.js";
import { PaneState } from "../pane-state.js";

/** How long a burst of announcements is collected before a still-running step's record is read again. */
const STEP_RE_READ_AFTER_MS = 400;

const StateSchema = z.object({
	seqPath: z.array(z.number()).default([]),
});

type TVar = { name: string; value: unknown; graph: string };
type TStepData = { step?: Record<string, unknown>; variablesSet: TVar[] };

/** The record that is this step: the step path a reader navigated to, under the execution being read. */
export function stepRecordId(path: number[], execution: string | undefined): string | undefined {
	return execution === undefined || path.length === 0 ? undefined : formatRecordName({ execution, path });
}

export class ShuStepDetail extends ShuElement<typeof StateSchema> {
	/** One step as a prov:Activity: its record, and the variables it set. */
	summarizeForKihan(): TLinkedData | null {
		const data = this.#load.value;
		if (!data?.step) return null;
		return {
			"@id": `view:step-${formatSeqPath(this.state.seqPath)}`,
			"@type": "prov:Activity",
			name: "a step execution detail",
			step: data.step,
			...(data.variablesSet.length ? { variablesSet: data.variablesSet } : {}),
		};
	}

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

	/** The step's record and the quads it set, keyed on the step. The quad query is a fuller per-step provenance read
	 *  (perTypeLimit 1000), not the limited display snapshot the graph views share, which would drop the very quads
	 *  whose provenance names this step. */
	#load = new Task(this, {
		args: () => [formatSeqPath(this.state.seqPath), readingExecution()] as const,
		task: async ([path, execution]): Promise<TStepData> => {
			const id = stepRecordId(parseSeqPath(path) ?? [], execution);
			if (id === undefined) return { variablesSet: [] };
			const [record, quadsData] = await Promise.all([
				// One record, read by the name it carries: a step is a record a reader opens, not a query they run.
				readIndividual(SEQ_PATH_LABEL, id, appAccessLevel()),
				conduit().follow<{ quads: Array<{ subject: string; predicate: string; object: unknown; namedGraph: string; timestamp: number; properties?: Record<string, unknown> }> }>(
					reads(RPC_METHOD.CLUSTERED_QUADS, { perTypeLimit: 1000, accessLevel: appAccessLevel() }),
					"step-detail: clustered quads",
				),
			]);
			const variablesSet: TVar[] = (quadsData.quads ?? [])
				.filter((q) => {
					const prov = q.properties?.provenance;
					return Array.isArray(prov) && prov.some((p: unknown) => Array.isArray(p) && formatSeqPath(p as number[]) === path);
				})
				.map((q) => ({ name: q.subject, value: q.object, graph: q.namedGraph }));
			return { step: record.vertex, variablesSet };
		},
	});

	/** Called by the pane afterAttach hook with the step's seqPath; setting the state re-keys the load task. Awaits the
	 *  settle so the caller's attach sequence still completes after the data lands (an error surfaces in render). */
	async open(seqPath: number[]): Promise<void> {
		this.setState({ seqPath });
		await this.updateComplete;
		await this.#load.taskComplete.catch(() => undefined);
	}

	protected override onConnected(): void {
		// A step still running reaches its end while this pane is open, and its record then says so. A step that has
		// ended will not change again, so it is read once: a pane that re-read on every announcement would never settle,
		// since reading the run is itself something the run announces. In snapshot mode nothing changes.
		if (this.hasAttribute("data-snapshot-time")) return;
		let due: ReturnType<typeof setTimeout> | null = null;
		const unsubscribe = subscribeBatchedEvents({
			onBatch: () => {
				if (due || this.#load.status !== TaskStatus.COMPLETE || this.#ended()) return;
				due = setTimeout(() => {
					due = null;
					void this.#load.run();
				}, STEP_RE_READ_AFTER_MS);
			},
		});
		this.autoTeardown(() => {
			if (due) clearTimeout(due);
			unsubscribe();
		});
	}

	/** Whether the step this pane shows has ended, which is when its record stops changing. */
	#ended(): boolean {
		return typeof this.#load.value?.step?.[SEQ_PATH_FIELD.endedAtTime] === "string";
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
		const key = formatSeqPath(this.state.seqPath);
		if (!key) return html`<div class="empty"><shu-spinner></shu-spinner> Loading step…</div>`;
		return this.#load.render({
			initial: () => html`<div class="empty"><shu-spinner></shu-spinner> Loading step [${key}]...</div>`,
			pending: () => html`<div class="empty"><shu-spinner></shu-spinner> Loading step [${key}]...</div>`,
			error: (e) => html`<div class="empty" style="color:var(--shu-error)">Failed to load step [${key}]: ${errorDetail(e)}</div>`,
			complete: (data) => this.renderContent(key, data),
		});
	}

	private renderContent(key: string, data: TStepData): TemplateResult {
		const { step, variablesSet } = data;
		if (!step && variablesSet.length === 0) return html`<div class="empty">No record of step [${key}]</div>`;
		const field = (name: string): string => (step && typeof step[name] === "string" ? String(step[name]) : "");
		// The same glyph the log and the rail use, so a speculative try or a handed-out call is not shown as a fault.
		const status = field(SEQ_PATH_FIELD.actionStatus) ? eventMarkerStyle({ status: field(SEQ_PATH_FIELD.actionStatus), kind: "lifecycle", type: "step" }).icon : "";
		const began = Date.parse(field(SEQ_PATH_FIELD.generatedAtTime));
		const ended = Date.parse(field(SEQ_PATH_FIELD.endedAtTime));
		const took = Number.isNaN(began) || Number.isNaN(ended) ? "" : `${ended - began}ms`;
		const ranOn = field(SEQ_PATH_FIELD.ranOn);
		const capability = field(SEQ_PATH_FIELD.capabilityAction);
		const allowed = field(SEQ_PATH_FIELD.allowedAction);
		return html`<div class="step-detail">
			<h4>Step [${key}]</h4>
			${
				step
					? html`
				<div class="field"><span class="label">Step:</span> <span class="value">${field(SEQ_PATH_FIELD.stepText)}</span></div>
				<div class="field"><span class="label">Action:</span> <span class="value">${status} ${field(SEQ_PATH_FIELD.called)}</span></div>
				${field(SEQ_PATH_FIELD.error) ? html`<div class="field"><span class="label">Error:</span> <span class="value" style="color:var(--shu-error)">${field(SEQ_PATH_FIELD.error)}</span></div>` : ""}
				<div class="section"><span class="label">Ran:</span> <span class="value">${field(SEQ_PATH_FIELD.ranVia)}${ranOn ? ` ${ranOn}` : ""}${took ? ` ${took}` : ""}</span></div>
				${capability ? html`<div class="field"><span class="label">Capability:</span> <span class="value">${capability}${allowed ? ` allowed by ${allowed}` : ""}</span></div>` : ""}
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
			${step ? html`<details class="section" open><summary class="label">Data</summary>${unsafeHTML(jsonDisclosure(step))}</details>` : ""}
		</div>`;
	}
}
