/**
 * Chat surface for talking to a Kihan. Threads via AS:context + discourse
 * sub-properties of inReplyTo — the first turn's prompt is the session root;
 * every subsequent turn carries `as:context → root` and a `question` edge
 * from the new prompt → the prior reply. Both are forwarded in the envelope
 * so the server writes the edges on receipt.
 */
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { ShuChatMessage } from "./shu-chat-message.js";
import type { ShuCombobox } from "./shu-combobox.js";
import { Access } from "@haibun/core/lib/resources.js";
import { SHARED_STYLES } from "./styles.js";
import { errMsg } from "../util.js";
import { SseClient, inAction } from "../sse-client.js";
import { findStep, getAvailableSteps, requireStep } from "../rpc-registry.js";
import { getSiteMetadataSync } from "../rels-cache.js";
import { getCookie, setCookie } from "../cookies.js";
import type { TContextPattern, TSearchCondition } from "../schemas.js";

const MODEL_COOKIE = "shu-model";
const TOOL_LIMIT_COOKIE = "shu-tool-limit";
const TOOL_LIMIT_DEFAULT = 5;
const TOOL_LIMIT_MIN = 0;
const TOOL_LIMIT_MAX = 99;

function readToolLimitCookie(): number {
	const raw = getCookie(TOOL_LIMIT_COOKIE);
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n)) return TOOL_LIMIT_DEFAULT;
	return Math.max(TOOL_LIMIT_MIN, Math.min(TOOL_LIMIT_MAX, n));
}

const ChatSchema = z.object({});

export class ShuKihanChat extends ShuElement<typeof ChatSchema> {
	static schema = ChatSchema;
	static domainSelector = "shu-kihan-chat";

	private _models: Array<{ id: string }> = [];
	private _selectedModel = "";
	private _toolLimit: number = readToolLimitCookie();
	private _lastPrompt = "";
	private _fullText = "";
	private _abortController: AbortController | null = null;
	private _sessionSeqPath: string | null = null;
	private _lastReplySeqPath: string | null = null;

	private _contextPatterns: TContextPattern[] = [];
	private _contextAccessLevel: string = Access.private;
	private _selectedLabel = "";
	private _filterConditions: TSearchCondition[] = [];
	private _textSearch = "";

	static observedAttributes = ["testid-prefix"];

	private get testIdPrefix(): string {
		return this.getAttribute("testid-prefix") || "";
	}

	private tid(id: string): string {
		return `data-testid="${this.testIdPrefix}${id}"`;
	}

	constructor() {
		super(ChatSchema, {});
	}

	connectedCallback(): void {
		super.connectedCallback();
		void this.loadModels();
	}

	setContext(
		patterns: TContextPattern[],
		accessLevel: string,
		extra?: { label?: string; textQuery?: string; conditions?: TSearchCondition[] },
	): void {
		this._contextPatterns = patterns;
		this._contextAccessLevel = accessLevel;
		if (extra?.label !== undefined) this._selectedLabel = extra.label;
		if (extra?.textQuery !== undefined) this._textSearch = extra.textQuery;
		if (extra?.conditions !== undefined) this._filterConditions = extra.conditions;
	}

	private activeChatContext(): { patterns: TContextPattern[]; viewLd: unknown[]; maxToolCalls: number; sessionSeqPath?: string; inReplyTo?: string } {
		const envelope: { patterns: TContextPattern[]; viewLd: unknown[]; maxToolCalls: number; sessionSeqPath?: string; inReplyTo?: string } = {
			patterns: this._contextPatterns,
			viewLd: this.harvestJsonLdFromActivePane(),
			maxToolCalls: this._toolLimit,
		};
		if (this._sessionSeqPath) envelope.sessionSeqPath = this._sessionSeqPath;
		if (this._lastReplySeqPath) envelope.inReplyTo = this._lastReplySeqPath;
		return envelope;
	}

	private harvestJsonLdFromActivePane(): unknown[] {
		const strip = document.querySelector("shu-column-strip");
		if (!strip) return [];
		const activeIdx = (strip as unknown as { state?: { activeIndex?: number } }).state?.activeIndex ?? -1;
		if (activeIdx < 0) return [];
		const panes = Array.from(strip.querySelectorAll("shu-column-pane"));
		const pane = panes[activeIdx];
		if (!pane) return [];
		const blocks: unknown[] = [];
		const collect = (root: ParentNode) => {
			for (const el of Array.from(root.querySelectorAll('script[type="application/ld+json"]'))) {
				const txt = el.textContent ?? "";
				if (!txt) throw new Error("shu-llm-chat: encountered an empty <script type=application/ld+json> in the active pane — the view's render must emit valid JSON-LD or omit the script tag");
				blocks.push(JSON.parse(txt));
			}
		};
		collect(pane);
		const child = pane.firstElementChild;
		if (child?.shadowRoot) collect(child.shadowRoot);
		return blocks;
	}

