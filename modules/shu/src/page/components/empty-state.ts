import { html, nothing, type TemplateResult } from "lit";
import "./shu-spinner.js";

/**
 * The one pathway for every view's empty, unavailable or failed state. A state names the missing data and the next step
 * (`TLeadsOn`): a reference to its subject, a control that reads again or opens a view, or a refusal with its remedy. A state
 * therefore never ends in text alone. While the data is being read (`loaded` is false), the pathway reports a wait, NEVER a
 * false "no data".
 *
 * Each control supplies its own `loaded` (e.g. a run source's `loaded`, the clustered base's snapshot-loaded, or a
 * per-view fetch flag); the render is shared so the distinction is made identically everywhere. Relies on the consuming
 * view's `.empty` style and the globally-registered `<shu-spinner>`.
 */

/** The next step a state offers: a reference, a control or a refusal with its remedy. */
export type TLeadsOn = TemplateResult;

/** An empty, unavailable or failed state: what isn't there, the next step it offers, and the test id of its markup. */
export type TEmptyState = { message: string | TemplateResult; next: TLeadsOn; testId?: string };

/** The markup of a state of the given class. */
const stateOf =
	(stated: string) =>
	({ message, next, testId }: TEmptyState): TemplateResult =>
		html`<div class=${stated} data-testid=${testId ?? nothing}>${message} ${next}</div>`;

/** The markup of an empty state. */
export const emptyState = stateOf("empty");

/** The markup of data that is UNAVAILABLE: not cached on this device and a server didn't return it. */
export const unavailableState = stateOf("empty unavailable");

/** A wait for a read, stating what it reads. */
export const waitingTpl = (reading: TemplateResult | typeof nothing): TemplateResult => html`<div class="empty"><shu-spinner></shu-spinner> ${reading}</div>`;

/** The control that reads again what a view couldn't read. */
export const readAgainControl = (readAgain: () => void): TLeadsOn => html`<button type="button" @click=${readAgain}>Read again</button>`;

/** An empty region: waiting while the data is read, and the empty state once it is. */
export function emptyOrLoading(loaded: boolean, empty: TEmptyState): TemplateResult {
	return loaded ? emptyState(empty) : waitingTpl(html`Waiting…`);
}

/** The same pathway for data that may be UNAVAILABLE. That is a third state, distinct from loading and from empty, and the
 *  reader is told which it is rather than shown a false "no data". */
export function unavailableOrEmpty(loaded: boolean, unavailable: TEmptyState | undefined, empty: TEmptyState): TemplateResult {
	return unavailable === undefined ? emptyOrLoading(loaded, empty) : unavailableState(unavailable);
}
