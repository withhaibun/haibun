/**
 * The ask: its settings, the transcript, and the input line with the question, Send and Stop. The settings hold the
 * session, the model, the tool limit and who reads the context, and the pane's settings control shows them, above the
 * transcript, which scrolls under them. The conversation and the page's turn are page-level machines, and the bar's
 * activity history renders the transcript from them into this element's transcript slot. This element holds neither, so
 * the bar removes it when it closes and the conversation continues.
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
import { ContextReadBySchema, SessionListSchema, type TComboboxOption } from "../schemas.js";
import { GraphQueryResultSchema } from "@haibun/core/lib/quad-types.js";
import { currentSubjectState } from "../current-subject.js";
import { SignalController } from "../controllers/index.js";
import { nextQuestion, startTurn } from "../chat-turn.js";
import {
	askDraft,
	closeConversation,
	conversationState,
	dispatchConversationEvent,
	followReportedTurns,
	gainedSince,
	sessionsRead,
	inFlight,
	openConversation,
	turnEnded,
	type TConversationState,
} from "../conversation.js";
import { harvestChatViewLd } from "../chat-context-harvest.js";
import { SHU_TAG } from "../consts.js";
import { reportToRun } from "../client-log.js";

/** What a reader says a turn sends. The values are the words the registry and a profile state it in; what each of them
 *  sends is how a reader reads them, and "" is the reader saying nothing, which leaves it to the model. */
const AS_MODEL_STATES = "";
const SENDS: Record<z.infer<typeof ContextReadBySchema>, string> = { run: "context", model: "tool cues" };
const ContextReadChoiceSchema = z.enum([AS_MODEL_STATES, ...ContextReadBySchema.options]);

const TOOL_LIMIT_DEFAULT = 5;
const TOOL_LIMIT_MIN = 0;
const TOOL_LIMIT_MAX = 99;
/** The session selector's choice that leaves the conversation, so the next question starts a session. */
export const NEW_CONVERSATION: TComboboxOption = { value: "new", label: "new conversation" };

type TChatSession = z.infer<typeof SessionListSchema>["sessions"][number];
/** A model as the registry holds it: what the endpoint reports it can do, and what a profile states about it. */
const KihanVertexSchema = z.looseObject({
	id: z.string(),
	displayName: z.string().optional(),
	capabilities: z.looseObject({ tools: z.boolean().optional(), thinking: z.boolean().optional() }).optional(),
	options: z.looseObject({ contextReadBy: ContextReadBySchema.optional() }).optional(),
});
type TKihanVertex = z.infer<typeof KihanVertexSchema>;
/** A page of the model catalog, and how many models the run offers; an answer with no list is a failed read. */
const CatalogPageSchema = GraphQueryResultSchema.extend({ vertices: z.array(KihanVertexSchema) });
/** How many models a read of the catalog asks for at a time. */
const CATALOG_PAGE = 50;
/** Combo option text for a session: what its first question asked, when its newest turn was asked, and how many turns
 *  it gained since this page last read it. */
function sessionOptionLabel(s: TChatSession): string {
	const preview = s.label.length > 48 ? `${s.label.slice(0, 47)}…` : s.label;
	const when = new Date(s.generatedAtTime).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
	const gained = gainedSince(s.session, s.turns);
	return `${preview} · ${when}${gained > 0 ? ` · ${gained} new` : ""}`;
}

/** What the chat remembers between visits: which model to ask, how many chained tool calls it may make, and who reads
 *  the records a turn is about. `contextReadBy` is unset until a reader states it, and unset means the model's own
 *  profile says which. The conversation is addressed in the view hash, not remembered here. */
const ChatSchema = z.object({
	model: z.string().default(""),
	toolLimit: z.number().int().min(TOOL_LIMIT_MIN).max(TOOL_LIMIT_MAX).default(TOOL_LIMIT_DEFAULT),
	contextReadBy: ContextReadChoiceSchema.default(AS_MODEL_STATES),
});

/** Size a text input to the lines it holds. */
function fitToText(input: HTMLTextAreaElement): void {
	input.style.height = "auto";
	input.style.height = `${input.scrollHeight}px`;
}