	private async loadModels(): Promise<void> {
		if (this._models.length > 0) return;
		await getAvailableSteps();
		if (!findStep("showKihans")) return;
		const client = SseClient.for("");
		const data = await inAction((scope) => client.rpc<{ vertices: Array<{ id: string }> }>(scope, requireStep("showKihans")));
		if (data.vertices) {
			this._models = data.vertices;
			if (this._models.length > 0 && !this._selectedModel) {
				const preferred = getCookie(MODEL_COOKIE);
				const match = preferred && this._models.find((m) => m.id === preferred);
				this._selectedModel = match ? match.id : this._models[0].id;
			}
			this.render();
		}
	}

	private _detachedChatOutput: Element | null = null;
	private _pendingChatInput = "";

	protected render(): void {
		if (!this.shadowRoot) return;

		const liveOutput = this.shadowRoot.querySelector(".chat-output");
		if (liveOutput) {
			this._detachedChatOutput = liveOutput;
			liveOutput.remove();
		}
		const liveInput = this.shadowRoot.querySelector(".chat-input") as HTMLTextAreaElement | null;
		if (liveInput && typeof liveInput.value === "string" && liveInput.value.length > 0) {
			this._pendingChatInput = liveInput.value;
		}

		const modelSelect = this._models.length > 0
			? `<shu-combobox class="model-select" testid="${this.testIdPrefix}model-select" placeholder="model..."></shu-combobox>`
			: "";
		const uiExtensions = Object.values(getSiteMetadataSync()?.ui || {})
			.filter((ui) => ui.slot === "action-bar-chat")
			.map((ui) => `<${ui.component}></${ui.component}>`)
			.join("");
		this.shadowRoot.innerHTML = `
			${this.css(SHARED_STYLES)}
			${this.css(STYLES)}
			<div class="chat-output" ${this.tid("chat-output")}></div>
			<div class="input-line">
				<slot name="mode-toggle"></slot>
				<textarea class="chat-input" placeholder="Ask about this..." ${this.tid("chat-input")} rows="1" autofocus></textarea>
				${modelSelect}
				<label class="tool-limit-label" title="Max chained tool calls the model may run before asking you to confirm the next one. 0 means every tool call needs confirmation.">
					<span>tool calls</span>
					<input class="tool-limit" type="number" min="${TOOL_LIMIT_MIN}" max="${TOOL_LIMIT_MAX}" step="1" value="${this._toolLimit}" ${this.tid("tool-limit")}>
				</label>
				${uiExtensions}
				<button type="submit" class="send-btn" ${this.tid("chat-submit")}>Send</button>
				<button type="button" class="stop-btn" ${this.tid("chat-stop")} style="display:none">Stop</button>
				<button type="button" class="save-btn" ${this.tid("save-summary")} style="display:none">Save</button>
			</div>
		`;

		if (this._detachedChatOutput) {
			const slot = this.shadowRoot.querySelector(".chat-output");
			if (slot) slot.replaceWith(this._detachedChatOutput);
			this._detachedChatOutput = null;
		}
		const freshInput = this.shadowRoot.querySelector(".chat-input") as HTMLTextAreaElement | null;
		if (freshInput && this._pendingChatInput.length > 0) {
			freshInput.value = this._pendingChatInput;
			this._pendingChatInput = "";
		}

		this.wireListeners();
	}

