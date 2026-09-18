/**
 * <shu-activity-history>: the actions bar's shared scrolling output. Every mode appends its activity records here as
 * child elements, <shu-search-summary> (a restorable search) and <shu-step-caller> (a re-runnable step), so switching
 * modes never swaps the output area. The history renders the conversation's transcript among them as <shu-chat-message>
 * children. It reads the conversation, the page's turn and the active record, so the transcript outlives the ask pane
 * the bar removes when it closes. Each message is placed where it first appeared and updated in place, which keeps the
 * records in time order. The actions bar holds ONE instance for its lifetime.
 *
 * The history follows the live edge through the shared scroll controller: it scrolls to the newest entry while the
 * reader is at the end, holds their place once they scroll away, and states what arrived since on a control that
 * returns them to the end.
 *
 * Light DOM: entries are real children (test-id walks and text capture see them), styled by the host scope.
 * Carries the `chat-output` test id: the one output surface every mode's assertions already point at.
 */
import type { TemplateResult } from "lit";
import { html } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { ShuChatMessage } from "./shu-chat-message.js";
import { CHAT_VIEW_PARAM, SHU_TAG } from "../consts.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { FOLLOW_EDGE_SLACK_PX, ScrollFollowController, SignalController, SubjectController, TimelineViewController } from "../controllers/index.js";
import { nextQuestion } from "../chat-turn.js";
import { conversationState, transcript, turnEnded } from "../conversation.js";
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
	/** The chat's place on the run's timeline, written to the address beside the session so a reload opens where the
	 *  reader was reading. */
	#view = new TimelineViewController(this, { name: CHAT_VIEW_PARAM, onMove: () => this.syncTranscript() });
	#follow = new ScrollFollowController(this, () => this.#jumpToEnd(), {
		view: this.#view,
		arrivedAfter: () => this.#turnsAfterThePlace,
		// The reader's place is the newest turn they have been shown, so a turn asked after they stopped following is one
		// they haven't read. The page's cursor is null while the run is live, which would hold no place at all.
		placeNow: () => this.#newestShown,
	});
	/** When the newest turn this view shows was asked. */
	#newestShown: number | null = null;
	/** The turns asked after the place this reader holds, which is what the history offers to take them to. */
	#turnsAfterThePlace = 0;
	/** What the control last stated, so a render that changes nothing leaves its text as it is. */
	#stated = -1;
	/** The press a reader who scrolled away takes back to the end, which states what arrived meanwhile. */
	#arrived = this.#arrivedControl();
	#conversation = new SignalController(this, conversationState, () => this.syncTranscript());
	/** The current message is the active record, and the branch shown ends at the turn the next question replies to. */
	#subject = new SubjectController(
		this,
		() => this.syncTranscript(),
		(state) => [currentSubject(state)?.id, nextQuestion(state).repliesTo?.turn],
	);

	constructor() {
		super(EmptySchema, {});
	}

	createRenderRoot(): HTMLElement {
		return this;
	}

	protected onConnected(): void {
		this.#arrived.setAttribute("data-testid", SHU_TEST_IDS.APP.CHAT_ARRIVED);
		this.appendChild(this.#arrived);
		// A reader's own input pauses the follow, as it does in every other followed view: a scroll this view makes as it
		// grows reports the same geometry as a reader scrolling away, and pausing on that hides the turns that follow.
		for (const raised of ["wheel", "touchmove"]) this.autoListen(this, raised, () => this.#follow.setAtBottom(false), { passive: true });
		// Reaching the end resumes, however the view got there.
		this.autoListen(this, "scroll", () => this.scrollHeight - (this.scrollTop + this.clientHeight) <= FOLLOW_EDGE_SLACK_PX && this.#follow.setAtBottom(true), { passive: true });
	}

	/** Append an activity record and keep the newest entry in view where the reader is at the end. */
	append(entry: HTMLElement): void {
		this.insertBefore(entry, this.#arrived.parentNode === this ? this.#arrived : null);
		this.#follow.stick();
	}

	/** Pin the scroll to the newest entry, also called by a producer whose entry grows in place (a step's result). */
	keepNewestInView(): void {
		this.#follow.stick();
	}

	#jumpToEnd(): void {
		requestAnimationFrame(() => {
			this.scrollTop = this.scrollHeight;
		});
	}

	/** This control returns a paused reader to the end. It exists for the view's life and stays hidden while the view follows. */
	#arrivedControl(): HTMLButtonElement {
		const control = document.createElement("button");
		control.type = "button";
		control.className = "arrived";
		control.hidden = true;
		control.addEventListener("click", () => this.#follow.resume());
		return control;
	}

	/** State what arrived after the reader's place, or nothing while the view follows the end. */
	private statePlace(): void {
		const arrived = this.#follow.arrived;
		if (arrived === this.#stated) return;
		this.#stated = arrived;
		this.#arrived.hidden = arrived === 0;
		this.#arrived.textContent = arrived === 0 ? "" : `${arrived} ${arrived === 1 ? "turn" : "turns"} arrived, return to the newest`;
	}

	/** Place the transcript's messages: remove the ones it no longer holds, update the ones that changed, and append new
	 *  ones. The newest entry is kept in view when a message is added or a turn ends. */
	private syncTranscript(): void {
		const entries = transcript(this.#conversation.state, nextQuestion(this.#subject.state).repliesTo?.turn, appAccessLevel());
		const keys = new Set(entries.map(({ message }) => message.id));
		for (const [key, held] of this.#messages) {
			if (keys.has(key)) continue;
			held.el.remove();
			this.#messages.delete(key);
		}
		const current = this.#subject.record?.id;
		// A question the reader's place doesn't show is a turn asked after it, which is what the history offers to reach.
		this.#turnsAfterThePlace = entries.filter((entry) => entry.message.role === "user" && !this.#view.shows(entry.askedAt)).length;
		this.#newestShown = entries.reduce<number | null>((at, entry) => (entry.askedAt !== undefined && this.#view.shows(entry.askedAt) ? Math.max(at ?? 0, entry.askedAt) : at), null);
		let pin = false;
		for (const { message, shown, askedAt } of entries) {
			let held = this.#messages.get(message.id);
			if (!held) {
				held = { el: new ShuChatMessage(), given: "" };
				this.#messages.set(message.id, held);
				// The control the reader returns by stays last, and is placed only once this element holds it.
				this.insertBefore(held.el, this.#arrived.parentNode === this ? this.#arrived : null);
				pin = true;
			}
			const given = JSON.stringify(message);
			if (held.given !== given) {
				pin ||= turnEnded(held.el.message.status, message.status);
				held.el.message = message;
				held.given = given;
			}
			// A view holding a place on the timeline shows the turns asked at or before it and hides the rest.
			held.el.hidden = !shown || !this.#view.shows(askedAt);
			if (current !== undefined && message.recordId === current) held.el.setAttribute("aria-current", "true");
			else held.el.removeAttribute("aria-current");
		}
		if (pin) this.#follow.stick();
	}

	render(): TemplateResult {
		this.statePlace();
		return html``;
	}
}

customElements.define(SHU_TAG.ACTIVITY_HISTORY, ShuActivityHistory);
