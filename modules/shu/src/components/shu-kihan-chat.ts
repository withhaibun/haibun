/**
 * Chat surface for talking to a Kihan. Threads via AS:context + discourse
 * sub-properties of inReplyTo — the first turn's prompt is the session root;
 * every subsequent turn carries `as:context → root` and a `question` edge
 * from the new prompt → the prior reply. Both are forwarded in the envelope
 * so the server writes the edges on receipt.
 */
import { z } from "zod";
import { html, css, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { repeat } from "lit/directives/repeat.js";
import { ShuElement } from "./shu-element.js";
import { ChatMessageSchema, type TChatMessage } from "./shu-chat-message.js";
import type { ShuCombobox } from "./shu-combobox.js";
import { Access } from "@haibun/core/lib/resources.js";
import { formatSeqPath } from "@haibun/core/lib/seq-path.js";
import { shuBaseStyles } from "./styles.js";
import { errMsg } from "../util.js";
import { conduit } from "../hypermedia.js";
import { findStep, getAvailableSteps, requireStep } from "../rpc-registry.js";
import { getActionBarChatExtensionTags } from "../rels-cache.js";
import { getCookie, setCookie } from "../cookies.js";
import type { TContextPattern, TSearchCondition } from "../schemas.js";

const MODEL_COOKIE = "shu-model";
const TOOL_LIMIT_COOKIE = "shu-tool-limit";
const TOOL_LIMIT_DEFAULT = 5;
const TOOL_LIMIT_MIN = 0;
const TOOL_LIMIT_MAX = 99;
/** Cookie holding the active chat session's root seqPath. Turns are persisted as threaded Comment pairs, so on connect
 * (after a collapse/expand or a full page reload) the chat re-hydrates from the graph via loadChatSession — surviving reloads, unlike a per-page DOM snapshot. */
const CHAT_SESSION_COOKIE = "shu-chat-session";

type TChatSession = { sessionSeqPath: string; label: string; generatedAtTime: string };
/** Combo option text for a session: truncated first-prompt preview + a compact date/time so sessions are recognizable and ordered. */
function sessionOptionLabel(s: TChatSession): string {
	const preview = s.label.length > 48 ? `${s.label.slice(0, 47)}…` : s.label;
	const when = new Date(s.generatedAtTime).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
	return `${preview} · ${when}`;
}

function readToolLimitCookie(): number {
	const raw = getCookie(TOOL_LIMIT_COOKIE);
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n)) return TOOL_LIMIT_DEFAULT;
	return Math.max(TOOL_LIMIT_MIN, Math.min(TOOL_LIMIT_MAX, n));
}

const ChatSchema = z.object({});

export class ShuKihanChat extends ShuElement<typeof ChatSchema> {
	static styles = [shuBaseStyles, css`
		:host { display: flex; flex-direction: column; min-width: 0; min-height: 0; flex: 1; overflow: hidden; }
		.chat-output {
			font-size: inherit; padding: var(--shu-space-3) var(--shu-space-4);
			width: 100%; min-width: 0; flex: 1; overflow-y: auto;
		}
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
		.input-line {
			display: flex; gap: var(--shu-space-2); align-items: center;
			padding: var(--shu-space-3) var(--shu-space-4); flex-shrink: 0; min-width: 0;
		}
		/* Input/textarea visuals come from SHU_BASE. The kihan chat only adjusts layout (flex basis, height cap). */
		.chat-input {
			flex: 1 1 0; min-width: 16ch; resize: none;
			max-height: calc(var(--shu-input-h) * 4);
			overflow-y: auto; line-height: 1.4;
		}
		::slotted([slot="mode-toggle"]), ::slotted(.mode-select) { flex: 0 0 auto; }
		.model-select { flex: 0 0 auto; max-width: 14em; }
		.tool-limit-label {
			display: inline-flex; align-items: center; gap: var(--shu-space-1);
			font-size: var(--shu-font-sm); color: var(--shu-fg-muted); flex: 0 0 auto;
		}
		.tool-limit { width: 4em; font-size: var(--shu-font-sm); }
		.send-btn, .stop-btn, .save-btn {
			padding: var(--shu-space-1) var(--shu-space-4); border: var(--shu-border-w) solid transparent;
			border-radius: var(--shu-radius); font: inherit; font-size: var(--shu-font-md);
			cursor: pointer; flex-shrink: 0; min-height: var(--shu-input-h);
		}
		.send-btn { background: var(--shu-accent); color: var(--shu-accent-fg); border-color: var(--shu-accent); }
		.send-btn:hover { filter: brightness(1.1); }
		.stop-btn { background: var(--shu-error); color: var(--shu-accent-fg); border-color: var(--shu-error); }
		.stop-btn:hover { filter: brightness(1.1); }
		.save-btn { background: var(--shu-accent); color: var(--shu-accent-fg); border-color: var(--shu-accent); }
		.save-btn:hover { filter: brightness(1.1); }
	`];
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
	private _sessions: TChatSession[] = [];
	/** The single source of truth for the rendered conversation — fed identically by the live stream (handleChat) and a hydrated session (loadAndRenderSession), rendered once via keyed repeat. */
	private _messages: TChatMessage[] = [];
	private _msgCounter = 0;
	private _streaming = false;
	private _showSave = false;
	private _scrollPending = false;
	private _flushScheduled = false;
	private _flushId: string | null = null;
	private _flushGet: (() => string) | null = null;
	private _flushRaf: number | null = null;
	/** Last-applied (models|selectedModel|sessions|sessionSeqPath) signature — wireListeners skips re-applying combo options when unchanged. */
	private _comboSig = "";

