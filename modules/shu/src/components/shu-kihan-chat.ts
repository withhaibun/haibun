/**
 * The ask: its settings, the transcript, and the input line with the question, Send and Stop. The settings hold the
 * session, the model, the tool limit and who reads the context, and the pane's settings control shows them, above the
 * transcript, which scrolls under them. The conversation and the page's turn are page-level machines, and the bar's
 * activity history renders the transcript from them into this element's transcript slot. This element doesn't hold either, so
 * the bar removes it when it closes and the conversation continues.
 */
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { z } from "zod";
import { nothing, html, css, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { acts, reads, conduit } from "../hypermedia.js";
import { artifactAt } from "../artifact-url.js";
import { ImageReferenceSchema, KEPT_IMAGE_FORMATS, type TImageReference } from "@haibun/core/lib/image-reference.js";
import { deploymentAskToolLimit, findStep, getAvailableSteps, requireStep } from "../rpc-registry.js";
import { edgeRecordType, getActionBarAskExtensionTags, getActionBarChatExtensionTags, getEdgeRanges, getRelSync } from "../rels-cache.js";
import { ContextReadBySchema, SessionListSchema, type TComboboxOption, type TContextPattern, type TQuestionRestate } from "../schemas.js";
import { GraphQueryResultSchema, extractQuadsFromEvents } from "@haibun/core/lib/quad-types.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import { hasEventStream, subscribeBatchedEvents } from "../event-stream.js";
import { currentSubjectState } from "../current-subject.js";
import { SignalController } from "../controllers/index.js";
import { nextQuestion, startTurn } from "../chat-turn.js";
import {
	askDraft,
	closeConversation,
	conversationState,
	dispatchConversationEvent,
	STOPPED_BY_THE_READER,
	followReportedTurns,
	gainedSince,
	sessionsRead,
	inFlight,
	KEEP_IMAGE_STEP,
	openConversation,
	turnEnded,
	type TAskedTurn,
	type TConversationState,
} from "../conversation.js";
import { pageMay } from "../page-key.js";
import { allowForTurns, readTurnAllowance, turnAllowance, withdrawFromTurns } from "../turn-allowance.js";
import { harvestChatViewLd } from "../chat-context-harvest.js";
import { SHU_TAG } from "../consts.js";
import { actionRef, recordRef, stepRef } from "./shu-ref.js";
import { reportToRun } from "../client-log.js";
import { embeddedPageView, embeddedViewLd } from "../embedder.js";

/** What a reader says a turn sends. The values are the words the registry and a profile state it in; what each of them
 *  sends is how a reader reads them, and "" means the reader doesn't state a value, which leaves it to the model. */
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
	/** Whether this is the run's standing default, the model a call outside any turn is sent to. */
	standing: z.boolean().optional(),
	options: z.looseObject({ contextReadBy: ContextReadBySchema.optional() }).optional(),
});
type TKihanVertex = z.infer<typeof KihanVertexSchema>;
/** A page of the model catalog, and how many models the run offers; an answer without a list is a failed read. */
const CatalogPageSchema = GraphQueryResultSchema.extend({ vertices: z.array(KihanVertexSchema) });
/** The type the run's models are records of, and the read that lists them. */
const KIHAN = "Kihan";
const CATALOG_STEP = `show${KIHAN}s`;
/** How many models a read of the catalog asks for at a time. */
const CATALOG_PAGE = 50;
/** A provider the run's models are grouped under, as discovery recorded what it answered. */
const ProviderSchema = z.looseObject({ id: z.string(), answered: z.boolean(), models: z.number(), why: z.string().optional() });
type TProvider = z.infer<typeof ProviderSchema>;
const ProviderPageSchema = GraphQueryResultSchema.extend({ vertices: z.array(ProviderSchema) });

/** The type a model's records are grouped under, as the model's type declares it: the provider each is called through. */
function providerType(): string | undefined {
	const grouping = Object.keys(getEdgeRanges(KIHAN) ?? {}).find((field) => getRelSync(KIHAN, field) === LinkRelations.CONTEXT.rel);
	return grouping ? edgeRecordType(KIHAN, grouping) : undefined;
}
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
/** The source the ask pane reports what it couldn't show under. */
const KIHAN_CHAT_SOURCE = "shu-kihan-chat";

