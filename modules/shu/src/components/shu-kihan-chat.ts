/**
 * The ask's input line: the question, the session selector, the model, the tool limit, who reads the context, Send and
 * Stop. The conversation and the page's turn are page-level machines, and the actions bar's activity history renders the
 * transcript from them. This element holds neither, so the bar removes it when it closes and the conversation continues.
 */
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { z } from "zod";
import { nothing, html, css, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { reads, conduit } from "../hypermedia.js";
import { findStep, getAvailableSteps, requireStep } from "../rpc-registry.js";
import { getActionBarAskExtensionTags, getActionBarChatExtensionTags } from "../rels-cache.js";
import type { TComboboxOption } from "../schemas.js";
import { SCOPE, activeScope, currentSubjectState, entryOf } from "../current-subject.js";
import { SignalController } from "../controllers/index.js";
import { dispatchTurnEvent, inFlight, nextQuestion, startTurn, turnEnded, turnState, type TTurnState } from "../chat-turn.js";
import { askRefusal, closeConversation, conversationState, openConversation } from "../conversation.js";
import { appAccessLevel } from "../util.js";
import { harvestChatViewLd } from "../chat-context-harvest.js";
import { SHU_TAG } from "../consts.js";
import { reportToRun } from "../client-log.js";

/** What a reader says a turn sends. The values are the words the registry and a profile state it in; what each of them
 *  sends is how a reader reads them, and "" is the reader saying nothing, which leaves it to the model. */
const AS_MODEL_STATES = "";
const SENDS: Record<string, string> = { run: "context", model: "tool cues" };

const TOOL_LIMIT_DEFAULT = 5;
const TOOL_LIMIT_MIN = 0;
const TOOL_LIMIT_MAX = 99;
/** The session selector's choice that leaves the conversation, so the next question starts a session. */
export const NEW_CONVERSATION: TComboboxOption = { value: "new", label: "new conversation" };

type TChatSession = { sessionSeqPath: string; label: string; generatedAtTime: string };
/** A model as the registry holds it: what the endpoint reports it can do, and what a profile states about it. */
type TKihanVertex = { id: string; displayName?: string; capabilities?: { tools?: boolean }; options?: { contextReadBy?: string } };
/** Combo option text for a session: truncated first-prompt preview + a compact date/time so sessions are recognizable and ordered. */
function sessionOptionLabel(s: TChatSession): string {
	const preview = s.label.length > 48 ? `${s.label.slice(0, 47)}…` : s.label;
	const when = new Date(s.generatedAtTime).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
	return `${preview} · ${when}`;
}

/** What the chat remembers between visits: which model to ask, how many chained tool calls it may make, and who reads
 *  the records a turn is about. `contextReadBy` is unset until a reader states it, and unset means the model's own
 *  profile says which. The conversation is addressed in the view hash, not remembered here. */
const ChatSchema = z.object({
	model: z.string().default(""),
	toolLimit: z.number().int().min(TOOL_LIMIT_MIN).max(TOOL_LIMIT_MAX).default(TOOL_LIMIT_DEFAULT),
	contextReadBy: z.string().default(AS_MODEL_STATES),
});

export class ShuKihanChat extends ShuElement<typeof ChatSchema> {
	/** A control, not a view of data, contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static styles = [
		shuBaseStyles,
		css`
		:host { display: flex; flex-direction: column; min-width: 0; flex: 0 0 auto; }
		/* The row wraps rather than overflowing: the host clips what does not fit, and Send, Stop and the model the turn
		   runs under are the controls a reader reaches for while a turn is in flight. */
		.input-line {
			display: flex; flex-wrap: wrap; gap: var(--shu-space-2); align-items: center;
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
		.context-read { flex: 0 0 auto; max-width: 14em; font-size: var(--shu-font-sm); }
		.tool-limit-label {
			display: inline-flex; align-items: center; gap: var(--shu-space-1);
			font-size: var(--shu-font-sm); color: var(--shu-fg-muted); flex: 0 0 auto;
		}
		.tool-limit { width: 4em; font-size: var(--shu-font-sm); }
		.refusal { flex-basis: 100%; font-size: var(--shu-font-sm); color: var(--shu-error); }
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
	/** The chat's remembered options; a new visit restores the model, the tool limit and who reads the context. */
	static persistFields = ["model", "toolLimit", "contextReadBy"] as const;

	private _models: TKihanVertex[] = [];
	#modelOptions: TComboboxOption[] = [];
	#sessionOptions: TComboboxOption[] = [NEW_CONVERSATION];
	/** Whether the reader's last submit was refused. The refusal shows beside the input while it still applies. */
	#refused = false;
	#conversation = new SignalController(
		this,
		conversationState,
		() => undefined,
		(conversation) => [conversation.status, conversation.session],
	);
	#turn = new SignalController(
		this,
		turnState,
		(turn, before) => this.onTurnStatus(turn, before),
		(turn) => turn.status,
	);

	static observedHtmlAttributes = ["testid-prefix"];

	private get testIdPrefix(): string {
		return this.getAttribute("testid-prefix") || "";
	}

	constructor() {
		super(ChatSchema, {});
	}

	protected override onConnected(): void {
		void this.loadModels();
		void this.refreshSessionList();
	}

	/** Fetch the persisted chat sessions (newest first) for the selector. */
	private async listSessions(): Promise<TChatSession[]> {
		await getAvailableSteps();
		if (!findStep("listChatSessions")) return [];
		const data = await conduit().follow<{ sessions?: TChatSession[] }>(reads(requireStep("listChatSessions")), "kihan-chat: list chat sessions");
		// An answer carrying no list is a failed read, not an empty one. Held as the list, it renders as undefined on
		// every later paint and the pane stops drawing entirely, so the read states what came back instead.
		if (!Array.isArray(data.sessions)) throw new Error(`listChatSessions answered with no list of sessions: ${JSON.stringify(data).slice(0, 200)}`);
		return data.sessions;
	}

	/** Refresh the selector's sessions. A failed read leaves the selector as it was and is reported: which sessions exist
	 *  is beside the conversation, which continues whether or not the list came back. */
	private async refreshSessionList(): Promise<void> {
		try {
			const sessions = await this.listSessions();
			this.#sessionOptions = [NEW_CONVERSATION, ...sessions.map((s) => ({ value: s.sessionSeqPath, label: sessionOptionLabel(s) }))];
		} catch (err) {
			reportToRun("error", "shu-kihan-chat", `the session list did not refresh: ${errorDetail(err)}`);
			return;
		}
		this.requestUpdate();
	}

	/** A turn that ends while the pane is mounted lists its session, and a completed answer is spoken. */
	private onTurnStatus(turn: TTurnState, before: TTurnState | undefined): void {
		if (!turnEnded(before?.status, turn.status)) return;
		if (turn.status === "completed") {
			this.shadowRoot?.querySelectorAll<HTMLElement>("shu-voice-client").forEach((el) => {
				const maybeSpeak = (el as { speak?: unknown }).speak;
				if (typeof maybeSpeak === "function") maybeSpeak.call(el, turn.text);
			});
		}
		// The run writes the turn whether or not its stream announced a seqPath, so the session list changes in both cases.
		void this.refreshSessionList();
	}

	private onSessionChange = (e: CustomEvent<{ value: string }>): void => {
		const { value } = e.detail;
		if (value === NEW_CONVERSATION.value) closeConversation();
		else void openConversation(value, "activate");
	};

	private async loadModels(): Promise<void> {
		if (this._models.length > 0) return;
		await getAvailableSteps();
		if (!findStep("showKihans")) return;
		const data = await conduit().follow<{ vertices: TKihanVertex[] }>(reads(requireStep("showKihans")), "kihan-chat: load model catalog");
		if (data.vertices) {
			this._models = data.vertices;
			this.#modelOptions = this._models.map((m) => ({ value: m.id, label: m.displayName || m.id }));
			if (this._models.length > 0 && !this.state.model) this.setState({ model: this._models[0].id });
			this.requestUpdate();
		}
	}

	render(): TemplateResult {
		const conversation = this.#conversation.state;
		const turn = this.#turn.state;
		const running = inFlight(turn.status);
		const refusal = this.#refused ? askRefusal(conversation, turn) : null;
		// The input line's own extensions, and the ask's: this pane owns the line under ask mode, so it renders both.
		const uiExtensionTags = [...getActionBarChatExtensionTags(), ...getActionBarAskExtensionTags()];
		return html`
			<div class="input-line">
				<slot name="mode-toggle"></slot>
				<textarea class="chat-input" placeholder="Ask about this..." data-testid=${`${this.testIdPrefix}chat-input`} rows="1" autofocus @input=${this.onChatInput} @keydown=${this.onChatKeydown}></textarea>
				<shu-combobox class="session-select" testid=${`${this.testIdPrefix}session-select`} placeholder="session..." .options=${this.#sessionOptions} .value=${conversation.session ?? NEW_CONVERSATION.value} @combo-change=${this.onSessionChange}></shu-combobox>
				${this._models.length > 0 ? html`<shu-combobox class="model-select" testid=${`${this.testIdPrefix}model-select`} placeholder="model..." .options=${this.#modelOptions} .value=${this.state.model} @combo-change=${this.onModelChange}></shu-combobox>` : ""}
				<label class="tool-limit-label" title="Max chained tool calls the model may run before asking you to confirm the next one. 0 means every tool call needs confirmation.">
					<span>tool calls</span>
					<input class="tool-limit" type="number" min=${TOOL_LIMIT_MIN} max=${TOOL_LIMIT_MAX} step="1" .value=${String(this.state.toolLimit)} data-testid=${`${this.testIdPrefix}tool-limit`} @change=${this.onToolLimitChange}>
				</label>
				<select class="context-read" data-testid=${`${this.testIdPrefix}context-read`} title="What a turn sends about the records this conversation is about. Context sends the records themselves. Tool cues send what each type holds and the call that reads it, and the model reads what the question needs. Left at the model default, the model states which." .value=${this.state.contextReadBy} @change=${this.onContextReadChange}>
					<option value=${AS_MODEL_STATES}>${this.modelDefaultLabel()}</option>
					${Object.entries(SENDS).map(([reading, sends]) => html`<option value=${reading}>send ${sends}</option>`)}
				</select>
				${unsafeHTML(uiExtensionTags.map((tag) => `<${tag}></${tag}>`).join(""))}
				<button type="button" class="send-btn" data-testid=${`${this.testIdPrefix}chat-submit`} style=${running ? "display:none" : ""} @click=${this.submitChat}>Send</button>
				<button type="button" class="stop-btn" data-testid=${`${this.testIdPrefix}chat-stop`} style=${running ? "" : "display:none"} @click=${this.onStop}>Stop</button>
				${refusal ? html`<span class="refusal" role="status">${refusal}</span>` : nothing}
			</div>
		`;
	}

	private onModelChange = (e: CustomEvent): void => {
		this.setState({ model: e.detail?.value || "" });
	};
	/**
	 * The default named by what the chosen model sends, so a reader sees what leaving it alone does.
	 *
	 * A profile states it outright. Otherwise it follows what the endpoint reports the model can do: a model that takes
	 * tool calls reads the records itself, and one that does not is sent them. A model the registry says nothing about is
	 * named as the default alone.
	 */
	private modelDefaultLabel(): string {
		const chosen = this._models.find((m) => m.id === this.state.model);
		const stated = chosen?.options?.contextReadBy ?? (chosen?.capabilities?.tools === undefined ? "" : chosen.capabilities.tools ? "model" : "run");
		const sends = SENDS[stated];
		return sends ? `model default (sends ${sends})` : "model default";
	}

	/** A reader stating what this conversation's turns send, or leaving it to the model. */
	private onContextReadChange = (e: Event): void => {
		this.setState({ contextReadBy: (e.target as HTMLSelectElement).value });
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
	/** Send the question, or show why it cannot be asked now. Send is hidden while a turn is in flight, and this check
	 *  covers the Enter key and a conversation still opening. A refused question stays in the input. */
	private submitChat = (): void => {
		this.#refused = askRefusal(this.#conversation.state, this.#turn.state) !== null;
		if (this.#refused) return this.requestUpdate();
		const chatInput = this.shadowRoot?.querySelector(".chat-input") as HTMLTextAreaElement | null;
		if (!chatInput?.value) return;
		const value = chatInput.value;
		chatInput.value = "";
		chatInput.style.height = "auto";
		void this.ask(value);
	};
	private onStop = (): void => {
		dispatchTurnEvent({ type: "stop", reason: "you stopped it" });
	};

	/** Ask the question in the conversation. It carries the active record's bundle, and replies to the actions bar's turn
	 *  where the scope holds one: the latest answer, or the message the reader selected, where the conversation branches. */
	private async ask(prompt: string): Promise<void> {
		await getAvailableSteps();
		await this.loadModels();
		const subject = currentSubjectState.get();
		const { carries, repliesTo } = nextQuestion(subject);
		const session = this.#conversation.state.session;
		await startTurn({
			prompt,
			bundle: carries?.bundle ?? entryOf([], appAccessLevel()).bundle,
			envelope: {
				// The view data is the pane's, so it goes with a record the page activated.
				viewLd: activeScope(subject) === SCOPE.page ? harvestChatViewLd() : [],
				maxToolCalls: this.state.toolLimit,
				contextReadBy: this.state.contextReadBy || undefined,
				sessionSeqPath: session ?? undefined,
				inReplyTo: repliesTo?.seqPath,
			},
			target: this.state.model,
		});
	}
}

customElements.define(SHU_TAG.KIHAN_CHAT, ShuKihanChat);
