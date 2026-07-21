/**
 * <shu-chat-message> — one user prompt or one LLM response in the chat column.
 * Purely prop-driven: the parent (shu-kihan-chat) owns the single conversation
 * state and passes one TChatMessage; this element renders it. No imperative
 * mutators — both the live stream and a hydrated session write the same parent
 * state, so there is one render path. Lives in light DOM so the parent column's
 * selection/scroll styles cascade through.
 */
import { css, html, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { z } from "zod";
import MarkdownIt from "markdown-it";
import { ShuElement } from "./shu-element.js";
import type { ShuSpinner } from "./shu-spinner.js";

/** Styles for a light-DOM chat message, exported for every shadow scope that hosts one (shu-kihan-chat's own
 * transcript, and the actions bar's shared activity history) — the message renders in light DOM, so the rules
 * must live in whichever scope contains it, and this single export keeps the two scopes from drifting. */
export const chatMessageStyles = css`
	shu-chat-message { display: block; }
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
`;

export const ChatRoleSchema = z.enum(["user", "llm"]);
export type TChatRole = z.infer<typeof ChatRoleSchema>;
export const ChatStatusSchema = z.enum(["running", "completed", "failed", "aborted"]);
export type TChatStatus = z.infer<typeof ChatStatusSchema>;

/** One half of a conversation turn. `seqPath` is the graph identity — cmt-ask/cmt-say-<seqPath> — so a rendered message links back to its Comment quads / run trace. `id` is the keyed-render identity (never reused). Spinner/status/error are llm-only UI state. */
export const ChatMessageSchema = z.object({
	id: z.string(),
	role: ChatRoleSchema,
	text: z.string().default(""),
	status: ChatStatusSchema.optional(),
	seqPath: z.string().optional(),
	spinnerStatus: z.string().default(""),
	spinnerVisible: z.boolean().default(false),
	spinnerSpinning: z.boolean().default(true),
	error: z.string().default(""),
});
export type TChatMessage = z.infer<typeof ChatMessageSchema>;

const EmptySchema = z.object({});
const ROLE_LABEL: Record<TChatRole, string> = { user: "🧘", llm: "🤖" };
const md = new MarkdownIt();

export class ShuChatMessage extends ShuElement<typeof EmptySchema> {
	/** A control, not a view of data — contributes nothing to the Kihan's context. */
	summarizeForKihan(): unknown | null {
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

	protected updated(): void {
		// Spinner is a sibling custom element; sync its imperative props from the message. Only assign on change — the status setter re-pulses, and the parent re-renders every streamed-text frame, so unconditional assignment would restart the pulse animation ~60×/s.
		const spinner = this.querySelector(":scope > .msg > .msg-content > shu-spinner") as ShuSpinner | null;
		if (!spinner) return;
		const m = this.message;
		if (spinner.status !== m.spinnerStatus) spinner.status = m.spinnerStatus;
		if (spinner.visible !== m.spinnerVisible) spinner.visible = m.spinnerVisible;
		if (spinner.spinning !== m.spinnerSpinning) spinner.spinning = m.spinnerSpinning;
	}

	render(): TemplateResult {
		const m = this.message;
		// data-role/status/seqpath are host attributes the e2e selects on (e.g. [data-status='completed'], data-seqpath); reflect them from the message each render.
		this.setAttribute("data-role", m.role);
		if (m.status) this.setAttribute("data-status", m.status);
		else this.removeAttribute("data-status");
		if (m.seqPath) this.setAttribute("data-seqpath", m.seqPath);
		else this.removeAttribute("data-seqpath");
		return html`
			<div class="msg">
				<span class="msg-label">${ROLE_LABEL[m.role]}</span>
				<div class="msg-content">
					${m.role === "user" ? html`<div class="chat-prompt">${m.text}</div>` : ""}
					${m.role === "llm" ? html`<shu-spinner></shu-spinner>` : ""}
					${m.role === "llm" && m.text ? html`<div class="chat-text" data-testid="app-chat-text">${unsafeHTML(md.render(m.text))}</div>` : ""}
					${m.error ? html`<div class="chat-error">${m.error}</div>` : ""}
				</div>
			</div>
		`;
	}
}

customElements.define("shu-chat-message", ShuChatMessage);
