/**
 * <shu-chat-message>: one user prompt or one LLM response in the chat column.
 * Purely prop-driven: the parent (shu-kihan-chat) owns the single conversation
 * state and passes one TChatMessage; this element renders it. No imperative
 * mutators: both the live stream and a hydrated session write the same parent
 * state, so there is one render path. Lives in light DOM so the parent column's
 * selection/scroll styles cascade through.
 */
import { css, html, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { z } from "zod";
import MarkdownIt from "markdown-it";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import type { ShuSpinner } from "./shu-spinner.js";
import { COMMENT_LABEL } from "@haibun/core/lib/resources.js";
import { SCOPE, dispatchSubjectEvent } from "../current-subject.js";
import { SHU_ATTR, SHU_TAG } from "../consts.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { BundleSchema, ChatRoleSchema, ChatStatusSchema, type TBundle, type TChatRole } from "../schemas.js";

/** Styles for a light-DOM chat message, exported for every shadow scope that hosts one (shu-kihan-chat's own
 * transcript, and the actions bar's shared activity history): the message renders in light DOM, so the rules
 * must live in whichever scope contains it, and this single export keeps the two scopes from drifting. */
export const chatMessageStyles = css`
	shu-chat-message { display: block; }
	shu-chat-message .msg { cursor: pointer; }
	/* The message the reader is on: the same mark a page gives the current item of any list. */
	shu-chat-message[aria-current="true"] .msg { outline: 1px solid var(--shu-accent); outline-offset: 2px; border-radius: var(--shu-radius); }
	shu-chat-message .msg { display: grid; grid-template-columns: var(--shu-space-6) 1fr; }
	shu-chat-message .msg-label {
		font-size: var(--shu-font-sm);
		display: flex; align-items: flex-start; justify-content: center;
		padding-top: var(--shu-space-2); user-select: text; color: var(--shu-fg-muted);
	}
	shu-chat-message[data-role="user"] { background: var(--shu-bg-elevated); }
	shu-chat-message[data-role="llm"] { background: var(--shu-bg-soft); }
	shu-chat-message .msg-content { min-width: 0; padding: var(--shu-space-2) var(--shu-space-3); }
	shu-chat-message .chat-prompt { font-weight: 600; padding: var(--shu-space-1) 0; white-space: pre-wrap; }
	shu-chat-message .chat-text { font-size: inherit; overflow-wrap: break-word; word-break: break-word; }
	shu-chat-message .chat-text p { margin: var(--shu-space-2) 0; }
	shu-chat-message .chat-text ul, shu-chat-message .chat-text ol { margin: var(--shu-space-2) 0; padding-left: var(--shu-space-6); }
	shu-chat-message .chat-text code, shu-chat-message .chat-text pre {
		background: var(--shu-bg-input); padding: var(--shu-space-1) var(--shu-space-2);
		border-radius: var(--shu-radius); font-size: inherit;
	}
	shu-chat-message .chat-text pre { padding: var(--shu-space-2) var(--shu-space-3); overflow-x: auto; }
	shu-chat-message .chat-error { color: var(--shu-error); font-size: inherit; white-space: pre-wrap; padding: var(--shu-space-2) 0; }
	/* What the turn was made of, closed until a reader opens it: the context it sent and every call it made. */
	shu-chat-message .chat-activity { font-size: var(--shu-font-sm); color: var(--shu-fg-muted); }
	shu-chat-message .chat-activity summary { cursor: pointer; }
	shu-chat-message .chat-activity ol { margin: var(--shu-space-1) 0; padding-inline-start: var(--shu-space-4); }
	shu-chat-message .chat-activity li { white-space: pre-wrap; overflow-wrap: anywhere; }
`;

/** One half of a conversation turn. `seqPath` is the graph identity, cmt-ask/cmt-say-<seqPath>, so a rendered message links back to its Comment quads / run trace. `id` is the keyed-render identity (never reused). Spinner/status/error are llm-only UI state. */
export const ChatMessageSchema = z.object({
	id: z.string(),
	role: ChatRoleSchema,
	text: z.string().default(""),
	status: ChatStatusSchema.optional(),
	seqPath: z.string().optional(),
	spinnerStatus: z.string().default(""),
	/** Everything the turn stated about itself, in order: the context it sent, each tool it dispatched, what it took.
	 *  The spinner shows the latest of these; this keeps them, so a reader can read what the answer was made of. */
	activity: z.array(z.string()).default([]),
	spinnerVisible: z.boolean().default(false),
	spinnerSpinning: z.boolean().default(true),
	error: z.string().default(""),
	/** The id of the comment the run recorded for this message. Selecting the message selects that comment. */
	recordId: z.string().optional(),
	/** The context the turn was sent with, which selecting the message makes active again. */
	bundle: BundleSchema.optional(),
	/** The seqPath of the turn this message's turn replies to; unset for the turn that starts a session. */
	inReplyTo: z.string().optional(),
	/** Where another branch of the conversation leaves the branch shown at this reply: that branch's latest message, and
	 *  how many branches leave here. Set by the transcript for the message it shows. */
	otherBranch: z.object({ recordId: z.string(), seqPath: z.string(), bundle: BundleSchema, count: z.number().int().min(1) }).optional(),
});
export type TChatMessage = z.infer<typeof ChatMessageSchema>;

const EmptySchema = z.object({});
const ROLE_LABEL: Record<TChatRole, string> = { user: "🧘", llm: "🤖" };
const md = new MarkdownIt();

/** Activate a comment of the conversation in the actions bar's scope, with the bundle its turn was sent with. */
function activateComment(id: string, seqPath: string, bundle: TBundle): void {
	dispatchSubjectEvent({ type: "activate", scope: SCOPE.actionsBar, entry: { record: { id, label: COMMENT_LABEL }, seqPath, bundle } });
}

export class ShuChatMessage extends ShuElement<typeof EmptySchema> {
	/** A control, not a view of data, contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	@property({ attribute: false }) accessor message: TChatMessage = ChatMessageSchema.parse({ id: "", role: "user" });

	constructor() {
		super(EmptySchema, {});
	}

	/** Light DOM: parent column selectors must reach this element's children. */
	createRenderRoot(): HTMLElement {
		return this;
	}

	/** Follow the other branch that leaves at this reply: its latest message becomes the conversation's active comment,
	 *  and the transcript shows that branch. */
	private onOtherBranch = (e: Event): void => {
		e.stopPropagation(); // the click is on the control, not a selection of this message
		const other = this.message.otherBranch;
		if (!other) return;
		activateComment(other.recordId, other.seqPath, other.bundle);
	};

	/** Activate the comment this message was recorded as, with the bundle its turn was sent with, in the actions bar's
	 *  scope. The graph follows that comment, and the next question replies to its turn. A message with no recorded
	 *  comment activates nothing. */
	private onSelect = (): void => {
		const m = this.message;
		if (!m.recordId || !m.seqPath || !m.bundle) return;
		activateComment(m.recordId, m.seqPath, m.bundle);
	};

	protected updated(): void {
		// Spinner is a sibling custom element; sync its imperative props from the message. Only assign on change: the status setter re-pulses, and the parent re-renders every streamed-text frame, so unconditional assignment would restart the pulse animation ~60×/s.
		const spinner = this.querySelector(":scope > .msg > .msg-content > shu-spinner") as ShuSpinner | null;
		if (!spinner) return;
		const m = this.message;
		if (spinner.status !== m.spinnerStatus) spinner.status = m.spinnerStatus;
		if (spinner.visible !== m.spinnerVisible) spinner.visible = m.spinnerVisible;
		if (spinner.spinning !== m.spinnerSpinning) spinner.spinning = m.spinnerSpinning;
	}

	render(): TemplateResult {
		const m = this.message;
		// Host attributes reflect the message on each render, so a page reader selects a message by its state.
		const reflected: Array<[string, string | undefined]> = [
			[SHU_ATTR.DATA_ROLE, m.role],
			[SHU_ATTR.DATA_STATUS, m.status],
			[SHU_ATTR.DATA_SEQPATH, m.seqPath],
			[SHU_ATTR.DATA_RECORD, m.recordId],
		];
		for (const [name, value] of reflected) {
			if (value) this.setAttribute(name, value);
			else this.removeAttribute(name);
		}
		return html`
			<div class="msg" @click=${this.onSelect}>
				<span class="msg-label">${ROLE_LABEL[m.role]}</span>
				<div class="msg-content">
					${m.role === "user" ? html`<div class="chat-prompt">${m.text}</div>` : ""}
					${m.role === "llm" ? html`<shu-spinner></shu-spinner>` : ""}
					${
						// What the answer was made of reads before the answer: the context it was sent and the calls it made
						// come first in time, and a reader weighing the answer reads them first.
						m.activity.length > 0
							? html`<details class="chat-activity" data-testid="app-chat-activity">
								<summary>context and calls (${m.activity.length})</summary>
								<ol>${m.activity.map((line) => html`<li>${line}</li>`)}</ol>
							</details>`
							: ""
					}
					${m.role === "llm" && m.text ? html`<div class="chat-text" data-testid="app-chat-text">${unsafeHTML(md.render(m.text))}</div>` : ""}
					${m.error ? html`<div class="chat-error">${m.error}</div>` : ""}
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

customElements.define(SHU_TAG.CHAT_MESSAGE, ShuChatMessage);