/** A file's bytes as a data: URL. */
function readAsDataUrl(file: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error ?? new Error("the file couldn't be read"));
		reader.readAsDataURL(file);
	});
}

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
	/** A control doesn't contribute to the Kihan's context, since it isn't a view of data. */
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
		/* The images a question shows, as thumbnails above its input line. */
		.ask-images img { max-height: 4rem; }
		.turn-authority { flex: 0 0 auto; padding: 0 var(--shu-space-4); font-size: var(--shu-font-sm); color: var(--shu-fg-muted); }
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
	/** The providers whose models the run didn't register, and why, as their records state it. */
	#providersWithout: { type: string; providers: TProvider[] } | undefined;
	/** Whether the model catalog was read, so the view states that a run doesn't offer a model, rather than showing an empty list. */
	#modelsRead = false;
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
	/** The images the reader added to the question being written, kept by the run, which the question shows its model. */
	#images: TImageReference[] = [];
	/** A question from the history put in the input to edit: the records it was about and the turn it replied to, which
	 *  the edited question is sent with in place of the active record and the bar's turn. */
	#restating: Omit<TQuestionRestate, "prompt" | "send"> | null = null;
	#conversation = new SignalController(
		this,
		conversationState,
		(conversation, before) => this.onConversationMove(conversation, before),
		(conversation) => [conversation.status, conversation.session, conversation.asked?.status, conversation.asked?.refused.length],
	);

	static observedHtmlAttributes = ["testid-prefix"];

	private get testIdPrefix(): string {
		return this.getAttribute("testid-prefix") || "";
	}

	constructor() {
		// A deployment sets the tool limit an ask starts with, and a limit the reader chose is remembered over it.
		super(ChatSchema, { toolLimit: deploymentAskToolLimit() ?? TOOL_LIMIT_DEFAULT });
	}

	protected override onConnected(): void {
		this.#readModels();
		// The run's models are its Kihan records, which discovery and a new profile write, and discovery records each
		// provider it asked, so the catalog is read again when the run records either.
		if (hasEventStream())
			this.autoTeardown(
				subscribeBatchedEvents({
					onBatch: (events) => {
						const read = [KIHAN, providerType()];
						if (!extractQuadsFromEvents(events).some((quad) => read.includes(quad.namedGraph))) return;
						this.#catalog = undefined;
						this.#readModels();
					},
				}),
			);
		void this.refreshSessionList();
		// A turn any page asks changes what a session holds, so the list is read again on the run's reports rather than on
		// this page's own turns alone.
		this.autoTeardown(followReportedTurns(() => void this.refreshSessionList()));
		// What this page has read of a session decides what the list says each gained, so opening one states the list again.
		this.watchSignal(sessionsRead);
		this.watchSignal(turnAllowance);
		this.watchSignal(embeddedPageView);
		readTurnAllowance().catch((err: unknown) => reportToRun("error", "shu-kihan-chat", `what this page allows its turns was not read: ${errorDetail(err)}`));
	}

	/** What the selector offers: a new conversation, then each session the run lists. */
	private sessionOptions(): TComboboxOption[] {
		return [NEW_CONVERSATION, ...this.#sessions.map((session) => ({ value: session.session, label: sessionOptionLabel(session) }))];
	}

	/** Fetch the persisted chat sessions (newest first) for the selector. */
	private async listSessions(): Promise<TChatSession[]> {
		await getAvailableSteps();
		if (!findStep("listChatSessions")) return [];
		// An answer that doesn't carry a list is a failed read, not an empty one: the schema states what came back instead.
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

	/** Read the model catalog, reporting a read that fails to the run. */
	#readModels(): void {
		this.loadModels().catch((err: unknown) => reportToRun("error", "shu-kihan-chat", `the model catalog was not read: ${errorDetail(err)}`));
	}

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
		if (!findStep(CATALOG_STEP)) return;
		const models: TKihanVertex[] = [];
		for (;;) {
			const page = CatalogPageSchema.parse(
				await conduit().follow(reads(requireStep(CATALOG_STEP), { offset: models.length, limit: CATALOG_PAGE }), "kihan-chat: load model catalog"),
			);
			models.push(...page.vertices);
			if (page.vertices.length === 0 || models.length >= page.total) break;
		}
		this._models = models;
		this.#providersWithout = await this.readProvidersWithout();
		this.#modelsRead = true;
		this.#modelOptions = this._models.map((m) => ({ value: m.id, label: m.displayName || m.id }));
		this.offeredModel();
		this.requestUpdate();
	}

	/** The providers whose models the run didn't register, read from the records of the type its models are grouped under. */
	private async readProvidersWithout(): Promise<{ type: string; providers: TProvider[] } | undefined> {
		const type = providerType();
		const listing = `show${type}s`;
		if (!type || !findStep(listing)) return undefined;
		const page = ProviderPageSchema.parse(await conduit().follow(reads(requireStep(listing), { offset: 0, limit: CATALOG_PAGE }), "kihan-chat: load providers"));
		return { type, providers: page.vertices.filter((provider) => provider.models === 0) };
	}

	/** The providers whose models the run didn't register, each linked to its record, with why. */
	private providersWithoutTemplate(): TemplateResult | typeof nothing {
		const without = this.#providersWithout;
		if (!without || without.providers.length === 0) return nothing;
		return html`<span class="providers-without" data-testid=${`${this.testIdPrefix}providers-without`}>${without.providers.map(
			(provider) => html`<span>${recordRef(without.type, provider.id)}: ${provider.answered ? "listed no models" : `did not answer discovery: ${provider.why ?? ""}`}</span>`,
		)}</span>`;
	}

	/** The model a question is sent to, which is one the run offers. A remembered model the run no longer offers, as one
	 *  stored under a provider since renamed, is replaced by the run's standing default. Where the run doesn't state a default, it is
	 *  replaced by a model that states it does not think, since a thinking model's answer can spend the turn's token budget
	 *  on reasoning and return without text. Without a catalog, the remembered one stands. */
	private offeredModel(): string {
		if (this._models.length > 0 && !this._models.some((m) => m.id === this.state.model))
			this.setState({ model: (this._models.find((m) => m.standing) ?? this._models.find((m) => m.capabilities?.thinking === false) ?? this._models[0]).id });
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
			${this.turnAuthorityTemplate(conversation.asked)}
			${
				this.#restating
					? html`<div class="restating" role="status" data-testid=${`${this.testIdPrefix}chat-restating`}>
							Editing an earlier question: it replies where that question did.
							<button type="button" @click=${this.onCancelRestate}>cancel</button>
						</div>`
					: nothing
			}
			${
				this.#images.length > 0
					? html`<div class="ask-images">
							${this.#images.map(
								(image) =>
									html`<img data-testid=${`${this.testIdPrefix}ask-image-shown`} src=${artifactAt(image.contentUrl, KIHAN_CHAT_SOURCE)} alt="an image the question shows" /><button type="button" @click=${() => this.removeImage(image)}>remove</button>`,
							)}
						</div>`
					: nothing
			}
			<div class="input-line">
				<slot name="mode-toggle"></slot>
				<input type="file" title="Add an image to the question" accept=${KEPT_IMAGE_FORMATS.join(",")} data-testid=${`${this.testIdPrefix}ask-image`} @change=${this.onImageChosen} />
				<textarea class="chat-input" placeholder=${`Ask about ${embeddedPageView.get()?.name ?? "this"}...`} data-testid=${`${this.testIdPrefix}chat-input`} rows="1" autofocus .value=${askDraft.get()} @input=${this.onChatInput} @keydown=${this.onChatKeydown}></textarea>
				${unsafeHTML(uiExtensionTags.map((tag) => `<${tag}></${tag}>`).join(""))}
				<button type="button" class="send-btn" data-testid=${`${this.testIdPrefix}chat-submit`} style=${running ? "display:none" : ""} @click=${this.submitChat}>Send</button>
				<button type="button" class="stop-btn" data-testid=${`${this.testIdPrefix}chat-stop`} style=${running ? "" : "display:none"} @click=${this.onStop}>Stop</button>
				${refusal ? html`<span class="refusal" role="status">${refusal}</span>` : nothing}
			</div>
		`;
	}

	/**
	 * What the page's turns may do, so the reader sees it and changes it: what the last turn was delegated, each action it
	 * was refused, with the control that allows it and asks the question again once the turn has ended, where the page
	 * holds the action, and what the reader allowed, each with the control that withdraws it.
	 */
	private turnAuthorityTemplate(asked: TAskedTurn | null): TemplateResult | typeof nothing {
		const allowed = turnAllowance.get();
		const delegated = asked?.delegated ?? [];
		const refused = asked?.refused ?? [];
		if (delegated.length === 0 && refused.length === 0 && allowed.length === 0) return nothing;
		const prefix = this.testIdPrefix;
		const ended = !inFlight(asked?.status);
		return html`
			<div class="turn-authority">
				${delegated.length > 0 ? html`<p data-testid=${`${prefix}turn-held`}>The last turn held ${delegated.map((action, i) => html`${i ? ", " : ""}${actionRef(action)}`)}.</p>` : nothing}
				${
					refused.length > 0
						? html`<ul>
							${refused.map(
								({ step, action }) =>
									html`<li>
										${stepRef(step)} was refused: the turn didn't hold ${actionRef(action)}.
										${
											ended && pageMay(action) && !allowed.includes(action)
												? html`<button type="button" data-testid=${`${prefix}turn-allow`} value=${action} @click=${this.onAllow}>Allow ${action} for this page's turns and ask again</button>`
												: nothing
										}
									</li>`,
							)}
						</ul>`
						: nothing
				}
				${
					allowed.length > 0
						? html`<p>This page's turns are also given:</p>
							<ul>
								${allowed.map((action) => html`<li>${actionRef(action)} <button type="button" data-testid=${`${prefix}turn-withdraw`} value=${action} @click=${this.onWithdraw}>Withdraw</button></li>`)}
							</ul>`
						: nothing
				}
			</div>
		`;
	}

	/** Allow the action for the page's turns, and ask the refused question again from where it was asked: a turn that
	 *  replies where the refused one replied forks the conversation there, and holds what the reader allowed. */
	private onAllow = (e: Event): void => {
		const action = (e.currentTarget as HTMLButtonElement).value;
		const refused = this.#conversation.state.asked;
		if (!refused) return;
		void this.showingRefusal(async () => {
			await allowForTurns(action);
			await this.loadModels();
			await this.askWith(refused.prompt, refused.bundle, refused.inReplyTo);
		});
	};
	private onWithdraw = (e: Event): void => void this.showingRefusal(() => withdrawFromTurns((e.currentTarget as HTMLButtonElement).value));

	/** Do what the reader asked for here, and show why it failed where a question's refusal is shown. */
	private async showingRefusal(doing: () => Promise<unknown>): Promise<void> {
		try {
			await doing();
		} catch (err) {
			this.#refusal = errorDetail(err);
			this.requestUpdate();
		}
	}

	/** What the reader states about the conversation, which the pane's settings control shows: the session the questions
	 *  join, the model that answers them, how many tool calls a turn chains, and what a turn sends about the records. */
	private settingsTemplate(conversation: TConversationState): TemplateResult {
		return html`
			<div class="chat-settings">
				<shu-combobox class="session-select" testid=${`${this.testIdPrefix}session-select`} placeholder="session..." .options=${this.sessionOptions()} .value=${conversation.session ?? NEW_CONVERSATION.value} @combo-change=${this.onSessionChange}></shu-combobox>
				${
					this._models.length > 0
						? html`<shu-combobox class="model-select" testid=${`${this.testIdPrefix}model-select`} placeholder="model..." .options=${this.#modelOptions} .value=${this.state.model} @combo-change=${this.onModelChange}></shu-combobox>`
						: this.#modelsRead
							? html`<span data-testid=${`${this.testIdPrefix}no-models`}>No models in this run.</span>`
							: nothing
				}
				${this.providersWithoutTemplate()}
				<label class="tool-limit-label" title="The most rounds of tool calls a turn makes. A round is one reply from the model with the calls it asks for. A turn that uses every round without answering fails, and 0 offers the model no tools.">
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
	 * tool calls reads the records itself, and one that does not is sent them. A model the registry doesn't describe is
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
			const { carries, repliesTo } = nextQuestion(currentSubjectState.get());
			const restating = this.#restating;
			this.#restating = null;
			const asking = restating ? this.askWith(prompt, restating.patterns, restating.inReplyTo) : this.askWith(prompt, carries?.bundle.patterns ?? [], repliesTo?.turn);
			const images = this.#images;
			this.#images = [];
			chatInput.value = "";
			askDraft.set("");
			chatInput.style.height = "auto";
			const ended = await asking.catch((err: unknown) => {
				this.#images = images;
				throw err;
			});
			if (ended.askId === null) restoreQuestion(chatInput, prompt);
		} catch (err) {
			restoreQuestion(chatInput, prompt);
			this.#refusal = errorDetail(err);
			this.requestUpdate();
		}
	};
	/** Ask `prompt` about the records `patterns` name, replying to the turn `inReplyTo` names, in the open conversation,
	 *  with the model, the tool limit and the context reading the reader set. The view data is the active pane's, whether
	 *  it is a column of the workspace or the bar the reader acts through. */
	private askWith(prompt: string, patterns: TContextPattern[], inReplyTo: string | undefined): Promise<TAskedTurn> {
		return startTurn({
			prompt,
			envelope: {
				patterns,
				// The page the reader is on, where a page embedding shu posts it, is part of the view with only the bar open.
				viewLd: [...harvestChatViewLd(), ...embeddedViewLd()],
				maxToolCalls: this.state.toolLimit,
				contextReadBy: this.state.contextReadBy || undefined,
				session: this.#conversation.state.session ?? undefined,
				inReplyTo,
				...(this.#images.length > 0 ? { images: this.#images } : {}),
			},
			target: this.offeredModel(),
		});
	}

	/** Keep each image the reader chose in the run, which the question then names. */
	private readonly onImageChosen = async (e: Event): Promise<void> => {
		const input = e.target as HTMLInputElement;
		try {
			for (const file of input.files ?? []) {
				const kept = await conduit().follow(acts(requireStep(KEEP_IMAGE_STEP), { image: await readAsDataUrl(file) }), "kihan-chat: keep the question's image");
				this.#images = [...this.#images, ImageReferenceSchema.parse(kept)];
			}
		} catch (err) {
			this.#refusal = errorDetail(err);
		}
		input.value = "";
		this.requestUpdate();
	};

	private removeImage(image: TImageReference): void {
		this.#images = this.#images.filter((kept) => kept !== image);
		this.requestUpdate();
	}

	/** Asks `text`, as the reader typing it and pressing Send does. */
	async enter(text: string): Promise<void> {
		await this.updateComplete;
		const input = this.shadowRoot?.querySelector<HTMLTextAreaElement>(".chat-input");
		if (!input) throw new Error("the ask pane doesn't render its input line");
		input.value = text;
		askDraft.set(text);
		await this.submitChat();
	}

	/**
	 * Ask a question from the history again, replying where it replied, as a branch there: at once as it was, or put in
	 * the input to edit, sent with the records it was about when the reader sends it. A question sent at once is started,
	 * as Send starts one, and the turn answers on the stream.
	 */
	async restate({ prompt, patterns, inReplyTo, send }: TQuestionRestate): Promise<void> {
		if (send) {
			void this.showingRefusal(async () => {
				await this.loadModels();
				await this.askWith(prompt, patterns, inReplyTo);
			});
			return;
		}
		this.#restating = { patterns, inReplyTo };
		askDraft.set(prompt);
		this.requestUpdate();
		await this.updateComplete;
		this.shadowRoot?.querySelector<HTMLTextAreaElement>(".chat-input")?.focus();
	}

	private onCancelRestate = (): void => {
		this.#restating = null;
		this.requestUpdate();
	};

	private onStop = (): void => {
		dispatchConversationEvent({ type: "stop", reason: STOPPED_BY_THE_READER });
	};
}

customElements.define(SHU_TAG.KIHAN_CHAT, ShuKihanChat);
