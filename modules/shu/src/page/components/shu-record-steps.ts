/**
 * <shu-record-steps>: renders the steps offered on a record: its kaname steps as primary controls, and a "more"
 * disclosure grouping remaining acts and reads. Steps that require authority the page doesn't hold are disabled with a
 * lock mark. Reads whose inputs are all bound run immediately in place; any act or step with remaining inputs expands
 * into <shu-step-caller> in place. Outcomes remain beside the record until dismissed or replaced.
 */
import { html, css, nothing, type TemplateResult } from "lit";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { RecordStepsStateSchema } from "../../domains/schemas.js";
import { SHU_EVENT, SHU_TAG } from "../../domains/elements.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { defineElement } from "../controllers/element-controller.js";
import { recordSteps } from "../controllers/registry-controller.js";
import { pageMay } from "../controllers/authority-controller.js";
import { conduit } from "../controllers/conduit-controller.js";
import { reads } from "../domains/links.js";
import { whyOfPathTpl } from "./why.js";
import { normalizeStepKey } from "../derivations/steps.js";
import { shuBaseStyles } from "./styles.js";
import { SentFileSchema, fileDataBlob } from "@haibun/core/lib/domains/media-object.js";
import { viewedInBrowser } from "@haibun/core/lib/domains/media-types.js";
import { saveFile, showFile } from "../controllers/file-controller.js";
import type { TCallLink, TRecordStep } from "@haibun/core/lib/domains/hypermedia.js";
import { onStepsChanged } from "../controllers/registry-controller.js";
import "./shu-step-caller.js";
import "./shu-refusal.js";

const MAX_PRIMARY = 3;

const seqPathOf = (res: unknown): number[] | undefined =>
	typeof res === "object" && res !== null && "_seqPath" in res && Array.isArray((res as { _seqPath: unknown })._seqPath) ? (res as { _seqPath: number[] })._seqPath : undefined;

export class ShuRecordSteps extends ShuElement<typeof RecordStepsStateSchema> {
	static domainSelector = SHU_TAG.RECORD_STEPS;
	static schema = RecordStepsStateSchema;
	static attributeFields = { label: "label", "record-id": "recordId", compact: "compact", active: "active" };

	static styles = [
		shuBaseStyles,
		css`
			:host { display: block; margin: 4px 0; }
			.record-steps-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
			.record-step-btn {
				display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; font-size: 0.85em; font-family: inherit;
				background: var(--shu-bg-input, #f0f0f0); color: var(--shu-fg, #222); border: 1px solid var(--shu-border, #ccc);
				border-radius: 3px; cursor: pointer; text-decoration: none; user-select: none;
			}
			.record-step-btn:hover:not(:disabled) { background: var(--shu-bg-hover, #e0e0e0); }
			.record-step-btn:disabled { opacity: 0.5; cursor: not-allowed; }
			.record-step-btn.act { border-color: var(--shu-accent-border, #888); font-weight: 500; }
			.record-step-btn.active { background: var(--shu-bg-active, #d0d0d0); border-color: var(--shu-focus, #333); }
			.lock-mark { font-size: 0.8em; }
			details.record-steps-more { display: inline-block; position: relative; }
			details.record-steps-more summary {
				font-size: 0.85em; padding: 2px 6px; cursor: pointer; color: var(--shu-fg-muted, #666);
				background: var(--shu-bg-input, #f0f0f0); border: 1px solid var(--shu-border, #ccc); border-radius: 3px;
			}
			details.record-steps-more[open] .more-popup {
				position: absolute; top: 100%; left: 0; z-index: 100; min-width: 160px; padding: 6px;
				background: var(--shu-bg-popup, #fff); border: 1px solid var(--shu-border, #ccc); border-radius: 4px;
				box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); display: flex; flex-direction: column; gap: 4px;
			}
			.group-title { font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.5px; color: var(--shu-fg-muted, #777); margin: 2px 0; }
			.group-btns { display: flex; flex-direction: column; gap: 2px; }
			.group-btns .record-step-btn { justify-content: flex-start; width: 100%; }
			.record-step-caller-box { margin-top: 6px; padding: 6px; background: var(--shu-bg-soft, #fafafa); border: 1px solid var(--shu-border, #ddd); border-radius: 4px; }
			.record-step-outcome {
				display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px;
				padding: 3px 8px; font-size: 0.85em; background: var(--shu-bg-info-soft, #eef5ff); border: 1px solid var(--shu-border-info, #cce0ff);
				border-radius: 3px;
			}
			.outcome-body { display: flex; align-items: center; gap: 6px; flex: 1; }
			.outcome-dismiss { background: none; border: none; font-size: 1.1em; cursor: pointer; color: var(--shu-fg-muted, #666); line-height: 1; }
			.outcome-dismiss:hover { color: var(--shu-fg, #000); }
		`,
	];