/** Put a question that wasn't asked back in the input and in the page's draft, where the reader hasn't written another. */
function restoreQuestion(input: HTMLTextAreaElement, prompt: string): void {
	input.value ||= prompt;
	askDraft.set(input.value);
}

export class ShuKihanChat extends ShuElement<typeof ChatSchema> {
	/** A control, not a view of data, contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static styles = [
		shuBaseStyles,
		css`
		:host { display: flex; flex-direction: column; min-width: 0; min-height: 0; flex: 1 1 auto; }
		/* The settings stand above the transcript, which scrolls under them, and the input line stands below it. */
		.chat-settings {
			display: flex; flex-wrap: wrap; gap: var(--shu-space-2); align-items: center;
			padding: var(--shu-space-2) var(--shu-space-4); flex: 0 0 auto; min-width: 0;
			background: var(--shu-bg-soft); border-bottom: var(--shu-border-w) solid var(--shu-border);
		}
		.transcript { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; min-width: 0; }
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
	/** The read of the model catalog in flight, so a question asked while it reads waits on that read rather than making
	 *  another. A read that fails is left for the next question to make again. */
	#catalog: Promise<void> | undefined;
	#modelOptions: TComboboxOption[] = [];
	/** The sessions the run lists, as data: what each is called is derived where it renders, so what a session gained
	 *  goes as soon as this page reads it. */
	#sessions: TChatSession[] = [];
	/** Why the reader's last question was not asked. It shows beside the input until the turn or the conversation moves,
	 *  so a refusal is never shown for a question the reader did not submit. */
	#refusal: string | null = null;
	#conversation = new SignalController(
		this,
		conversationState,
		(conversation, before) => this.onConversationMove(conversation, before),
		(conversation) => [conversation.status, conversation.session, conversation.asked?.status],
	);

	static observedHtmlAttributes = ["testid-prefix"];

	private get testIdPrefix(): string {
		return this.getAttribute("testid-prefix") || "";
	}

	constructor() {
		super(ChatSchema, {});
	}

	protected override onConnected(): void {
		this.loadModels().catch((err: unknown) => reportToRun("error", "shu-kihan-chat", `the model catalog was not read: ${errorDetail(err)}`));
		void this.refreshSessionList();
		// A turn any page asks changes what a session holds, so the list is read again on the run's reports rather than on
		// this page's own turns alone.
		this.autoTeardown(followReportedTurns(() => void this.refreshSessionList()));
		// What this page has read of a session decides what the list says each gained, so opening one states the list again.
		this.watchSignal(sessionsRead);
	}

	/** What the selector offers: a new conversation, then each session the run lists. */
	private sessionOptions(): TComboboxOption[] {
		return [NEW_CONVERSATION, ...this.#sessions.map((session) => ({ value: session.session, label: sessionOptionLabel(session) }))];
	}

	/** Fetch the persisted chat sessions (newest first) for the selector. */
	private async listSessions(): Promise<TChatSession[]> {
		await getAvailableSteps();
		if (!findStep("listChatSessions")) return [];
		// An answer carrying no list is a failed read, not an empty one: the schema states what came back instead.
		return SessionListSchema.parse(await conduit().follow(reads(requireStep("listChatSessions")), "kihan-chat: list chat sessions")).sessions;
	}

	/** Refresh the selector's sessions. A failed read leaves the selector as it was and is reported: which sessions exist
	 *  is beside the conversation, which continues whether or not the list came back. */
	private async refreshSessionList(): Promise<void> {
		try {
			const sessions = await this.listSessions();
			this.#sessions = sessions;
		} catch (err) {
			reportToRun("error", "shu-kihan-chat", `the session list did not refresh: ${errorDetail(err)}`);
			return;
		}
		this.requestUpdate();
	}

	/** Any move clears the refusal. The page's turn that ends while the pane is mounted lists its session, and a completed
	 *  answer is spoken. */
	private onConversationMove(conversation: TConversationState, before: TConversationState | undefined): void {
		this.#refusal = null;
		const turn = conversation.asked;
		if (!turn || !turnEnded(before?.asked?.status, turn.status)) return;
		if (turn.status === "completed") {
			this.shadowRoot?.querySelectorAll<HTMLElement>("shu-voice-client").forEach((el) => {
				const maybeSpeak = (el as { speak?: unknown }).speak;
				if (typeof maybeSpeak === "function") maybeSpeak.call(el, turn.response);
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

	private loadModels(): Promise<void> {
		this.#catalog ??= this.readCatalog().catch((err: unknown) => {
			this.#catalog = undefined;
			throw err;
		});
		return this.#catalog;
	}

	/** Every model the run offers, read a page at a time until the pages hold as many as the listing states. */
	private async readCatalog(): Promise<void> {
		await getAvailableSteps();
		if (!findStep("showKihans")) return;
		const models: TKihanVertex[] = [];
		for (;;) {
			const page = CatalogPageSchema.parse(
				await conduit().follow(reads(requireStep("showKihans"), { offset: models.length, limit: CATALOG_PAGE }), "kihan-chat: load model catalog"),
			);
			models.push(...page.vertices);
			if (page.vertices.length === 0 || models.length >= page.total) break;
		}
		this._models = models;
		this.#modelOptions = this._models.map((m) => ({ value: m.id, label: m.displayName || m.id }));
		this.offeredModel();
		this.requestUpdate();
	}

	/** The model a question is sent to, which is one the run offers. A remembered model the run no longer offers, as one
	 *  stored under a provider since renamed, is replaced by the offered one the question gets an answer from within its
	 *  turn: where the registry offers a model that states it does not think beside ones that do, that one stands, since a
	 *  thinking model's answer can spend the turn's token budget on reasoning and carry no text back. With no catalog, the
	 *  remembered one stands. */
	private offeredModel(): string {
		if (this._models.length > 0 && !this._models.some((m) => m.id === this.state.model)) this.setState({ model: (this._models.find((m) => m.capabilities?.thinking === false) ?? this._models[0]).id });
		return this.state.model;
	}

	render(): TemplateResult {
		const conversation = this.#conversation.state;
		const running = inFlight(conversation.asked?.status);
		const refusal = this.#refusal;
		// The input line's own extensions, and the ask's: this pane owns the line under ask mode, so it renders both.
		const uiExtensionTags = [...getActionBarChatExtensionTags(), ...getActionBarAskExtensionTags()];
		return html`
			${this.showControls ? this.settingsTemplate(conversation) : nothing}
			<div class="transcript"><slot></slot></div>
			<div class="input-line">
				<slot name="mode-toggle"></slot>
				<textarea class="chat-input" placeholder="Ask about this..." data-testid=${`${this.testIdPrefix}chat-input`} rows="1" autofocus .value=${askDraft.get()} @input=${this.onChatInput} @keydown=${this.onChatKeydown}></textarea>
				${unsafeHTML(uiExtensionTags.map((tag) => `<${tag}></${tag}>`).join(""))}
				<button type="button" class="send-btn" data-testid=${`${this.testIdPrefix}chat-submit`} style=${running ? "display:none" : ""} @click=${this.submitChat}>Send</button>
				<button type="button" class="stop-btn" data-testid=${`${this.testIdPrefix}chat-stop`} style=${running ? "" : "display:none"} @click=${this.onStop}>Stop</button>
				${refusal ? html`<span class="refusal" role="status">${refusal}</span>` : nothing}
			</div>
		`;
	}

	/** What the reader states about the conversation, which the pane's settings control shows: the session the questions
	 *  join, the model that answers them, how many tool calls a turn chains, and what a turn sends about the records. */
	private settingsTemplate(conversation: TConversationState): TemplateResult {
		return html`
			<div class="chat-settings">
				<shu-combobox class="session-select" testid=${`${this.testIdPrefix}session-select`} placeholder="session..." .options=${this.sessionOptions()} .value=${conversation.session ?? NEW_CONVERSATION.value} @combo-change=${this.onSessionChange}></shu-combobox>
				${this._models.length > 0 ? html`<shu-combobox class="model-select" testid=${`${this.testIdPrefix}model-select`} placeholder="model..." .options=${this.#modelOptions} .value=${this.state.model} @combo-change=${this.onModelChange}></shu-combobox>` : nothing}
				<label class="tool-limit-label" title="Max chained tool calls the model may run before asking you to confirm the next one. 0 means every tool call needs confirmation.">
					<span>tool calls</span>
					<input class="tool-limit" type="number" min=${TOOL_LIMIT_MIN} max=${TOOL_LIMIT_MAX} step="1" .value=${String(this.state.toolLimit)} data-testid=${`${this.testIdPrefix}tool-limit`} @change=${this.onToolLimitChange}>
				</label>
				<select class="context-read" data-testid=${`${this.testIdPrefix}context-read`} title="What a turn sends about the records this conversation is about. Context sends the records themselves. Tool cues send what each type holds and the call that reads it, and the model reads what the question needs. Left at the model default, the model states which." .value=${this.state.contextReadBy} @change=${this.onContextReadChange}>
					<option value=${AS_MODEL_STATES}>${this.modelDefaultLabel()}</option>
					${Object.entries(SENDS).map(([reading, sends]) => html`<option value=${reading}>send ${sends}</option>`)}
				</select>
			</div>
		`;
	}

	private onModelChange = (e: CustomEvent): void => {
		const model = e.detail?.value || "";
		if (model === this.state.model) return;
		// What a turn sends about the records belongs to the model that answers: a setting stated for one model, or
		// persisted from an earlier one, no longer names what this model's turns do, so the choice returns to what the
		// model states until the reader states one.
		this.setState({ model, contextReadBy: AS_MODEL_STATES });
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
		const stated = chosen?.options?.contextReadBy ?? (chosen?.capabilities?.tools === undefined ? undefined : chosen.capabilities.tools ? "model" : "run");
		return stated ? `model default (sends ${SENDS[stated]})` : "model default";
	}

	/** A reader stating what this conversation's turns send, or leaving it to the model. */
	private onContextReadChange = (e: Event): void => {
		this.setState({ contextReadBy: ContextReadChoiceSchema.parse((e.target as HTMLSelectElement).value) });
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
		askDraft.set(el.value);
		fitToText(el);
	};

	protected override firstUpdated(): void {
		// A question written before the pane last closed is back in the input, at the height its lines take.
		const input = this.shadowRoot?.querySelector(".chat-input") as HTMLTextAreaElement | null;
		if (input?.value) fitToText(input);
	}
	private onChatKeydown = (e: KeyboardEvent): void => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			void this.submitChat();
		}
	};
	/**
	 * Ask the question in the conversation, or show why it cannot be asked. Send is hidden while a turn is in flight, and
	 * the refusal covers the Enter key and a conversation still opening, stated once the catalog read in flight has
	 * answered, so what it reads is what the question would be sent with. A question not asked stays in the input, and a
	 * turn that ended before the run recorded its question puts it back.
	 *
	 * The question carries the active record's bundle, and replies to the actions bar's turn where the scope holds one:
	 * the latest answer, or the message the reader selected, where the conversation branches.
	 */
	private submitChat = async (): Promise<void> => {
		const chatInput = this.shadowRoot?.querySelector(".chat-input") as HTMLTextAreaElement | null;
		const prompt = chatInput?.value;
		if (!chatInput || !prompt) return;
		try {
			await this.loadModels();
			const subject = currentSubjectState.get();
			const { carries, repliesTo } = nextQuestion(subject);
			const asking = startTurn({
				prompt,
				envelope: {
					patterns: carries?.bundle.patterns ?? [],
					// The view data is the active pane's, whether it is a column of the workspace or the bar the reader acts through.
					viewLd: harvestChatViewLd(),
					maxToolCalls: this.state.toolLimit,
					contextReadBy: this.state.contextReadBy || undefined,
					session: this.#conversation.state.session ?? undefined,
					inReplyTo: repliesTo?.turn,
				},
				target: this.offeredModel(),
			});
			chatInput.value = "";
			askDraft.set("");
			chatInput.style.height = "auto";
			const ended = await asking;
			if (ended.askId === null) restoreQuestion(chatInput, prompt);
		} catch (err) {
			restoreQuestion(chatInput, prompt);
			this.#refusal = errorDetail(err);
			this.requestUpdate();
		}
	};
	private onStop = (): void => {
		dispatchConversationEvent({ type: "stop", reason: "you stopped it" });
	};
}

customElements.define(SHU_TAG.KIHAN_CHAT, ShuKihanChat);
