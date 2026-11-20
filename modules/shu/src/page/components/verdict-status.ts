/**
 * The status of a statement or a claim as the page shows it: its mark and its word, described by its sentence. The mark is hidden
 * from assistive technology, which reads the word and the sentence, so colour and a symbol aren't the only signal of a status.
 */
import { html, type TemplateResult } from "lit";
import { STATUS_MARK, type TStatementStatus } from "@haibun/core/lib/domains/protocol.js";

/** The status `status`, under the test id `testId`, described by `sentence`. */
export const verdictStatusTpl = (testId: string, sentence: string, status: TStatementStatus): TemplateResult =>
	html`<span class="verdict verdict-${status}" data-testid=${testId} aria-description=${sentence}><span aria-hidden="true">${STATUS_MARK[status]}</span> ${status}</span>`;