	#unfollowRegistry?: () => void;
	#links?: Record<string, TCallLink>;

	set links(value: Record<string, TCallLink> | undefined) {
		this.#links = value;
		this.requestUpdate();
	}

	get links(): Record<string, TCallLink> | undefined {
		return this.#links;
	}

	constructor() {
		super(RecordStepsStateSchema, { label: "", recordId: "", compact: false, active: false });
	}

	protected override onConnected(): void {
		this.#unfollowRegistry = onStepsChanged(() => this.requestUpdate());
	}

	protected override onDisconnected(): void {
		this.#unfollowRegistry?.();
		this.#unfollowRegistry = undefined;
	}

	summarizeForContext(): TLinkedData | null {
		return null;
	}

	render(): TemplateResult {
		const label = this.getAttribute("label") || this.state.label;
		const id = this.getAttribute("record-id") || this.state.recordId;
		if (!label || !id) return html``;

		const steps = recordSteps(label, id, this.#links);
		if (steps.length === 0) return html``;

		const primary = steps.slice(0, MAX_PRIMARY);
		const more = steps.slice(MAX_PRIMARY);
		const acts = more.filter((s) => s.asks === "act");
		const reads = more.filter((s) => s.asks === "read");

		return html`
			<div class="record-steps-bar" data-testid=${SHU_TEST_IDS.RECORD_STEPS.ROOT}>
				${primary.map((step) => this.#renderStepButton(step))}
				${more.length > 0 ? this.#renderMore(acts, reads) : nothing}
			</div>
			${this.#renderCaller(steps)}
			${this.#renderOutcome()}
		`;
	}

	#renderStepButton(step: TRecordStep): TemplateResult {
		const allowed = pageMay(step.capability);
		const active = this.state.activeMethod === step.method;
		const tooltip = allowed ? step.summary : `${step.summary} (requires ${step.capability})`;
		const normalized = normalizeStepKey(step.method);
		const isOffer = !this.state.compact && this.state.active && step.rel;
		const testId = isOffer ? `${SHU_TEST_IDS.COLUMN_BROWSER.ENTITY_OFFER}-${step.rel}` : `${SHU_TEST_IDS.RECORD_STEPS.STEP}-${normalized}`;

		return html`
			<button
				type="button"
				class="record-step-btn entity-step entity-offer ${step.asks} ${active ? "active" : ""}"
				data-testid=${testId}
				data-step=${normalized}
				?disabled=${!allowed}
				title=${tooltip}
				aria-label=${step.verb}
				aria-describedby=${tooltip}
				@click=${() => this.#choose(step)}
			>
				${allowed ? nothing : html`<span class="lock-mark" aria-hidden="true">🔒</span>`}
				<span class="btn-text">${step.verb}</span>
			</button>
		`;
	}

