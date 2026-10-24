/**
 * <shu-step-detail>: one step of a run, as its own record states it.
 *
 * A step is a record: what was requested, what ran, how it went and why it failed, how long it took, where it ran, and
 * what it had to hold to run. This reads that record and the variables whose records link the step, so the pane is a
 * read of the graph rather than a second account of the same act. The read is a load controller's, so opening another
 * step ends the earlier read without showing it, and a refused read shows the refusal and its remedy.
 */
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { recordJson } from "./json-disclosure.js";
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { STATUS_MARKS } from "../derivations/status-mark.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { SHU_EVENT, SHU_TAG, SHU_ATTR } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { shuBaseStyles } from "./styles.js";
import { subscribeBatchedEvents } from "../controllers/event-stream-controller.js";
import { variablesSetBy, type TVariableSet } from "../derivations/step-variables.js";
import { anIndividual, type TContextPattern } from "@haibun/core/lib/conversation/domains/conversation.js";
import { formatSeqPath, parseRecordName, stepLine, type TStepLine } from "@haibun/core/lib/seq-path.js";
import { actionRef, calledRef, originLink, recordRef } from "./shu-ref.js";
import { ClockController } from "../controllers/clock-controller.js";
import { appAccessLevel } from "../controllers/view-query-controller.js";
import { typeShownIn } from "../controllers/catalog-controller.js";
import { clusteredQuads, recordRead } from "../controllers/read-controller.js";
import { LoadController } from "../controllers/load-controller.js";
import { loadRenders, refusalTpl } from "./load-renders.js";
import { emptyState, waitingTpl } from "./empty-state.js";
import { actualityStepsNext } from "./actuality-states.js";

/** The name of the delay before the pane reads a running step again. */
const STEP_RE_READ = "step-re-read";

/** How many records of each type a sample holds, which holds more variables than the sample a graph view draws. */
const VARIABLE_SAMPLE = 1000;

/** How long a burst of announcements is collected before a still-running step's record is read again. */
const STEP_RE_READ_AFTER_MS = 400;

/** The record of the step the view shows, its type and its id, or undefined before a pane opens it. */
const StateSchema = z.object({ record: z.object({ persistedAs: z.string(), id: z.string() }).optional() });

type TStepData = { step?: Record<string, unknown>; variablesSet: TVariableSet[] };

