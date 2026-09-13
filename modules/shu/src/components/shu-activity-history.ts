/**
 * <shu-activity-history>: the actions bar's shared scrolling output. Every mode appends its activity records here as
 * child elements, <shu-search-summary> (a restorable search) and <shu-step-caller> (a re-runnable step), so switching
 * modes never swaps the output area. The history renders the conversation's transcript among them as <shu-chat-message>
 * children. It reads the conversation, the page's turn and the active record, so the transcript outlives the ask pane
 * the bar removes when it closes. Each message is placed where it first appeared and updated in place, which keeps the
 * records in time order. The actions bar holds ONE instance for its lifetime.
 *
 * Light DOM: entries are real children (test-id walks and text capture see them), styled by the host scope.
 * Carries the `chat-output` test id: the one output surface every mode's assertions already point at.
 */
import type { TemplateResult } from "lit";
import { html } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { ShuChatMessage } from "./shu-chat-message.js";
import { SHU_TAG } from "../consts.js";
import { SignalController, SubjectController } from "../controllers/index.js";
import { nextQuestion, turnEnded, turnState } from "../chat-turn.js";
import { conversationState, transcript } from "../conversation.js";
import { currentSubject } from "../current-subject.js";
import { appAccessLevel } from "../util.js";

const EmptySchema = z.object({});

export class ShuActivityHistory extends ShuElement<typeof EmptySchema> {
	/** The actions-bar output region, not a column pane: the harvest reads only column panes, so this is never the
	 *  active pane, and its entries (searches, steps, chat turns) are represented by their own views. Contributes nothing. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static schema = EmptySchema;
	static domainSelector = SHU_TAG.ACTIVITY_HISTORY;

	/** Each message of the transcript by its key, with the message it was last given. */
	#messages = new Map<string, { el: ShuChatMessage; given: string }>();
	#conversation = new SignalController(this, conversationState, () => this.syncTranscript());
	#turn = new SignalController(this, turnState, () => this.syncTranscript());
	/** The current message is the active record, and the branch shown ends at the turn the next question replies to. */
	#subject = new SubjectController(
		this,
		() => this.syncTranscript(),
		(state) => [currentSubject(state)?.id, nextQuestion(state).repliesTo?.seqPath],
	);

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

	/** Pin the scroll to the newest entry, also called by a producer whose entry grows in place (a step's result). */
	scrollToBottom(): void {
		requestAnimationFrame(() => {
			this.scrollTop = this.scrollHeight;
		});
	}

	/** Place the transcript's messages: remove the ones it no longer holds, update the ones that changed, and append new
	 *  ones. The newest entry is kept in view when a message is added or a turn ends. */
	private syncTranscript(): void {
		const entries = transcript(this.#conversation.state, this.#turn.state, nextQuestion(this.#subject.state).repliesTo?.seqPath, appAccessLevel());
		const keys = new Set(entries.map(({ message }) => message.id));
		for (const [key, held] of this.#messages) {
			if (keys.has(key)) continue;
			held.el.remove();
			this.#messages.delete(key);
		}
		const current = this.#subject.record?.id;
		let pin = false;
		for (const { message, shown } of entries) {
			let held = this.#messages.get(message.id);
			if (!held) {
				held = { el: new ShuChatMessage(), given: "" };
				this.#messages.set(message.id, held);
				this.appendChild(held.el);
				pin = true;
			}
			const given = JSON.stringify(message);
			if (held.given !== given) {
				pin ||= turnEnded(held.el.message.status, message.status);
				held.el.message = message;
				held.given = given;
			}
			held.el.hidden = !shown;
			if (current !== undefined && message.recordId === current) held.el.setAttribute("aria-current", "true");
			else held.el.removeAttribute("aria-current");
		}
		if (pin) this.scrollToBottom();
	}

	render(): TemplateResult {
		return html``;
	}
}

customElements.define(SHU_TAG.ACTIVITY_HISTORY, ShuActivityHistory);
