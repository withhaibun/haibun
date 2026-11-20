/**
 * A passage a record cites as evidence, as a view shows it: a link that opens the Body with the passage selected where the Body reads
 * as the passage quoted it, and its stale mark where the Body changed after, since the link would select a passage of a text the
 * passage didn't quote.
 */
import { html, nothing, type TemplateResult } from "lit";
import { ANCHOR_STATE } from "@haibun/core/lib/domains/quote-anchor.js";
import type { TEvidence } from "../domains/claims.js";
import { linkTpl, passageHref, passageName } from "./ref-navigation.js";

/** The test ids of a view's passage: its link, and its stale mark. */
export type TPassageIds = { readonly link: string; readonly stale: string };

/** Returns the mark of a passage or a note whose Body changed after it quoted the Body: `text`, described by `description`. */
export const staleMarkTpl = (text: string, description: string, testId?: string): TemplateResult =>
	html`<span class="anchor-stale" data-testid=${testId === undefined ? nothing : testId} aria-description=${description}>${text}</span>`;

/** Returns the passage `evidence` quotes of `what`, under the test ids `ids`, with `linkClass` on its link. */
export function passageTpl(evidence: TEvidence, what: string, ids: TPassageIds, linkClass?: string): TemplateResult | string {
	const named = passageName(what, evidence);
	if (evidence.state === ANCHOR_STATE.stale) return staleMarkTpl(ANCHOR_STATE.stale, `${named}, and the Body changed after the passage quoted it`, ids.stale);
	const href = passageHref(evidence);
	if (href === undefined) throw new Error(`the passage of ${what} in the ${evidence.source.label} ${evidence.source.id} doesn't address a pane`);
	return linkTpl(href, "quote", { testId: ids.link, label: named, ...(linkClass === undefined ? {} : { linkClass }) });
}