	private _contextPatterns: TContextPattern[] = [];
	private _contextAccessLevel: string = Access.private;
	private _selectedLabel = "";
	private _filterConditions: TSearchCondition[] = [];
	private _textSearch = "";

	static observedHtmlAttributes = ["testid-prefix"];

	private get testIdPrefix(): string {
		return this.getAttribute("testid-prefix") || "";
	}

	private tid(id: string): string {
		return `data-testid="${this.testIdPrefix}${id}"`;
	}

	constructor() {
		super(ChatSchema, {});
	}

	protected override onConnected(): void {
		void this.loadModels();
		void this.loadSessions();
	}

	/** Tear down an in-flight turn and any queued text flush when the pane is destroyed (e.g. collapsing the actions bar removes this element), so a dead stream never mutates reactive state or calls requestUpdate on a torn-down element. */
	protected override onDisconnected(): void {
		this._abortController?.abort();
		if (this._flushRaf !== null) cancelAnimationFrame(this._flushRaf);
	}

	/** Fetch the persisted chat sessions (newest first) for the selector. */
	private async listSessions(): Promise<TChatSession[]> {
		await getAvailableSteps();
		if (!findStep("listChatSessions")) return [];
		const data = await conduit().follow<{ sessions: TChatSession[] }>({ method: requireStep("listChatSessions") }, "kihan-chat: list chat sessions");
		return data.sessions;
	}

	/** Populate the session selector and, on connect, restore the active session (cookie) so the conversation survives a collapse/expand or full reload — rebuilt from the persisted Comment pairs, not a DOM snapshot. */
	private async loadSessions(): Promise<void> {
		this._sessions = await this.listSessions();
		this.requestUpdate();
		await this.updateComplete;
		const active = getCookie(CHAT_SESSION_COOKIE);
		if (active && this._sessions.some((s) => s.sessionSeqPath === active)) {
			(this.shadowRoot?.querySelector(".session-select") as ShuCombobox | null)?.setValue(active);
			await this.loadAndRenderSession(active);
		}
	}

	/** Refresh the selector options after a new turn lands, without disturbing the rendered conversation. */
	private async refreshSessionList(): Promise<void> {
		this._sessions = await this.listSessions();
		this.requestUpdate();
	}

	private onSessionChange = (e: CustomEvent): void => {
		const seqPath = e.detail?.value;
		if (!seqPath) return;
		setCookie(CHAT_SESSION_COOKIE, seqPath);
		void this.loadAndRenderSession(seqPath);
	};

