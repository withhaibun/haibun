/**
 * The control that opens why a step holds or was refused: a press requests the axioms pane beside the pane that holds the
 * control, through the event a view of any bundle opens a pane with, and the pane reads the derivation actuality recorded for
 * the step and shows its records as frames.
 */
import { html, nothing, type TemplateResult } from "lit";
import { formatRecordName } from "@haibun/core/lib/seq-path.js";
import type { TPaneOpen } from "../derivations/pane-kinds.js";
import { readingActualityFeature } from "../client-cache/controllers/device-controller.js";
import { SHU_EVENT, SHU_TAG } from "../../domains/elements.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";

/** A control that opens why the step whose record is `step` holds or was refused: the axioms pane reads the derivation actuality
 *  recorded for the step and shows its records as frames, beside the pane that holds the control. */
export function whyTpl(step: string): TemplateResult {
	const detail: TPaneOpen = { pane: { paneType: "component", tag: SHU_TAG.GRAPH_SOURCE, label: `why ${step}`, data: { step } }, addToSelection: false };
	const open = (e: Event) => e.target?.dispatchEvent(new CustomEvent(SHU_EVENT.PANE_OPEN, { detail, bubbles: true, composed: true }));
	return html`<button type="button" data-testid=${SHU_TEST_IDS.WHY} title=${`open the proof actuality recorded for ${step}`} @click=${open}>Show why</button>`;
}

/** The control that opens why the step at `path` within the actuality feature the page reads holds or was refused. Before the page
 *  reads an actuality feature a step's path doesn't name a record, and the control isn't shown. */
export function whyOfPathTpl(path: readonly number[]): TemplateResult | typeof nothing {
	const actuality = readingActualityFeature();
	return actuality === undefined ? nothing : whyTpl(formatRecordName({ actuality, path: [...path] }));
}
