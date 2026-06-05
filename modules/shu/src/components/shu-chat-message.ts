/**
 * <shu-chat-message> — one user prompt or one LLM response in the chat column.
 * Purely prop-driven: the parent (shu-kihan-chat) owns the single conversation
 * state and passes one TChatMessage; this element renders it. No imperative
 * mutators — both the live stream and a hydrated session write the same parent
 * state, so there is one render path. Lives in light DOM so the parent column's
 * selection/scroll styles cascade through.
 */
import { html, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { z } from "zod";
import MarkdownIt from "markdown-it";
import { ShuElement } from "./shu-element.js";
import type { ShuSpinner } from "./shu-spinner.js";

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