	/** Load a session's persisted turns into the message list, replacing the current conversation. Each llm half carries the turn's seqPath (its Comment-pair graph identity). Aborts any in-flight turn first so a switch (or cookie restore) never leaves an orphaned stream patching a message that is no longer rendered. */
	private async loadAndRenderSession(sessionSeqPath: string): Promise<void> {
		this._abortController?.abort();
		this._sessionSeqPath = sessionSeqPath;
		await getAvailableSteps();
		if (!findStep("loadChatSession")) return;
		const data = await conduit().follow<{ turns: Array<{ prompt: string; response: string; seqPath: string }> }>(
			{ method: requireStep("loadChatSession"), params: { sessionSeqPath } },
			"kihan-chat: hydrate persisted session",
		);
		const messages: TChatMessage[] = [];
		for (const turn of data.turns) {
			messages.push(ChatMessageSchema.parse({ id: this.nextId(), role: "user", text: turn.prompt }));
			messages.push(ChatMessageSchema.parse({ id: this.nextId(), role: "llm", text: turn.response, status: "completed", seqPath: turn.seqPath }));
		}
		this._messages = messages;
		// Thread the next turn onto this session's last reply (and clear any prior session's value) so inReplyTo points within the loaded session, never null on the first post-hydration turn nor across sessions.
		this._lastReplySeqPath = data.turns.length > 0 ? data.turns[data.turns.length - 1].seqPath : null;
		this._showSave = false;
		this._scrollPending = true;
		this.requestUpdate();
	}

	setContext(patterns: TContextPattern[], accessLevel: string, extra?: { label?: string; textQuery?: string; conditions?: TSearchCondition[] }): void {
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
				if (!txt)
					throw new Error(
						"shu-llm-chat: encountered an empty <script type=application/ld+json> in the active pane — the view's render must emit valid JSON-LD or omit the script tag",
					);
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
		const data = await conduit().follow<{ vertices: Array<{ id: string }> }>({ method: requireStep("showKihans") }, "kihan-chat: load model catalog");
		if (data.vertices) {
			this._models = data.vertices;
			if (this._models.length > 0 && !this._selectedModel) {
				const preferred = getCookie(MODEL_COOKIE);
				const match = preferred && this._models.find((m) => m.id === preferred);
				this._selectedModel = match ? match.id : this._models[0].id;
			}
			this.requestUpdate();
		}
	}

	render(): TemplateResult {
		const showModel = this._models.length > 0;
		const uiExtensionTags = getActionBarChatExtensionTags();
		return html`
			<div class="chat-output" data-testid=${`${this.testIdPrefix}chat-output`}>
				${repeat(this._messages, (m) => m.id, (m) => html`<shu-chat-message .message=${m}></shu-chat-message>`)}
			</div>
			<div class="input-line">
				<slot name="mode-toggle"></slot>
				<textarea class="chat-input" placeholder="Ask about this..." data-testid=${`${this.testIdPrefix}chat-input`} rows="1" autofocus @input=${this.onChatInput} @keydown=${this.onChatKeydown}></textarea>
				${this._sessions.length > 0 ? html`<shu-combobox class="session-select" testid=${`${this.testIdPrefix}session-select`} placeholder="session..." @combo-change=${this.onSessionChange}></shu-combobox>` : ""}
				${showModel ? html`<shu-combobox class="model-select" testid=${`${this.testIdPrefix}model-select`} placeholder="model..." @combo-change=${this.onModelChange}></shu-combobox>` : ""}
				<label class="tool-limit-label" title="Max chained tool calls the model may run before asking you to confirm the next one. 0 means every tool call needs confirmation.">
					<span>tool calls</span>
					<input class="tool-limit" type="number" min=${TOOL_LIMIT_MIN} max=${TOOL_LIMIT_MAX} step="1" .value=${String(this._toolLimit)} data-testid=${`${this.testIdPrefix}tool-limit`} @change=${this.onToolLimitChange}>
				</label>
				${unsafeHTML(uiExtensionTags.map((tag) => `<${tag}></${tag}>`).join(""))}
				<button type="button" class="send-btn" data-testid=${`${this.testIdPrefix}chat-submit`} style=${this._streaming ? "display:none" : ""} @click=${this.submitChat}>Send</button>
				<button type="button" class="stop-btn" data-testid=${`${this.testIdPrefix}chat-stop`} style=${this._streaming ? "" : "display:none"} @click=${this.onStop}>Stop</button>
				<button type="button" class="save-btn" data-testid=${`${this.testIdPrefix}save-summary`} style=${this._showSave ? "" : "display:none"} @click=${this.onSave}>Save</button>
			</div>
		`;
	}