	private wireListeners(): void {
		const modelCombo = this.shadowRoot?.querySelector(".model-select") as ShuCombobox | null;
		if (modelCombo) {
			modelCombo.setOptions(this._models.map((m) => ({ value: m.id, label: m.id })));
			if (this._selectedModel) modelCombo.setValue(this._selectedModel);
		}
		modelCombo?.addEventListener("combo-change", ((e: CustomEvent) => {
			this._selectedModel = e.detail?.value || "";
			setCookie(MODEL_COOKIE, this._selectedModel);
		}) as EventListener);

		const toolLimitInput = this.shadowRoot?.querySelector(".tool-limit") as HTMLInputElement | null;
		toolLimitInput?.addEventListener("change", () => {
			const raw = Number.parseInt(toolLimitInput.value, 10);
			const clamped = Number.isFinite(raw) ? Math.max(TOOL_LIMIT_MIN, Math.min(TOOL_LIMIT_MAX, raw)) : TOOL_LIMIT_DEFAULT;
			this._toolLimit = clamped;
			toolLimitInput.value = String(clamped);
			setCookie(TOOL_LIMIT_COOKIE, String(clamped));
		});

		const chatInput = this.shadowRoot?.querySelector(".chat-input") as HTMLTextAreaElement | null;
		chatInput?.addEventListener("input", () => {
			if (chatInput) {
				chatInput.style.height = "auto";
				chatInput.style.height = `${chatInput.scrollHeight}px`;
			}
		});
		const submit = () => {
			if (chatInput?.value) {
				const value = chatInput.value;
				chatInput.value = "";
				chatInput.style.height = "auto";
				void this.handleChat(value);
			}
		};
		chatInput?.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				submit();
			}
		});
		this.shadowRoot?.querySelector(".send-btn")?.addEventListener("click", submit);
		this.shadowRoot?.querySelector(".stop-btn")?.addEventListener("click", () => {
			this._abortController?.abort();
		});
		this.shadowRoot?.querySelector(".save-btn")?.addEventListener("click", () => {
			void this.handleSave();
		});
	}

	private async handleChat(prompt: string): Promise<void> {
		await getAvailableSteps();
		const output = this.shadowRoot?.querySelector(".chat-output") as HTMLElement | null;
		if (!output) return;

		this._lastPrompt = prompt;
		this._fullText = "";
		this._abortController = new AbortController();

		const saveBtn = this.shadowRoot?.querySelector(".save-btn") as HTMLElement | null;
		if (saveBtn) saveBtn.style.display = "none";
		const stopBtn = this.shadowRoot?.querySelector(".stop-btn") as HTMLElement | null;
		if (stopBtn) stopBtn.style.display = "";

		const userMsg = document.createElement("shu-chat-message");
		if (!(userMsg instanceof ShuChatMessage)) throw new Error("shu-chat-message custom element is not registered");
		userMsg.init("user");
		output.appendChild(userMsg);
		userMsg.setPromptText(prompt);

		const aiMsg = document.createElement("shu-chat-message");
		if (!(aiMsg instanceof ShuChatMessage)) throw new Error("shu-chat-message custom element is not registered");
		aiMsg.init("llm");
		aiMsg.setStatus("running");
		output.appendChild(aiMsg);
		aiMsg.setSpinnerStatus("Sending...");

		const abortSignal = this._abortController.signal;
		let turnSeqPath: string | null = null;
		try {
			const client = SseClient.for("");
			await inAction((scope) =>
				client.rpcStream(
					scope,
					requireStep("chatWithContext"),
					{
						prompt,
						context: JSON.stringify(this.activeChatContext()),
						accessLevel: this._contextAccessLevel,
						target: this._selectedModel,
					},
					(chunk: unknown) => {
						const data = chunk as Record<string, unknown>;
						if (data.status) aiMsg.setSpinnerStatus(String(data.status));
						if (data.text) aiMsg.appendStreamText(String(data.text));
						if (data.error) aiMsg.showError(String(data.error));
					},
					abortSignal,
					(seqPath) => {
						aiMsg.setSeqPath(seqPath);
						turnSeqPath = seqPath.join(".");
					},
				),
			);
			this._fullText = aiMsg.fullText();
			if (this._fullText) {
				if (saveBtn) saveBtn.style.display = "";
				aiMsg.finalizeText();
			}
			aiMsg.setStatus("completed");
			if (turnSeqPath) {
				if (!this._sessionSeqPath) this._sessionSeqPath = turnSeqPath;
				this._lastReplySeqPath = turnSeqPath;
			}
		} catch (err) {
			if (this._abortController.signal.aborted) {
				aiMsg.setSpinnerStatus("Stopped");
				aiMsg.stopSpinningKeepVisible();
				aiMsg.setStatus("aborted");
			} else {
				aiMsg.showError(errMsg(err));
				aiMsg.setStatus("failed");
			}
		} finally {
			const aborted = this._abortController?.signal.aborted;
			if (stopBtn) stopBtn.style.display = "none";
			if (!aborted) aiMsg.finishSpinner();
			if (this._fullText && !aborted) {
				this.shadowRoot?.querySelectorAll<HTMLElement>("shu-voice-client").forEach((el) => {
					const maybeSpeak = (el as { speak?: unknown }).speak;
					if (typeof maybeSpeak === "function") maybeSpeak.call(el, this._fullText);
				});
			}
			this._abortController = null;
		}
		output.scrollTop = output.scrollHeight;
	}

	private async handleSave(): Promise<void> {
		if (!this._fullText || !this._lastPrompt) return;
		await getAvailableSteps();
		const saveBtn = this.shadowRoot?.querySelector(".save-btn") as HTMLButtonElement | null;
		if (saveBtn) {
			saveBtn.disabled = true;
			saveBtn.textContent = "Saving...";
		}
		try {
			const client = SseClient.for("");
			await inAction((scope) =>
				client.rpc(scope, requireStep("saveSummary"), {
					topic: this._lastPrompt.slice(0, 80),
					content: this._fullText,
					prompt: this._lastPrompt,
					conditions: {
						conditions: this._filterConditions,
						label: this._selectedLabel,
						textQuery: this._textSearch,
					},
					accessLevel: this._contextAccessLevel || Access.private,
				}),
			);
			if (saveBtn) saveBtn.textContent = "Saved";
		} catch (err) {
			if (saveBtn) {
				saveBtn.disabled = false;
				saveBtn.textContent = "Save";
			}
			const output = this.shadowRoot?.querySelector(".chat-output") as HTMLElement | null;
			if (output) {
				const errEl = document.createElement("div");
				errEl.className = "chat-error";
				errEl.textContent = `Save failed: ${errMsg(err)}`;
				output.appendChild(errEl);
			}
		}
	}
}

