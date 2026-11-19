/**
 * The status of a statement or a claim as the page shows it: its mark and its word, described by its sentence. The mark is hidden
 * from assistive technology, which reads the word and the sentence, so colour and a symbol aren't the only signal of a status.
 */
import { STATUS_MARK, type TStatementStatus } from "@haibun/core/lib/domains/protocol.js";
import { esc, escAttr } from "./markdown.js";

/** Returns the status `status` as HTML, under the test id `testId`, described by `sentence`. */
export const verdictStatusHtml = (testId: string, sentence: string, status: TStatementStatus): string =>
	`<span class="verdict verdict-${escAttr(status)}" data-testid="${escAttr(testId)}" aria-description="${escAttr(sentence)}"><span aria-hidden="true">${esc(STATUS_MARK[status])}</span> ${esc(status)}</span>`;