	protected updated(): void {
		this.wireListeners();
		if (this._scrollPending) {
			this._scrollPending = false;
			const out = this.shadowRoot?.querySelector(".chat-output") as HTMLElement | null;
			if (out) out.scrollTop = out.scrollHeight;
		}
	}

	/** Combo options are imperative props (not lit-bound); all event handlers are declarative (@event) so lit wires them once. Re-applying is idempotent but churns the combos, so we skip when neither the model nor session data changed — the parent re-renders every streamed-text frame and the combos must not be reset 60×/s. */
	private wireListeners(): void {
		const sig = `${this._models.map((m) => m.id).join(",")}|${this._selectedModel}|${this._sessions.map((s) => s.sessionSeqPath).join(",")}|${this._sessionSeqPath ?? ""}`;
		if (sig === this._comboSig) return;
		this._comboSig = sig;
		const modelCombo = this.shadowRoot?.querySelector(".model-select") as ShuCombobox | null;
		if (modelCombo) {
			modelCombo.setOptions(this._models.map((m) => ({ value: m.id, label: m.id })));
			if (this._selectedModel) modelCombo.setValue(this._selectedModel);
		}
		const sessionCombo = this.shadowRoot?.querySelector(".session-select") as ShuCombobox | null;
		if (sessionCombo) {
			sessionCombo.setOptions(this._sessions.map((s) => ({ value: s.sessionSeqPath, label: sessionOptionLabel(s) })));
			if (this._sessionSeqPath) sessionCombo.setValue(this._sessionSeqPath);
		}
	}

