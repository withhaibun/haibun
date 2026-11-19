/**
 * The status of a statement or a claim as the page shows it: its mark and its word, described by its sentence. The mark is hidden
 * from assistive technology, which reads the word and the sentence, so colour and a symbol aren't the only signal of a status.
 */
import { VERDICT_MARK, type TVerdict } from "@haibun/core/lib/domains/protocol.js";
import { esc, escAttr } from "./markdown.js";

/** Returns the status of `verdict` as HTML, under the test id `testId`, described by `sentence`. */
export const verdictStatusHtml = (testId: string, sentence: string, verdict: TVerdict): string =>
	`<span class="verdict verdict-${escAttr(verdict)}" data-testid="${escAttr(testId)}" aria-description="${escAttr(sentence)}"><span aria-hidden="true">${esc(VERDICT_MARK[verdict])}</span> ${esc(verdict)}</span>`;
