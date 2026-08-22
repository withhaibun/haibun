/**
 * <shu-activity-history> — THE shared scrolling output region of the actions bar. Every mode appends its
 * activity records here as child elements — <shu-search-summary> (a restorable search), <shu-step-caller>
 * (a re-runnable step), <shu-chat-message> (a chat turn) — so switching modes never swaps the output area,
 * it only changes the input line beneath. The actions bar holds ONE instance as a field and renders that
 * same node every update, so the accumulated history survives mode switches and collapse/expand.
 *
 * Light DOM: entries are real children (test-id walks and text capture see them), styled by the host scope.
 * Carries the `chat-output` test id — the one output surface every mode's assertions already point at.
 */
import type { TemplateResult } from "lit";
import { html } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { SHU_TAG } from "../consts.js";

const EmptySchema = z.object({});

export class ShuActivityHistory extends ShuElement<typeof EmptySchema> {
	/** The actions-bar output region, not a column pane: the harvest reads only column panes, so this is never the
	 *  active pane, and its entries (searches, steps, chat turns) are represented by their own views. Contributes nothing. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static schema = EmptySchema;
	static domainSelector = SHU_TAG.ACTIVITY_HISTORY;

	constructor() {
		super(EmptySchema, {});
	}

	createRenderRoot(): HTMLElement {
		return this;
	}

	/** Append an activity record and keep the newest entry in view. */
	append(entry: HTMLElement): void {
		this.appendChild(entry);
		this.scrollToBottom();
	}

	/** Pin the scroll to the newest entry — also called by a producer whose entry grows in place (a streaming chat turn). */
	scrollToBottom(): void {
		requestAnimationFrame(() => {
			this.scrollTop = this.scrollHeight;
		});
	}

	render(): TemplateResult {
		return html``;
	}
}

customElements.define(SHU_TAG.ACTIVITY_HISTORY, ShuActivityHistory);
