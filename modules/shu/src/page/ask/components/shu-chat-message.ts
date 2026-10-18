/**
 * <shu-chat-message>: one question or one response of the conversation's transcript. Purely prop-driven: the activity
 * history renders the transcript from the conversation and the page's turn, and passes each message one TChatMessage.
 * It renders in light DOM so the host scope's styles reach it.
 */
import { css, html, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { guard } from "lit/directives/guard.js";
import { z } from "zod";
import { refContext } from "../../controllers/catalog-controller.js";
import { ShuElement, type TLinkedData, EmptyStateSchema } from "../../components/shu-element.js";
import "../../components/shu-spinner.js";
import { dispatchSubjectEvent } from "../../controllers/subject-controller.js";
import { SCOPE } from "../../domains/current-subject.js";
import { SHU_ATTR, SHU_EVENT, SHU_TAG } from "../../../domains/elements.js";
import { defineElement } from "../../controllers/element-controller.js";
import { SHU_TEST_IDS } from "../../../domains/test-ids.js";
import { patternRef, recordRef } from "../../components/shu-ref.js";
import { CalledSchema } from "@haibun/core/lib/domains/called.js";
import { ICON_STEP_COMPLETED, RETURNED_TO_CALLER } from "@haibun/core/lib/domains/protocol.js";
import { BundleSchema, ChatRoleSchema, type TBundle, type TChatRole, type TQuestionFork } from "../../../domains/schemas.js";
import { ChatStatusSchema, UNVERIFIED_TURN } from "@haibun/core/lib/conversation/domains/conversation.js";
import { proseText, renderRefAnswer, renderRefProse } from "../../derivations/markdown.js";

/** Styles for a light-DOM chat message, exported for the shadow scope that hosts the activity history: the message
 *  renders in light DOM, so the scope that contains it declares the rules. */
export const chatMessageStyles = css`
	shu-chat-message { display: block; }
	shu-chat-message .msg { cursor: pointer; }
	/* The message the reader is on: the same mark a page gives the current item of any list. */
	shu-chat-message[aria-current="true"] .msg { outline: 1px solid var(--shu-accent); outline-offset: 2px; border-radius: var(--shu-radius); }
	shu-chat-message .msg { display: grid; grid-template-columns: var(--shu-space-6) 1fr; }
	shu-chat-message .msg-label {
		font-size: var(--shu-font-sm);
		display: flex; flex-direction: column; align-items: center; gap: var(--shu-space-1);
		padding-top: var(--shu-space-2); user-select: text; color: var(--shu-fg-muted);
	}
	shu-chat-message[data-role="user"] { background: var(--shu-bg-elevated); }
	shu-chat-message[data-role="llm"] { background: var(--shu-bg-soft); }
	shu-chat-message .msg-content { min-width: 0; padding: var(--shu-space-2) var(--shu-space-3); }
	shu-chat-message .chat-prompt { font-weight: 600; padding: var(--shu-space-1) 0; white-space: pre-wrap; }
	/* The records the question carries, each a link to its record or type. */
	shu-chat-message .chat-carries { display: flex; flex-wrap: wrap; gap: var(--shu-space-2); font-size: var(--shu-font-sm); color: var(--shu-fg-muted); }
	shu-chat-message .chat-text { font-size: inherit; overflow-wrap: break-word; word-break: break-word; }
	shu-chat-message .chat-text p { margin: var(--shu-space-2) 0; }
	shu-chat-message .chat-text ul, shu-chat-message .chat-text ol { margin: var(--shu-space-2) 0; padding-left: var(--shu-space-6); }
	shu-chat-message .chat-text code, shu-chat-message .chat-text pre {
		background: var(--shu-bg-input); padding: var(--shu-space-1) var(--shu-space-2);
		border-radius: var(--shu-radius); font-size: inherit;
	}
	shu-chat-message .chat-text pre { padding: var(--shu-space-2) var(--shu-space-3); overflow-x: auto; }
	shu-chat-message .chat-error { color: var(--shu-error); font-size: inherit; white-space: pre-wrap; padding: var(--shu-space-2) 0; }
	/* What the turn was made of, each closed until a reader opens it: the context it sent, and the calls it made. */
	shu-chat-message .chat-made-of { font-size: var(--shu-font-sm); color: var(--shu-fg-muted); }
	shu-chat-message .chat-made-of summary { cursor: pointer; }
	shu-chat-message .chat-made-of ol { margin: var(--shu-space-1) 0; padding-inline-start: var(--shu-space-4); }
	shu-chat-message .chat-made-of li { white-space: pre-wrap; overflow-wrap: anywhere; }
`;

/** One half of a conversation turn. `turn` names the turn by its question's record. `id` is the keyed-render identity (never reused). Spinner/status/error are llm-only UI state. */
export const ChatMessageSchema = z.object({
	id: z.string(),
	role: ChatRoleSchema,
	text: z.string(),
	status: ChatStatusSchema.optional(),
	turn: z.string().optional(),
	spinnerStatus: z.string(),
	/** The lines of what the turn sent: its model and window, the records it carried and the context it read. */
	context: z.array(z.string()),
	/** The calls the turn made, each with the record of the call. */
	calls: z.array(CalledSchema),
	spinnerVisible: z.boolean(),
	spinnerSpinning: z.boolean(),
	/** Why the turn failed or stopped; unset for a turn that hasn't failed. */
	error: z.string().optional(),
	/** The handles the response states that the context its turn was sent doesn't hold; unset where the turn is verified. */
	unverified: z.array(z.string()).optional(),
	/** The id of the comment actuality recorded for this message. Selecting the message selects that comment. */
	recordId: z.string().optional(),
	/** The type of the records actuality records the conversation's messages as, which the transcript states. */
	recordType: z.string(),
	/** The context the turn carried, which selecting the message makes active again. */
	bundle: BundleSchema,
	/** The question record of the turn this message's turn replies to; unset for the turn that starts a session. */
	inReplyTo: z.string().optional(),
	/** Where another branch of the conversation leaves the branch shown at this reply: that branch's latest message, and
	 *  how many branches leave here. Set by the transcript for the message it shows. */
	otherBranch: z.object({ recordId: z.string(), turn: z.string(), bundle: BundleSchema, count: z.number().int().min(1) }).optional(),
});
export type TChatMessage = z.infer<typeof ChatMessageSchema>;

const ROLE_LABEL: Record<TChatRole, string> = { user: "🧘", llm: "🤖" };

/** The controls under a question's icon that fork the conversation at it, as each is named and described. */
export const FORK_CONTROLS = {
	fork: { label: "Fork", title: "Fork: ask it again as a new branch" },
	editAndFork: { label: "Edit and fork", title: "Edit and fork: change it, then send it as a new branch" },
} as const;

/** Activate a record of the conversation in the actions bar's scope, with the bundle that its turn carried. */
function activateRecord(label: string, id: string, turn: string, bundle: TBundle): void {
	dispatchSubjectEvent({ type: "activate", scope: SCOPE.actionsBar, entry: { record: { id, label }, turn, bundle } });
}

export class ShuChatMessage extends ShuElement<typeof EmptyStateSchema> {
	/** A control doesn't contribute to a conversation's context, since it isn't a view of data. */
	summarizeForContext(): TLinkedData | null {
		return null;
	}

	/** The message this element shows. The history sets it before the element renders. */
	@property({ attribute: false }) accessor message: TChatMessage | undefined;

	/** The message set on this element. An element rendered without one is a fault in the view that renders it. */
	private get shown(): TChatMessage {
		if (this.message === undefined) throw new Error(`<${SHU_TAG.CHAT_MESSAGE}> rendered without a message. Set its message property where the history renders it.`);
		return this.message;
	}

	constructor() {
		super(EmptyStateSchema);
	}

	/** Light DOM: parent column selectors must reach this element's children. */
	createRenderRoot(): HTMLElement {
		return this;
	}

	/** Follow the other branch that leaves at this reply: its latest message becomes the conversation's active comment,
	 *  and the transcript shows that branch. */
	private onOtherBranch = (e: Event): void => {
		e.stopPropagation(); // the click is on the control, not a selection of this message
		const other = this.shown.otherBranch;
		if (!other) return;
		activateRecord(this.shown.recordType, other.recordId, other.turn, other.bundle);
	};

	/** Fork the conversation at this question. It is sent again, as it was or after editing, as a reply to the turn the
	 *  original replied to, so it starts another branch. The actions bar that holds the history handles the event. */
	private fork =
		(send: boolean) =>
		(e: Event): void => {
			e.stopPropagation(); // the click is on the control, not a selection of this message
			const m = this.shown;
			const detail: TQuestionFork = { prompt: m.text, patterns: m.bundle.patterns, inReplyTo: m.inReplyTo, send };
			this.dispatchEvent(new CustomEvent(SHU_EVENT.QUESTION_FORK, { detail, bubbles: true, composed: true }));
		};

	/** Activate the comment this message was recorded as, with the bundle that its turn carried, in the actions bar's
	 *  scope. The graph follows that comment, and the next question replies to its turn. A message without a recorded
	 *  comment doesn't activate a comment. */
	private onSelect = (): void => {
		const m = this.shown;
		if (!m.recordId || !m.turn) return;
		activateRecord(m.recordType, m.recordId, m.turn, m.bundle);
	};

	render(): TemplateResult {
		const m = this.shown;
		// Host attributes reflect the message on each render, so a page reader selects a message by its state.
		const reflected: Array<[string, string | undefined]> = [
			[SHU_ATTR.DATA_ROLE, m.role],
			[SHU_ATTR.DATA_STATUS, m.status],
			[SHU_ATTR.DATA_RECORD, m.recordId],
		];
		for (const [name, value] of reflected) {
			if (value) this.setAttribute(name, value);
			else this.removeAttribute(name);
		}
		return html`
			<div class="msg" @click=${this.onSelect}>
				<span class="msg-label">
					${m.recordId ? recordRef(m.recordType, m.recordId, ROLE_LABEL[m.role], SHU_TEST_IDS.APP.CHAT_RECORD) : ROLE_LABEL[m.role]}
					${
						m.role === "user" && m.recordId && m.text
							? html`<button type="button" title=${FORK_CONTROLS.fork.title} aria-label=${FORK_CONTROLS.fork.label} data-testid=${SHU_TEST_IDS.APP.CHAT_FORK} @click=${this.fork(true)}>⑂</button>
									<button type="button" title=${FORK_CONTROLS.editAndFork.title} aria-label=${FORK_CONTROLS.editAndFork.label} data-testid=${SHU_TEST_IDS.APP.CHAT_EDIT} @click=${this.fork(false)}>✎</button>`
							: ""
					}
				</span>
				<div class="msg-content">
					${m.role === "user" ? html`<div class="chat-prompt">${m.text}</div>` : ""}
					${
						m.role === "user" && m.bundle.patterns.length > 0
							? html`<div class="chat-carries" data-testid=${SHU_TEST_IDS.APP.CHAT_CARRIES}>about ${m.bundle.patterns.map(patternRef)}</div>`
							: ""
					}
					${m.role === "llm" ? html`<shu-spinner .status=${proseText(m.spinnerStatus, refContext)} .visible=${m.spinnerVisible} .spinning=${m.spinnerSpinning}></shu-spinner>` : ""}
					${
						// What the response was made of reads before the response: the context the turn carried and the calls it
						// made come first in time, and a reader weighing the response reads them first.
						m.context.length > 0
							? html`<details class="chat-made-of" data-testid=${SHU_TEST_IDS.APP.CHAT_CONTEXT}>
								<summary>context sent (${m.context.length} lines)</summary>
								<ol>${guard([m.context.join("\n")], () => m.context.map((line) => html`<li>${unsafeHTML(renderRefProse(line, refContext))}</li>`))}</ol>
							</details>`
							: ""
					}
					${
						m.calls.length > 0
							? html`<details class="chat-made-of" data-testid=${SHU_TEST_IDS.APP.CHAT_CALLS}>
								<summary>calls (${m.calls.length})</summary>
								<ol>${m.calls.map(({ name, ok, record }) => html`<li>${recordRef(record.persistedAs, record.id, `${ok ? ICON_STEP_COMPLETED : RETURNED_TO_CALLER} ${name}`)}</li>`)}</ol>
							</details>`
							: ""
					}
					${m.role === "llm" && m.text ? html`<div class="chat-text" data-testid="app-chat-text">${unsafeHTML(renderRefAnswer(m.text, refContext))}</div>` : ""}
					${m.error ? html`<div class="chat-error">${m.error}</div>` : ""}
					${m.unverified !== undefined && m.unverified.length > 0 ? html`<div class="chat-unverified" data-testid="app-chat-unverified">${UNVERIFIED_TURN}: ${m.unverified.join(", ")}</div>` : ""}
					${
						m.otherBranch
							? html`<button class="other-branch" data-testid=${SHU_TEST_IDS.APP.CHAT_OTHER_BRANCH} @click=${this.onOtherBranch}>
									${m.otherBranch.count === 1 ? "another branch continues from here" : `${m.otherBranch.count} other branches continue from here`}
								</button>`
							: ""
					}
				</div>
			</div>
		`;
	}
}

defineElement(SHU_TAG.CHAT_MESSAGE, ShuChatMessage);