	private onModelChange = (e: CustomEvent): void => {
		this._selectedModel = e.detail?.value || "";
		setCookie(MODEL_COOKIE, this._selectedModel);
	};
	private onToolLimitChange = (e: Event): void => {
		const el = e.target as HTMLInputElement;
		const raw = Number.parseInt(el.value, 10);
		const clamped = Number.isFinite(raw) ? Math.max(TOOL_LIMIT_MIN, Math.min(TOOL_LIMIT_MAX, raw)) : TOOL_LIMIT_DEFAULT;
		this._toolLimit = clamped;
		el.value = String(clamped);
		setCookie(TOOL_LIMIT_COOKIE, String(clamped));
	};
	private onChatInput = (e: Event): void => {
		const el = e.target as HTMLTextAreaElement;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	};
	private onChatKeydown = (e: KeyboardEvent): void => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			this.submitChat();
		}
	};
	private submitChat = (): void => {
		// One turn at a time: a second turn would share the single _abortController + flush slot with the in-flight one. Send is also hidden while streaming; this guards the Enter-key path.
		if (this._streaming) return;
		const chatInput = this.shadowRoot?.querySelector(".chat-input") as HTMLTextAreaElement | null;
		if (!chatInput?.value) return;
		const value = chatInput.value;
		chatInput.value = "";
		chatInput.style.height = "auto";
		void this.handleChat(value);
	};
	private onStop = (): void => {
		this._abortController?.abort();
	};
	private onSave = (): void => {
		void this.handleSave();
	};

	private nextId(): string {
		return `m${++this._msgCounter}`;
	}
	/** Append already-validated messages and re-render. */
	private appendMessages(...msgs: TChatMessage[]): void {
		this._messages = [...this._messages, ...msgs];
		this.requestUpdate();
	}
	/** Replace one message by id with a patched copy; unchanged messages keep their reference so keyed repeat skips them. */
	private patchMessage(id: string, patch: Partial<TChatMessage>): void {
		this._messages = this._messages.map((m) => (m.id === id ? { ...m, ...patch } : m));
		this.requestUpdate();
	}
	/** Coalesce streamed text into one patch per animation frame; the final chunk is applied synchronously via flushTextNow. Only one turn streams at a time (submitChat guards re-entry), so the single pending slot is never shared across turns. */
	private scheduleTextFlush(id: string, getText: () => string): void {
		this._flushId = id;
		this._flushGet = getText;
		if (this._flushScheduled) return;
		this._flushScheduled = true;
		this._flushRaf = requestAnimationFrame(() => {
			this._flushScheduled = false;
			this._flushRaf = null;
			if (this._flushId && this._flushGet) this.patchMessage(this._flushId, { text: this._flushGet() });
		});
	}
	private flushTextNow(id: string, text: string): void {
		if (this._flushRaf !== null) cancelAnimationFrame(this._flushRaf);
		this._flushRaf = null;
		this._flushScheduled = false;
		this._flushId = null;
		this._flushGet = null;
		this.patchMessage(id, { text });
	}

	private async handleChat(prompt: string): Promise<void> {
		await getAvailableSteps();
		await this.loadModels();

		this._lastPrompt = prompt;
		this._fullText = "";
		this._showSave = false;
		this._streaming = true;
		this._scrollPending = true;
		this._abortController = new AbortController();

		const aiId = this.nextId();
		this.appendMessages(
			ChatMessageSchema.parse({ id: this.nextId(), role: "user", text: prompt }),
			ChatMessageSchema.parse({ id: aiId, role: "llm", status: "running", spinnerStatus: "Sending...", spinnerVisible: true, spinnerSpinning: true }),
		);

		const signal = this._abortController.signal;
		let turnSeqPath: string | null = null;
		let accumulated = "";
		try {
			await conduit().followStream(
				{
					method: requireStep("chatWithContext"),
					params: {
						prompt,
						context: JSON.stringify(this.activeChatContext()),
						accessLevel: this._contextAccessLevel,
						target: this._selectedModel,
					},
				},
				(chunk) => {
					const data = chunk as Record<string, unknown>;
					if (data.status) this.patchMessage(aiId, { spinnerStatus: String(data.status), spinnerVisible: true, spinnerSpinning: true });
					if (data.text) {
						accumulated += String(data.text);
						this.scheduleTextFlush(aiId, () => accumulated);
					}
					if (data.error) this.patchMessage(aiId, { error: String(data.error), spinnerVisible: false });
				},
				{
					why: "kihan-chat: stream LLM response",
					signal,
					onStart: (seqPath) => {
						turnSeqPath = formatSeqPath(seqPath);
						this.patchMessage(aiId, { seqPath: turnSeqPath });
					},
				},
			);
			this.flushTextNow(aiId, accumulated);
			this._fullText = accumulated;
			this.patchMessage(aiId, { status: "completed" });
			if (this._fullText) this._showSave = true;
			if (turnSeqPath) {
				if (!this._sessionSeqPath) {
					this._sessionSeqPath = turnSeqPath;
					setCookie(CHAT_SESSION_COOKIE, turnSeqPath);
				}
				this._lastReplySeqPath = turnSeqPath;
				void this.refreshSessionList();
			}
		} catch (err) {
			if (signal.aborted) this.patchMessage(aiId, { spinnerStatus: "Stopped", spinnerVisible: true, spinnerSpinning: false, status: "aborted" });
			else this.patchMessage(aiId, { error: errMsg(err), spinnerVisible: false, status: "failed" });
		} finally {
			const aborted = signal.aborted;
			this._streaming = false;
			if (!aborted) this.patchMessage(aiId, { spinnerVisible: false, spinnerSpinning: false });
			if (this._fullText && !aborted) {
				this.shadowRoot?.querySelectorAll<HTMLElement>("shu-voice-client").forEach((el) => {
					const maybeSpeak = (el as { speak?: unknown }).speak;
					if (typeof maybeSpeak === "function") maybeSpeak.call(el, this._fullText);
				});
			}
			this._abortController = null;
			this._scrollPending = true;
			this.requestUpdate();
		}
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
			await conduit().follow(
				{
					method: requireStep("saveSummary"),
					params: {
						topic: this._lastPrompt.slice(0, 80),
						content: this._fullText,
						prompt: this._lastPrompt,
						conditions: {
							conditions: this._filterConditions,
							label: this._selectedLabel,
							textQuery: this._textSearch,
						},
						accessLevel: this._contextAccessLevel || Access.private,
					},
				},
				"kihan-chat: save summary",
			);
			if (saveBtn) saveBtn.textContent = "Saved";
		} catch (err) {
			if (saveBtn) {
				saveBtn.disabled = false;
				saveBtn.textContent = "Save";
			}
			this.appendMessages(ChatMessageSchema.parse({ id: this.nextId(), role: "llm", error: `Save failed: ${errMsg(err)}` }));
		}
	}
}

customElements.define("shu-kihan-chat", ShuKihanChat);
