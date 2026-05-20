import { z } from "zod";
import MarkdownIt from "markdown-it";
import { ShuElement } from "./shu-element.js";
import type { ShuSpinner } from "./shu-spinner.js";

const ChatRoleSchema = z.enum(["user", "llm"]);
export type TChatRole = z.infer<typeof ChatRoleSchema>;
const ChatStatusSchema = z.enum(["running", "completed", "failed", "aborted"]);
export type TChatStatus = z.infer<typeof ChatStatusSchema>;

const ChatMessageSchema = z.object({
	role: ChatRoleSchema,
});

const ROLE_LABEL: Record<TChatRole, string> = { user: "🧘", llm: "🤖" };

const md = new MarkdownIt();

export class ShuChatMessage extends ShuElement<typeof ChatMessageSchema> {
	private _initialized = false;
	private _promptText = "";
	private _accumulatedText = "";
	private _spinnerStatus = "";
	private _spinnerVisible = false;
	private _spinnerSpinning = true;
	private _errorMessage = "";
	private _renderPending = false;

	constructor() {
		super(ChatMessageSchema, { role: "user" }, { lightDom: true });
	}

	init(role: TChatRole): void {
		if (this._initialized) throw new Error(`shu-chat-message: init called twice (existing role="${this.state.role}", new role="${role}")`);
		this._initialized = true;
		this.setState({ role });
		this.setAttribute("data-role", role);
	}

	setStatus(status: TChatStatus): void {
		this.setAttribute("data-status", status);
	}

	setSeqPath(seqPath: readonly number[]): void {
		this.setAttribute("data-seqpath", seqPath.join("."));
	}

	setPromptText(prompt: string): void {
		if (this.state.role !== "user") throw new Error(`shu-chat-message.setPromptText: only valid on role="user", got "${this.state.role}"`);
		this._promptText = prompt;
		this.render();
	}

	setSpinnerStatus(status: string): void {
		if (this.state.role !== "llm") throw new Error(`shu-chat-message.setSpinnerStatus: only valid on role="llm", got "${this.state.role}"`);
		this._spinnerStatus = status;
		this._spinnerVisible = true;
		this._spinnerSpinning = true;
		this.applySpinnerState();
	}

	stopSpinningKeepVisible(): void {
		if (this.state.role !== "llm") throw new Error(`shu-chat-message.stopSpinningKeepVisible: only valid on role="llm", got "${this.state.role}"`);
		this._spinnerVisible = true;
		this._spinnerSpinning = false;
		this.applySpinnerState();
	}

	finishSpinner(): void {
		if (this.state.role !== "llm") throw new Error(`shu-chat-message.finishSpinner: only valid on role="llm", got "${this.state.role}"`);
		this._spinnerVisible = false;
		this._spinnerSpinning = false;
		this.applySpinnerState();
	}

	appendStreamText(chunk: string): void {
		if (this.state.role !== "llm") throw new Error(`shu-chat-message.appendStreamText: only valid on role="llm", got "${this.state.role}"`);
		this._accumulatedText += chunk;
		if (this._renderPending) return;
		this._renderPending = true;
		requestAnimationFrame(() => {
			this._renderPending = false;
			this.applyTextContent();
			this.spinnerEl()?.pulse?.();
		});
	}

	fullText(): string {
		return this._accumulatedText;
	}

	finalizeText(): void {
		this.applyTextContent();
	}

	showError(message: string): void {
		this._errorMessage = message;
		this._spinnerVisible = false;
		this.applyErrorContent();
		this.applySpinnerState();
	}

	private spinnerEl(): ShuSpinner | null {
		return this.querySelector(":scope > .msg > .msg-content > shu-spinner") as ShuSpinner | null;
	}

	private applySpinnerState(): void {
		const spinner = this.spinnerEl();
		if (!spinner) return;
		spinner.status = this._spinnerStatus;
		spinner.visible = this._spinnerVisible;
		spinner.spinning = this._spinnerSpinning;
	}

	private applyTextContent(): void {
		if (!this._accumulatedText) return;
		const content = this.querySelector(":scope > .msg > .msg-content");
		if (!content) return;
		let textDiv = content.querySelector(":scope > .chat-text") as HTMLDivElement | null;
		if (!textDiv) {
			textDiv = document.createElement("div");
			textDiv.className = "chat-text";
			content.appendChild(textDiv);
		}
		textDiv.innerHTML = md.render(this._accumulatedText);
	}

	private applyErrorContent(): void {
		if (!this._errorMessage) return;
		const content = this.querySelector(":scope > .msg > .msg-content");
		if (!content) return;
		let errEl = content.querySelector(":scope > .chat-error") as HTMLDivElement | null;
		if (!errEl) {
			errEl = document.createElement("div");
			errEl.className = "chat-error";
			content.appendChild(errEl);
		}
		errEl.textContent = this._errorMessage;
	}

	protected render(): void {
		const role = this.state.role;
		this.setAttribute("data-role", role);
		const labelText = ROLE_LABEL[role];
		const promptHtml = role === "user" ? `<div class="chat-prompt"></div>` : "";
		const spinnerHtml = role === "llm" ? `<shu-spinner></shu-spinner>` : "";
		this.innerHTML = `<div class="msg">
				<span class="msg-label">${labelText}</span>
				<div class="msg-content">${promptHtml}${spinnerHtml}</div>
			</div>`;
		if (role === "user") {
			const promptEl = this.querySelector(":scope > .msg > .msg-content > .chat-prompt") as HTMLDivElement | null;
			if (promptEl) promptEl.textContent = this._promptText;
		} else {
			this.applyTextContent();
			this.applyErrorContent();
			this.applySpinnerState();
		}
	}
}

customElements.define("shu-chat-message", ShuChatMessage);