export class ShuStepDetail extends ShuElement<typeof StateSchema> {
	/** One step as a prov:Activity: its record, and the variables it set. */
	summarizeForContext(): TLinkedData | null {
		const data = this.#load.page;
		if (!data?.step) return null;
		return {
			"@id": `view:step-${this.state.record?.id}`,
			"@type": "prov:Activity",
			name: "a step's detail",
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
		super(StateSchema, {});
	}

	/** The step's record and the variables it set, read from a sample of `VARIABLE_SAMPLE` records of each type. */
	readonly #load = new LoadController<TStepData>(this, async () => {
		const { record } = this.state;
		if (record === undefined) return { ok: true, value: { variablesSet: [] } };
		// One record, read by the name it carries: a step is a record a reader opens, not a query they run.
		const [read, sampled] = await Promise.all([recordRead(record.persistedAs, record.id), clusteredQuads(VARIABLE_SAMPLE)]);
		if (!read.ok) return read;
		if (!sampled.ok) return sampled;
		return { ok: true, value: { step: read.value.vertex, variablesSet: variablesSetBy(sampled.value.quads, record.id) } };
	});

	/** The step this pane reads, as the record it is. */
	override paneSubject(): TContextPattern[] | null {
		const { record } = this.state;
		return record === undefined ? null : [anIndividual(record.persistedAs, record.id)];
	}

	/** Opens the step record `id` as a record's view opens its record, which re-keys the read. Resolves once the read
	 *  settles, so a pane's attach ends after the data arrives; a failed read shows in the view. Throws for a record of a
	 *  type whose declaration doesn't name this view. */
	async open(id: string, persistedAs: string): Promise<void> {
		const shown = typeShownIn(SHU_TAG.STEP_DETAIL);
		if (persistedAs !== shown) throw new Error(`<${SHU_TAG.STEP_DETAIL}> shows a ${shown} record, and was opened at a record of ${persistedAs}`);
		this.setState({ record: { persistedAs, id } });
		// Opening a step is a reader's move to it, stated as a record column states its record. The load below runs again
		// whenever the actuality being read moves on, which isn't a move of the reader's, so it doesn't state the subject.
		const patterns = this.paneSubject();
		if (patterns)
			this.dispatchEvent(new CustomEvent(SHU_EVENT.CONTEXT_CHANGE, { detail: { patterns, readLevel: appAccessLevel(), label: persistedAs }, bubbles: true, composed: true }));
		await this.updateComplete;
		await this.#load.run();
	}

	readonly #clock = new ClockController(this);

	protected override onConnected(): void {
		// A step still running reaches its end while this pane is open, and its record then shows it. A step that has
		// ended will not change again, so it is read once: a pane that re-read on every announcement would never settle,
		// since reading actuality is itself something actuality announces. In snapshot mode actuality doesn't change.
		if (this.hasAttribute(SHU_ATTR.SNAPSHOT_TIME)) return;
		const unsubscribe = subscribeBatchedEvents({
			onBatch: () => {
				if (!this.#load.completed || this.#ended()) return;
				this.#clock.coalesce(STEP_RE_READ, STEP_RE_READ_AFTER_MS, () => void this.#load.refresh());
			},
		});
		this.autoTeardown(unsubscribe);
	}

	/** Whether the step this pane shows has ended, which is when its record stops changing. */
	#ended(): boolean {
		const step = this.#load.page?.step;
		return step !== undefined && stepLine(step).ended !== undefined;
	}

	/** A variable the step set, as a link to its record. */
	private variableRef({ name, graph }: TVariableSet): TemplateResult {
		return recordRef({ persistedAs: graph, id: name }, name);
	}

	render(): TemplateResult {
		const { record } = this.state;
		if (record === undefined) return waitingTpl(html`Loading step…`);
		const name = parseRecordName(record.id);
		const key = name === undefined ? record.id : formatSeqPath(name.path);
		return this.#load.render({
			...loadRenders(html`Loading step [${key}]`, this.#load),
			failed: (refusal) => emptyState({ message: `Step [${key}] wasn't read.`, next: refusalTpl(refusal, this.#load) }),
			completed: (data) => this.renderContent(key, data),
		});
	}

	/** A step's words, its action and how it ended, where and how long it ran, and the capability it required. The glyph
	 *  of how it ended is the one the log and the rail use. */
	private renderLine(line: TStepLine): TemplateResult {
		const { dispatch, action } = line;
		return html`
			<div class="field"><span class="label">Step:</span> <span class="value">${line.text}</span></div>
			<div class="field"><span class="label">Action:</span> <span class="value">${STATUS_MARKS.get(line.status)?.icon} ${line.called === undefined ? "" : calledRef(line.called)}</span></div>
			${line.error === undefined ? "" : html`<div class="field"><span class="label">Error:</span> <span class="value" style="color:var(--shu-error)">${line.error}</span></div>`}
			<div class="section"><span class="label">Ran:</span> <span class="value">${dispatch === undefined ? "" : dispatch.via}${dispatch?.on === undefined ? "" : html` ${originLink(dispatch.on)}`}${line.tookMs === undefined ? "" : ` ${line.tookMs}ms`}</span></div>
			${action === undefined ? "" : html`<div class="field"><span class="label">Capability:</span> <span class="value">${actionRef(action.required)}${action.allowed === undefined ? "" : html` allowed by ${actionRef(action.allowed)}`}</span></div>`}`;
	}

	private renderContent(key: string, data: TStepData): TemplateResult {
		const { step, variablesSet } = data;
		if (!step && variablesSet.length === 0) return emptyState({ message: `Actuality doesn't hold a record of step [${key}].`, next: actualityStepsNext() });
		const line = step === undefined ? undefined : stepLine(step);
		return html`<div class="step-detail">
			<h4>Step [${key}]</h4>
			${line === undefined ? "" : this.renderLine(line)}
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
