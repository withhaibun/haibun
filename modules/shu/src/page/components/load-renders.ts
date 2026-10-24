/** What a view renders of a read it shows while the read is under way and where it was refused, with a control that reads again. */
import { html, nothing, type TemplateResult } from "lit";
import type { TPageRefusal } from "../domains/refusal.js";
import "./shu-refusal.js";
import "./shu-spinner.js";
import { waitingTpl } from "./empty-state.js";

/** A read a refusal reads again. */
export type TReadAgain = { run(): Promise<void> };

/** A read's refusal, with a control that reads it again. */
export const refusalTpl = (refusal: TPageRefusal, load: TReadAgain): TemplateResult => html`<shu-refusal .refusal=${refusal} .readAgain=${() => void load.run()}></shu-refusal>`;

/** The renders of a read a view shows other than what it completes with: a spinner before the read, a spinner that states
 *  `reading` during it, and its refusal, with a control that reads again. */
export const loadRenders = (reading: TemplateResult, load: TReadAgain) => ({
	pending: (): TemplateResult => waitingTpl(nothing),
	running: (): TemplateResult => waitingTpl(html`${reading}…`),
	failed: (refusal: TPageRefusal): TemplateResult => refusalTpl(refusal, load),
});