const STYLES = `
	:host { display: flex; flex-direction: column; min-width: 0; min-height: 0; flex: 1; overflow: hidden; }
	.chat-output { font-size: inherit; padding: 3px 6px; width: 100%; min-width: 0; flex: 1; overflow-y: auto; }
	shu-chat-message { display: block; }
	shu-chat-message .msg { display: grid; grid-template-columns: 20px 1fr; }
	shu-chat-message .msg-label { font-size: 11px; display: flex; align-items: flex-start; justify-content: center; padding-top: 4px; user-select: text; }
	shu-chat-message[data-role="user"] { background: #fdf8f2; }
	shu-chat-message[data-role="user"] .msg-label { background: #f5e9d8; }
	shu-chat-message[data-role="llm"] { background: #f8f8f6; }
	shu-chat-message[data-role="llm"] .msg-label { background: #ececea; }
	shu-chat-message .msg-content { min-width: 0; padding: 3px 6px; }
	shu-chat-message .chat-prompt { font-weight: 600; padding: 2px 0; white-space: pre-wrap; }
	shu-chat-message .chat-text { font-size: inherit; overflow-wrap: break-word; word-break: break-word; }
	shu-chat-message .chat-text p { margin: 3px 0; }
	shu-chat-message .chat-text ul, shu-chat-message .chat-text ol { margin: 3px 0; padding-left: 18px; }
	shu-chat-message .chat-text code { background: #f0f0f0; padding: 1px 3px; font-size: inherit; border-radius: 2px; }
	shu-chat-message .chat-text pre { background: #f0f0f0; padding: 4px 6px; overflow-x: auto; font-size: inherit; border-radius: 3px; }
	shu-chat-message .chat-error { color: #c00; font-size: inherit; white-space: pre-wrap; padding: 4px 0; }
	.input-line { display: flex; gap: 3px; align-items: stretch; padding: 3px 6px; flex-shrink: 0; }
	.chat-input { flex: 1 1 200px; min-width: 120px; resize: none; overflow: hidden; field-sizing: content; font: inherit; padding: 2px 6px; border: none; background: #f0f0f0; border-radius: 3px; color: inherit; outline: none; }
	.chat-input:focus { background: #e8e8e8; }
	.model-select { font: inherit; font-size: inherit; color: #444; max-width: 200px; }
	.tool-limit-label { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #666; }
	.tool-limit { width: 44px; font: inherit; font-size: 11px; padding: 2px 4px; border: 1px solid #ccc; border-radius: 3px; }
	.send-btn { padding: 2px 6px; background: #333; color: #fff; border: none; border-radius: 3px; font: inherit; font-size: inherit; cursor: pointer; flex-shrink: 0; }
	.send-btn:hover { background: #555; }
	.stop-btn { padding: 2px 6px; background: #c00; color: #fff; border: none; border-radius: 3px; font: inherit; font-size: inherit; cursor: pointer; flex-shrink: 0; }
	.stop-btn:hover { background: #900; }
	.save-btn { padding: 2px 6px; background: #1a6b3c; color: #fff; border: none; border-radius: 3px; font: inherit; font-size: inherit; cursor: pointer; flex-shrink: 0; }
	.save-btn:hover { background: #135028; }
`;

customElements.define("shu-kihan-chat", ShuKihanChat);