	#renderMore(acts: TRecordStep[], reads: TRecordStep[]): TemplateResult {
		return html`
			<details class="record-steps-more" data-testid=${SHU_TEST_IDS.RECORD_STEPS.MORE}>
				<summary>more</summary>
				<div class="more-popup">
					${
						acts.length > 0
							? html`
							<div class="group-title">acts</div>
							<div class="group-btns">${acts.map((step) => this.#renderStepButton(step))}</div>
						`
							: nothing
					}
					${
						reads.length > 0
							? html`
							<div class="group-title">reads</div>
							<div class="group-btns">${reads.map((step) => this.#renderStepButton(step))}</div>
						`
							: nothing
					}
				</div>
			</details>
		`;
	}

	async #choose(step: TRecordStep): Promise<void> {
		if (!pageMay(step.capability)) return;

		// Zero-input read runs immediately in place
		if (step.asks === "read" && step.unboundCount === 0) {
			try {
				const params = step.params === undefined ? {} : step.params;
				const result = await conduit().follow(reads(step.method, params), step.summary);
				this.#handleReadResult(step, result);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				this.setState({ activeMethod: undefined, outcome: { method: step.method, summary: `${step.verb} refused`, refusal: { error: message } } });
			}
			return;
		}

		// Toggle caller open/closed
		if (this.state.activeMethod === step.method) {
			this.setState({ activeMethod: undefined });
		} else {
			this.setState({ activeMethod: step.method });
		}
	}

	#handleReadResult(step: TRecordStep, result: unknown): void {
		const parsedFile = SentFileSchema.safeParse(result);
		if (parsedFile.success) {
			const { name, file } = parsedFile.data;
			const blob = fileDataBlob(file);
			if (viewedInBrowser(blob.type)) {
				showFile(blob, name, undefined);
			} else {
				saveFile(blob, name);
			}
		}

		const path = step.asks === "read" ? undefined : seqPathOf(result);
		this.setState({ activeMethod: undefined, outcome: { method: step.method, summary: `${step.verb} completed`, path } });
	}

	#renderCaller(steps: TRecordStep[]): TemplateResult | typeof nothing {
		const activeMethod = this.state.activeMethod;
		if (!activeMethod) return nothing;

		const step = steps.find((s) => s.method === activeMethod);
		if (!step) return nothing;

		const params = step.params === undefined ? {} : step.params;
		return html`
			<div class="record-step-caller-box">
				<shu-step-caller
					step=${step.method}
					params=${JSON.stringify(params)}
					@step-success=${(e: CustomEvent<unknown>) => this.#onStepSuccess(step, e.detail)}
					@step-error=${(e: CustomEvent<string>) => this.#onStepError(step, e.detail)}
				></shu-step-caller>
			</div>
		`;
	}

	#onStepSuccess(step: TRecordStep, result: unknown): void {
		const path = step.asks === "read" ? undefined : seqPathOf(result);
		this.setState({ activeMethod: undefined, outcome: { method: step.method, summary: `${step.verb} succeeded`, path } });
		this.dispatchEvent(new CustomEvent(SHU_EVENT.STEP_SUCCESS, { bubbles: true, composed: true, detail: result }));
	}

	#onStepError(step: TRecordStep, error: string): void {
		this.setState({ outcome: { method: step.method, summary: `${step.verb} refused`, refusal: { error } } });
	}

	#renderOutcome(): TemplateResult | typeof nothing {
		const outcome = this.state.outcome;
		if (!outcome) return nothing;

		return html`
			<div class="record-step-outcome" data-testid=${SHU_TEST_IDS.RECORD_STEPS.OUTCOME}>
				<div class="outcome-body">
					${outcome.refusal ? html`<shu-refusal .refusal=${outcome.refusal}></shu-refusal>` : html`<span>${outcome.summary}</span>`}
					${outcome.path ? whyOfPathTpl(outcome.path) : nothing}
				</div>
				<button type="button" class="outcome-dismiss" title="Dismiss" @click=${this.#dismissOutcome}>×</button>
			</div>
		`;
	}

	#dismissOutcome = (): void => {
		this.setState({ outcome: undefined });
	};
}

defineElement(SHU_TAG.RECORD_STEPS, ShuRecordSteps);
