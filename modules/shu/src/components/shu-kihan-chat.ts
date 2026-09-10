/**
 * Chat surface for talking to a Kihan. Threads via AS:context + discourse
 * sub-properties of inReplyTo — the first turn's prompt is the session root;
 * every subsequent turn carries `as:context → root` and a `question` edge
 * from the new prompt → the prior reply. Both are forwarded in the envelope
 * so the server writes the edges on receipt.
 */
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { z } from "zod";
import { html, css, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { repeat } from "lit/directives/repeat.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { ChatMessageSchema, chatMessageStyles, type TChatMessage } from "./shu-chat-message.js";
import type { ShuChatMessage } from "./shu-chat-message.js";
import type { ShuActivityHistory } from "./shu-activity-history.js";
import type { ShuCombobox } from "./shu-combobox.js";
import { Access } from "@haibun/core/lib/resources.js";
import { formatSeqPath } from "@haibun/core/lib/seq-path.js";
import { shuBaseStyles } from "./styles.js";

import { reads, acts, conduit } from "../hypermedia.js";
import { findStep, getAvailableSteps, requireStep } from "../rpc-registry.js";
import { getActionBarChatExtensionTags } from "../rels-cache.js";
import type { TContextPattern } from "../schemas.js";
import type { TSearchCondition } from "@haibun/core/lib/quad-types.js";
import { harvestChatViewLd } from "../chat-context-harvest.js";
import { SHU_TAG } from "../consts.js";
import { reportToRun } from "../client-log.js";

const TOOL_LIMIT_DEFAULT = 5;
const TOOL_LIMIT_MIN = 0;
const TOOL_LIMIT_MAX = 99;
/** Cookie holding the active chat session's root seqPath. Turns are persisted as threaded Comment pairs, so on connect
 * (after a collapse/expand or a full page reload) the chat re-hydrates from the graph via loadChatSession — surviving reloads, unlike a per-page DOM snapshot. */

type TChatSession = { sessionSeqPath: string; label: string; generatedAtTime: string };
/** Combo option text for a session: truncated first-prompt preview + a compact date/time so sessions are recognizable and ordered. */
function sessionOptionLabel(s: TChatSession): string {
	const preview = s.label.length > 48 ? `${s.label.slice(0, 47)}…` : s.label;
	const when = new Date(s.generatedAtTime).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
	return `${preview} · ${when}`;
}

/** What the chat remembers between visits: which model to ask, how many chained tool calls it may make, and the
 *  session being read. All three were hand-rolled cookies; they are remembered the way every other option is. */
const ChatSchema = z.object({
	model: z.string().default(""),
	toolLimit: z.number().int().min(TOOL_LIMIT_MIN).max(TOOL_LIMIT_MAX).default(TOOL_LIMIT_DEFAULT),
	session: z.string().default(""),
});

export class ShuKihanChat extends ShuElement<typeof ChatSchema> {
	/** A control, not a view of data — contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static styles = [
		shuBaseStyles,
		chatMessageStyles,
		css`
		:host { display: flex; flex-direction: column; min-width: 0; min-height: 0; flex: 1; overflow: hidden; }
		/* Transcript projected into a shared external output (the actions bar's activity history): this element is only its input line. */
		:host([external-output]) { flex: 0 0 auto; }
		.chat-output {
			font-size: inherit; padding: var(--shu-space-3) var(--shu-space-4);
			width: 100%; min-width: 0; flex: 1; overflow-y: auto;
		}
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
		.send-btn, .stop-btn {
			padding: var(--shu-space-1) var(--shu-space-4); border: var(--shu-border-w) solid transparent;
			border-radius: var(--shu-radius); font: inherit; font-size: var(--shu-font-md);
			cursor: pointer; flex-shrink: 0; min-height: var(--shu-input-h);
		}
		.send-btn { background: var(--shu-accent); color: var(--shu-accent-fg); border-color: var(--shu-accent); }
		.send-btn:hover { filter: brightness(1.1); }
		.stop-btn { background: var(--shu-error); color: var(--shu-accent-fg); border-color: var(--shu-error); }
		.stop-btn:hover { filter: brightness(1.1); }
	`,
	];
	static schema = ChatSchema;
	static domainSelector = SHU_TAG.KIHAN_CHAT;

	private _models: Array<{ id: string; displayName?: string }> = [];
	/** The chat's remembered options; a new visit restores the model, the tool limit and the session it was reading. */
	static persistFields = ["model", "toolLimit", "session"] as const;
	private _fullText = "";
	private _abortController: AbortController | null = null;
	private _sessionSeqPath: string | null = null;
	private _lastReplySeqPath: string | null = null;
	private _sessions: TChatSession[] = [];
	/** The single source of truth for the rendered conversation — fed identically by the live stream (handleChat) and a hydrated session (loadAndRenderSession), rendered once via keyed repeat. */
	private _messages: TChatMessage[] = [];
	private _msgCounter = 0;
	private _streaming = false;
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

	/** id → the shu-chat-message this instance projected into the external output. Lets a session switch remove exactly its own transcript, leaving other activity records (step callers, search summaries) in place. */
	#projected = new Map<string, ShuChatMessage>();
	#outputTarget: ShuActivityHistory | null = null;

	/** External output: when set (the actions bar's shared activity history), the transcript renders as
	 *  shu-chat-message children of that target and this element renders only its input line. */
	set outputTarget(target: ShuActivityHistory | null) {
		this.#outputTarget = target;
		this.toggleAttribute("external-output", target !== null);
		this.requestUpdate();
	}
	get outputTarget(): ShuActivityHistory | null {
		return this.#outputTarget;
	}

	/** Reconcile _messages onto the external target: patch by id, append new, remove departed — including any
	 *  chat message a previous chat instance left behind (one conversation surface, so this instance owns them all). */
	#syncExternalOutput(): void {
		const target = this.#outputTarget;
		if (!target) return;
		const ids = new Set(this._messages.map((m) => m.id));
		for (const [id, el] of this.#projected) {
			if (!ids.has(id)) {
				el.remove();
				this.#projected.delete(id);
			}
		}
		const mine = new Set(this.#projected.values());
		for (const el of Array.from(target.querySelectorAll(":scope > shu-chat-message"))) if (!mine.has(el as ShuChatMessage)) el.remove();
		for (const m of this._messages) {
			const existing = this.#projected.get(m.id);
			if (existing) {
				if (existing.message !== m) existing.message = m;
				continue;
			}
			const el = document.createElement("shu-chat-message") as ShuChatMessage;
			el.message = m;
			this.#projected.set(m.id, el);
			target.append(el);
		}
	}

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
		const data = await conduit().follow<{ sessions: TChatSession[] }>(reads(requireStep("listChatSessions")), "kihan-chat: list chat sessions");
		return data.sessions;
	}

	/** Populate the session selector and, on connect, restore the active session (cookie) so the conversation survives a collapse/expand or full reload — rebuilt from the persisted Comment pairs, not a DOM snapshot. */
	private async loadSessions(): Promise<void> {
		this._sessions = await this.listSessions();
		this.requestUpdate();
		await this.updateComplete;
		const active = this.state.session;
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
		this.setState({ session: seqPath });
		void this.loadAndRenderSession(seqPath);
	};

	/** Load a session's persisted turns into the message list, replacing the current conversation. Each llm half carries the turn's seqPath (its Comment-pair graph identity). Aborts any in-flight turn first so a switch (or cookie restore) never leaves an orphaned stream patching a message that is no longer rendered. */
	private async loadAndRenderSession(sessionSeqPath: string): Promise<void> {
		this._abortController?.abort();
		this._sessionSeqPath = sessionSeqPath;
		await getAvailableSteps();
		if (!findStep("loadChatSession")) return;
		const data = await conduit().follow<{ turns: Array<{ prompt: string; response: string; seqPath: string }> }>(
			reads(requireStep("loadChatSession"), { sessionSeqPath }),
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
			viewLd: harvestChatViewLd(),
			maxToolCalls: this.state.toolLimit,
		};
		if (this._sessionSeqPath) envelope.sessionSeqPath = this._sessionSeqPath;
		if (this._lastReplySeqPath) envelope.inReplyTo = this._lastReplySeqPath;
		return envelope;
	}

	private async loadModels(): Promise<void> {
		if (this._models.length > 0) return;
		await getAvailableSteps();
		if (!findStep("showKihans")) return;
		const data = await conduit().follow<{ vertices: Array<{ id: string; displayName?: string }> }>(reads(requireStep("showKihans")), "kihan-chat: load model catalog");
		if (data.vertices) {
			this._models = data.vertices;
			if (this._models.length > 0 && !this.state.model) {
				const preferred = this.state.model;
				const match = preferred && this._models.find((m) => m.id === preferred);
				this.setState({ model: match ? match.id : this._models[0].id });
			}
			this.requestUpdate();
		}
	}

	render(): TemplateResult {
		const showModel = this._models.length > 0;
		const uiExtensionTags = getActionBarChatExtensionTags();
		// With an external output target the transcript lives there (see #syncExternalOutput); render only the input line.
		const transcript = this.#outputTarget
			? ""
			: html`<div class="chat-output" data-testid=${`${this.testIdPrefix}chat-output`}>
				${repeat(
					this._messages,
					(m) => m.id,
					(m) => html`<shu-chat-message .message=${m}></shu-chat-message>`,
				)}
			</div>`;
		return html`
			${transcript}
			<div class="input-line">
				<slot name="mode-toggle"></slot>
				<textarea class="chat-input" placeholder="Ask about this..." data-testid=${`${this.testIdPrefix}chat-input`} rows="1" autofocus @input=${this.onChatInput} @keydown=${this.onChatKeydown}></textarea>
				<shu-combobox class="session-select" testid=${`${this.testIdPrefix}session-select`} placeholder="session..." @combo-change=${this.onSessionChange}></shu-combobox>
				${showModel ? html`<shu-combobox class="model-select" testid=${`${this.testIdPrefix}model-select`} placeholder="model..." @combo-change=${this.onModelChange}></shu-combobox>` : ""}
				<label class="tool-limit-label" title="Max chained tool calls the model may run before asking you to confirm the next one. 0 means every tool call needs confirmation.">
					<span>tool calls</span>
					<input class="tool-limit" type="number" min=${TOOL_LIMIT_MIN} max=${TOOL_LIMIT_MAX} step="1" .value=${String(this.state.toolLimit)} data-testid=${`${this.testIdPrefix}tool-limit`} @change=${this.onToolLimitChange}>
				</label>
				${unsafeHTML(uiExtensionTags.map((tag) => `<${tag}></${tag}>`).join(""))}
				<button type="button" class="send-btn" data-testid=${`${this.testIdPrefix}chat-submit`} style=${this._streaming ? "display:none" : ""} @click=${this.submitChat}>Send</button>
				<button type="button" class="stop-btn" data-testid=${`${this.testIdPrefix}chat-stop`} style=${this._streaming ? "" : "display:none"} @click=${this.onStop}>Stop</button>
			</div>
		`;
	}

	protected updated(): void {
		this.wireListeners();
		this.#syncExternalOutput();
		if (this._scrollPending) {
			this._scrollPending = false;
			if (this.#outputTarget) {
				this.#outputTarget.scrollToBottom();
				return;
			}
			const out = this.shadowRoot?.querySelector(".chat-output") as HTMLElement | null;
			if (out) out.scrollTop = out.scrollHeight;
		}
	}

	/** Combo options are imperative props (not lit-bound); all event handlers are declarative (@event) so lit wires them once. Re-applying is idempotent but churns the combos, so we skip when neither the model nor session data changed — the parent re-renders every streamed-text frame and the combos must not be reset 60×/s. */
	private wireListeners(): void {
		const sig = `${this._models.map((m) => m.id).join(",")}|${this.state.model}|${this._sessions.map((s) => s.sessionSeqPath).join(",")}|${this._sessionSeqPath ?? ""}`;
		if (sig === this._comboSig) return;
		this._comboSig = sig;
		const modelCombo = this.shadowRoot?.querySelector(".model-select") as ShuCombobox | null;
		if (modelCombo) {
			modelCombo.setOptions(this._models.map((m) => ({ value: m.id, label: m.displayName || m.id })));
			if (this.state.model) modelCombo.setValue(this.state.model);
		}
		const sessionCombo = this.shadowRoot?.querySelector(".session-select") as ShuCombobox | null;
		if (sessionCombo) {
			sessionCombo.setOptions(this._sessions.map((s) => ({ value: s.sessionSeqPath, label: sessionOptionLabel(s) })));
			if (this._sessionSeqPath) sessionCombo.setValue(this._sessionSeqPath);
		}
	}

	private onModelChange = (e: CustomEvent): void => {
		this.setState({ model: e.detail?.value || "" });
	};
	private onToolLimitChange = (e: Event): void => {
		const el = e.target as HTMLInputElement;
		const raw = Number.parseInt(el.value, 10);
		const clamped = Number.isFinite(raw) ? Math.max(TOOL_LIMIT_MIN, Math.min(TOOL_LIMIT_MAX, raw)) : TOOL_LIMIT_DEFAULT;
		this.setState({ toolLimit: clamped });
		el.value = String(clamped);
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

		this._fullText = "";
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
				acts(requireStep("chatWithContext"), {
					prompt,
					context: JSON.stringify(this.activeChatContext()),
					accessLevel: this._contextAccessLevel,
					target: this.state.model,
				}),
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
			if (turnSeqPath) {
				if (!this._sessionSeqPath) {
					this._sessionSeqPath = turnSeqPath;
					this.setState({ session: turnSeqPath });
				}
				this._lastReplySeqPath = turnSeqPath;
			}
			// The turn was written whether or not its stream announced a seqPath, so the session exists either way. This
			// used to be inside the branch above, and a turn that announced none left the selector missing.
			void this.refreshSessionList();
		} catch (err) {
			if (signal.aborted) this.patchMessage(aiId, { spinnerStatus: "Stopped", spinnerVisible: true, spinnerSpinning: false, status: "aborted" });
			else {
				this.patchMessage(aiId, { error: errorDetail(err), spinnerVisible: false, status: "failed" });
				// A turn that fails in the browser was invisible to the run: the pane showed the error, the log showed a
				// missing element. Report it so a failed turn says why wherever the run is read.
				reportToRun("error", "shu-kihan-chat", `chat turn failed: ${errorDetail(err)}`);
			}
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
}

customElements.define(SHU_TAG.KIHAN_CHAT, ShuKihanChat);
