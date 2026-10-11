/**
 * <shu-step-detail>: one step of a run, as its own record states it.
 *
 * A step is a record: what was asked for, what ran, how it went and why it failed, how long it took, where it ran, and
 * what it had to hold to run. This reads that record and the variables whose records link the step, so the pane is a
 * read of the graph rather than a second account of the same act. The read is a @lit/task keyed on the step, so
 * switching steps cancels the stale read and renders only the latest.
 */
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { recordJson } from "./json-disclosure.js";
import { html, css, type TemplateResult } from "lit";
import { Task, TaskStatus } from "@lit/task";
import { z } from "zod";
import { eventMarkerStyle } from "../derivations/event-marker.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { RPC_METHOD, SHU_EVENT, SHU_TAG, SHU_ATTR } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { shuBaseStyles } from "./styles.js";
import { reads } from "../domains/links.js";
import { conduit } from "../controllers/conduit-controller.js";
import { subscribeBatchedEvents } from "../controllers/event-stream-controller.js";
import { readIndividual, variablesSetBy, type TVariableSet } from "../../quads-snapshot.js";
import { anIndividual, type TContextPattern } from "../../schemas.js";
import { formatRecordName, formatSeqPath, parseSeqPath, SEQ_PATH_FIELD } from "@haibun/core/lib/seq-path.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { readingExecution } from "../../client-cache/index.js";
import { actionRef, calledRef, originLink, refTpl } from "./shu-ref.js";
import { REF_DENOTES } from "@haibun/core/lib/typed-links.js";
import { ClockController } from "../controllers/clock-controller.js";
import { appAccessLevel } from "../../view-query.js";

/** The name of the delay before the pane reads a running step again. */
const STEP_RE_READ = "step-re-read";

/** How long a burst of announcements is collected before a still-running step's record is read again. */
const STEP_RE_READ_AFTER_MS = 400;

const StateSchema = z.object({ seqPath: z.array(z.number()).default([]) });

type TStepData = { step?: Record<string, unknown>; variablesSet: TVariableSet[] };

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

	/** The step's record and the variables it set, keyed on the step. The variables are read from a sample of 1000 records
	 *  of each type, which holds more variables than the sample a graph view draws. */
	#load = new Task(this, {
		args: () => [formatSeqPath(this.state.seqPath), readingExecution()] as const,
		task: async ([path, execution]): Promise<TStepData> => {
			const id = stepRecordId(parseSeqPath(path) ?? [], execution);
			if (id === undefined) return { variablesSet: [] };
			const [record, quadsData] = await Promise.all([
				// One record, read by the name it carries: a step is a record a reader opens, not a query they run.
				readIndividual(SEQ_PATH_LABEL, id, appAccessLevel()),
				conduit().follow<{ quads: TQuad[] }>(reads(RPC_METHOD.CLUSTERED_QUADS, { perTypeLimit: 1000, accessLevel: appAccessLevel() }), "step-detail: clustered quads"),
			]);
			return { step: record.vertex, variablesSet: variablesSetBy(quadsData.quads ?? [], id) };
		},
	});

	/** Called by the pane afterAttach hook with the step's seqPath; setting the state re-keys the load task. Awaits the
	 *  settle so the caller's attach sequence still completes after the data lands (an error surfaces in render). */
	/** The step this pane reads, as the record it is: named only once the actuality being read is known. */
	override paneSubject(): TContextPattern[] | null {
		const id = stepRecordId(this.state.seqPath, readingExecution());
		return id === undefined ? null : [anIndividual(SEQ_PATH_LABEL, id)];
	}

	async open(seqPath: number[]): Promise<void> {
		this.setState({ seqPath });
		// Opening a step is a reader's move to it, stated as a record column states its record. The load below runs again
		// whenever the actuality being read moves on, which isn't a move of the reader's, so it doesn't state the subject.
		const patterns = this.paneSubject();
		if (patterns)
			this.dispatchEvent(new CustomEvent(SHU_EVENT.CONTEXT_CHANGE, { detail: { patterns, accessLevel: appAccessLevel(), label: SEQ_PATH_LABEL }, bubbles: true, composed: true }));
		await this.updateComplete;
		await this.#load.taskComplete.catch(() => undefined);
	}

	readonly #clock = new ClockController(this);

	protected override onConnected(): void {
		// A step still running reaches its end while this pane is open, and its record then shows it. A step that has
		// ended will not change again, so it is read once: a pane that re-read on every announcement would never settle,
		// since reading actuality is itself something actuality announces. In snapshot mode actuality doesn't change.
		if (this.hasAttribute(SHU_ATTR.SNAPSHOT_TIME)) return;
		const unsubscribe = subscribeBatchedEvents({
			onBatch: () => {
				if (this.#load.status !== TaskStatus.COMPLETE || this.#ended()) return;
				this.#clock.coalesce(STEP_RE_READ, STEP_RE_READ_AFTER_MS, () => void this.#load.run());
			},
		});
		this.autoTeardown(unsubscribe);
	}

	/** Whether the step this pane shows has ended, which is when its record stops changing. */
	#ended(): boolean {
		return typeof this.#load.value?.step?.[SEQ_PATH_FIELD.endedAtTime] === "string";
	}

	/** A variable the step set, as a link to its record. */
	private variableRef({ name, graph }: TVariableSet): TemplateResult {
		return refTpl(REF_DENOTES.individual, { persistedAs: graph, id: name }, name);
	}

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
		if (!step && variablesSet.length === 0) return html`<div class="empty">Actuality doesn't hold a record of step [${key}]</div>`;
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
				<div class="field"><span class="label">Action:</span> <span class="value">${status} ${field(SEQ_PATH_FIELD.called) ? calledRef(field(SEQ_PATH_FIELD.called)) : ""}</span></div>
				${field(SEQ_PATH_FIELD.error) ? html`<div class="field"><span class="label">Error:</span> <span class="value" style="color:var(--shu-error)">${field(SEQ_PATH_FIELD.error)}</span></div>` : ""}
				<div class="section"><span class="label">Ran:</span> <span class="value">${field(SEQ_PATH_FIELD.ranVia)}${ranOn ? html` ${originLink(ranOn)}` : ""}${took ? ` ${took}` : ""}</span></div>
				${capability ? html`<div class="field"><span class="label">Capability:</span> <span class="value">${actionRef(capability)}${allowed ? html` allowed by ${actionRef(allowed)}` : ""}</span></div>` : ""}
			`
					: ""
			}
			${
				variablesSet.length > 0
					? html`
				<div class="section"><span class="label">Data set (${variablesSet.length}):</span>
					${variablesSet.map((v) => html`<div class="var-row"><span style="color:var(--shu-fg-faded);font-size:var(--shu-font-sm)">${v.graph}</span> ${this.variableRef(v)}</div>`)}
				</div>
			`
					: ""
			}
			${step ? unsafeHTML(recordJson(step, true)) : ""}
		</div>`;
	}
}

defineElement(SHU_TAG.STEP_DETAIL, ShuStepDetail);
