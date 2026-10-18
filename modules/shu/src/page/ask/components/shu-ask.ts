/**
 * The ask: its settings, the transcript, and the input line with the question, Send and Stop. The settings hold the
 * session, the model, the tool limit and who reads the context, and the pane's settings control shows them, above the
 * transcript, which scrolls under them. The conversation and the page's turn are page-level machines, and the bar's
 * activity history renders the transcript from them into this element's transcript slot. This element doesn't hold either, so
 * the bar removes it when it closes and the conversation continues.
 */
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import { z } from "zod";
import { nothing, html, css, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { ShuElement, type TLinkedData } from "../../components/shu-element.js";
import { shuBaseStyles } from "../../components/styles.js";
import { acts, reads } from "../../domains/links.js";
import { conduit } from "../../controllers/conduit-controller.js";
import { isImageFormat } from "@haibun/core/lib/domains/media-types.js";
import { IndividualAddressSchema } from "@haibun/core/lib/domains/typed-links.js";
import { deploymentAskToolLimit } from "../../controllers/hydration-controller.js";
import { conversationSteps, findStep, getAvailableSteps, requireStep } from "../../controllers/registry-controller.js";
import {
	conversationModelType,
	edgeRecordType,
	getActionBarAskExtensionTags,
	getActionBarChatExtensionTags,
	getEdgeRanges,
	getFieldRel,
} from "../../controllers/catalog-controller.js";
import type { TComboboxOption, TQuestionFork } from "../../../domains/schemas.js";
import {
	anIndividual,
	ContextReadBySchema,
	CONVERSATION_DOMAIN,
	ConversationModelSchema,
	ConversationProviderSchema,
	FILE_PARAM,
	SessionListSchema,
	type TContextIndividual,
	type TContextPattern,
	type TConversationModel,
	type TConversationProvider,
} from "@haibun/core/lib/conversation/domains/conversation.js";
import { GraphQueryResultSchema } from "@haibun/core/lib/quad-types.js";
import { extractQuadsFromEvents } from "@haibun/core/lib/steps/derivations/quad-events.js";
import { LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { STATUS } from "@haibun/core/lib/domains/protocol.js";
import { hasEventStream, subscribeBatchedEvents } from "../../controllers/event-stream-controller.js";
import { currentSubjectState } from "../../controllers/subject-controller.js";
import { SignalController } from "../../controllers/signal-controller.js";
import { nextQuestion, startTurn, allowForTurns, readTurnAllowance, turnAllowance, withdrawFromTurns } from "../controllers/conversation-controller.js";
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
	openConversation,
	turnEnded,
	type TAskedTurn,
	type TConversationState,
} from "../controllers/conversation-controller.js";
import { pageMay } from "../../controllers/authority-controller.js";
import { harvestChatViewLd } from "./context-harvest.js";
import { SHU_TAG } from "../../../domains/elements.js";
import { defineElement } from "../../controllers/element-controller.js";
import { actionRef, recordRef, stepRef } from "../../components/shu-ref.js";
import { reportToRun } from "../../controllers/client-log-controller.js";
import { embeddedPageView } from "../../controllers/page-cell-controller.js";
import { embeddedViewLd } from "../../derivations/embedding.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { readerZone } from "../../derivations/time-format.js";
import { sessionLabel, type TListedSession } from "../derivations/session-label.js";
import "../../components/shu-combobox.js";

/** What a reader says a turn sends. The values are the words the registry and a profile state it in; what each of them
 *  sends is how a reader reads them, and "" means the reader doesn't state a value, which leaves it to the model. */
const AS_MODEL_STATES = "";
const SENDS: Record<z.infer<typeof ContextReadBySchema>, string> = { run: "context", model: "tool cues" };
const ContextReadChoiceSchema = z.enum([AS_MODEL_STATES, ...ContextReadBySchema.options]);

const STANDING_TOOL_LIMIT = 5;
const TOOL_LIMIT_MIN = 0;
const TOOL_LIMIT_MAX = 99;
/** The session selector's choice that leaves the conversation, so the next question starts a session. */
export const NEW_CONVERSATION: TComboboxOption = { value: "new", label: "new conversation" };

/** A page of the models, and how many models actuality offers; a response without a list is a failed read. */
const CatalogPageSchema = GraphQueryResultSchema.extend({ vertices: z.array(ConversationModelSchema) });
/** The read that pages through the records of any declared type. */
const READS_A_TYPE = "graphQuery";
/** How many models one read of the catalog requests. */
const CATALOG_PAGE = 50;
/** A page of the providers the models are grouped under. */
const ProviderPageSchema = GraphQueryResultSchema.extend({ vertices: z.array(ConversationProviderSchema) });

/** The type under which the records of the model type `models` are grouped, as that type declares it: the provider
 *  that serves each model. */
function providerType(models: string): string | undefined {
	const ranges = getEdgeRanges(models);
	if (ranges === undefined) return undefined;
	const grouping = Object.keys(ranges).find((field) => getFieldRel(models, field) === LinkRelations.CONTEXT.rel);
	return grouping ? edgeRecordType(models, grouping) : undefined;
}

/** The types of the model records and of their provider records. A write of either type reads the models again. */
function modelTypes(): string[] {
	const models = conversationModelType();
	if (models === undefined) return [];
	const providers = providerType(models);
	return providers === undefined ? [models] : [models, providers];
}
/** A file the reader added to a question: its name, the record actuality keeps it as, and the page's own copy of it where
 *  it is an image. */
type TAddedFile = { name: string; record: TContextIndividual; shown?: string };

/** A file's bytes as a data: URL. */
function readAsDataUrl(file: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error === null ? new Error(`the file ${file instanceof File ? file.name : "chosen"} couldn't be read`) : reader.error);
		reader.readAsDataURL(file);
	});
}

/** What the chat stores between visits: the model that receives a question, how many chained tool calls a turn may make,
 *  and who reads the records that a turn concerns. `contextReadBy` is unset until a reader states it, and unset means the
 *  model's own profile states which. The view hash addresses the conversation, so the chat doesn't store it. */
const ChatSchema = z.object({
	/** The model the reader chose; unset until the reader or the catalog names one. */
	model: z.string().optional(),
	toolLimit: z.number().int().min(TOOL_LIMIT_MIN).max(TOOL_LIMIT_MAX),
	contextReadBy: ContextReadChoiceSchema,
});

/** Size a text input to the lines it holds. */
function fitToText(input: HTMLTextAreaElement): void {
	input.style.height = "auto";
	input.style.height = `${input.scrollHeight}px`;
}

/** Put a question that wasn't sent back in the input and in the page's draft, where the reader hasn't written another. */
function restoreQuestion(input: HTMLTextAreaElement, prompt: string): void {
	input.value ||= prompt;
	askDraft.set(input.value);
}

export class ShuAsk extends ShuElement<typeof ChatSchema> {
	/** A control doesn't contribute to a conversation's context, since it isn't a view of data. */
	summarizeForContext(): TLinkedData | null {
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
		/* Input/textarea visuals come from SHU_BASE. The ask only adjusts layout (flex basis, height cap). */
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
		/* The files a question carries, above its input line: an image as a thumbnail, another file by its name. */
		.ask-files img { max-height: 4rem; }
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
	static domainSelector = SHU_TAG.ASK;
	/** The chat's remembered options; a new visit restores the model, the tool limit and who reads the context. */
	static persistFields = ["model", "toolLimit", "contextReadBy"] as const;

	private _models: TConversationModel[] = [];
	/** The providers whose models actuality didn't register, and why, as their records state it. */
	#providersWithout: { type: string; providers: TConversationProvider[] } | undefined;
	/** Whether the model catalog was read, so the view states that a run doesn't offer a model, rather than showing an empty list. */
	#modelsRead = false;
	/** The read of the model catalog in flight, so a question asked while it reads waits on that read rather than making
	 *  another. A read that fails is left for the next question to make again. */
	#catalog: Promise<void> | undefined;
	#modelOptions: TComboboxOption[] = [];
	/** The sessions actuality lists, as data: what each is called is derived where it renders, so what a session gained
	 *  goes as soon as this page reads it. */
	#sessions: TListedSession[] = [];
	/** Why the reader's last question was not sent. It shows beside the input until the turn or the conversation moves,
	 *  so a refusal is never shown for a question the reader did not submit. */
	#refusal: string | null = null;
	/** The files the reader added to the question being written: the record actuality keeps each as, which the question
	 *  names among the records it is about, and the page's own copy of an image, which it shows. */
	#files: TAddedFile[] = [];
	/** A question from the history put in the input to edit: the records it was about and the turn it replied to, which
	 *  the edited question is sent with in place of the active record and the bar's turn. */
	#forking: Omit<TQuestionFork, "prompt" | "send"> | null = null;
	#conversation = new SignalController(
		this,
		conversationState,
		(conversation, before) => this.onConversationMove(conversation, before),
		(conversation) => [conversation.status, conversation.session, conversation.asked?.status, conversation.asked?.refused.length],
	);

	static observedHtmlAttributes = ["testid-prefix"];

	/** The input's placeholder, which names the embedded page's view where the page embeds one. */
	private inputPlaceholder(): string {
		const view = embeddedPageView.get();
		return `Ask about ${view === null ? "this" : view.name}...`;
	}

	private get testIdPrefix(): string {
		const prefix = this.getAttribute("testid-prefix");
		return prefix === null ? "" : prefix;
	}

	constructor() {
		// A deployment sets the tool limit an ask starts with, and a limit the reader chose is remembered over it.
		const deployed = deploymentAskToolLimit();
		super(ChatSchema, { toolLimit: deployed === undefined ? STANDING_TOOL_LIMIT : deployed, contextReadBy: AS_MODEL_STATES });
	}

	protected override onConnected(): void {
		this.#readModels();
		// Actuality's models are the records of its model type, which discovery and a new profile write, and discovery records
		// each provider it queried, so the models are read again when actuality records either.
		if (hasEventStream())
			this.autoTeardown(
				subscribeBatchedEvents({
					onBatch: (events) => {
						const read = modelTypes();
						if (!extractQuadsFromEvents(events).some((quad) => read.includes(quad.namedGraph))) return;
						this.#catalog = undefined;
						this.#readModels();
					},
				}),
			);
		void this.refreshSessionList();
		// A turn that any page sends changes what a session holds, so the list is read again on actuality's reports rather
		// than on this page's own turns alone.
		this.autoTeardown(followReportedTurns(() => void this.refreshSessionList()));
		// What this page has read of a session sets what the list shows each gained, so opening one states the list again.
		this.watchSignal(sessionsRead);
		this.watchSignal(turnAllowance);
		this.watchSignal(embeddedPageView);
		readTurnAllowance().catch((err: unknown) => reportToRun("error", "shu-ask", `what this page allows its turns was not read: ${errorDetail(err)}`));
	}

	/** What the selector offers: a new conversation, then each session actuality lists. */
	private sessionOptions(): TComboboxOption[] {
		return [
			NEW_CONVERSATION,
			...this.#sessions.map((session) => ({ value: session.session, label: sessionLabel(session, gainedSince(session.session, session.turns), new Date(), readerZone()) })),
		];
	}

	/** Fetch the persisted chat sessions (newest first) for the selector. */
	private async listSessions(): Promise<TListedSession[]> {
		await getAvailableSteps();
		const list = conversationSteps()?.sessions;
		if (list === undefined) return [];
		// A response that doesn't carry a list is a failed read, not an empty one: the schema states what came back instead.
		return SessionListSchema.parse(await conduit().follow(reads(list.method), "ask: list the sessions")).sessions;
	}

	/** Refresh the selector's sessions. A failed read leaves the selector as it was and is reported: which sessions exist
	 *  is beside the conversation, which continues whether or not the list came back. */
	private async refreshSessionList(): Promise<void> {
		try {
			const sessions = await this.listSessions();
			this.#sessions = sessions;
		} catch (err) {
			reportToRun("error", "shu-ask", `the session list did not refresh: ${errorDetail(err)}`);
			return;
		}
		this.requestUpdate();
	}

	/** Any move clears the refusal. The page's turn that ends while the pane is mounted lists its session, and a completed
	 *  response is spoken. */
	private onConversationMove(conversation: TConversationState, before: TConversationState | undefined): void {
		this.#refusal = null;
		const turn = conversation.asked;
		if (!turn || !turnEnded(before?.asked?.status, turn.status)) return;
		if (turn.status === STATUS.completed) {
			this.shadowRoot?.querySelectorAll<HTMLElement>("shu-voice-client").forEach((el) => {
				const maybeSpeak = (el as { speak?: unknown }).speak;
				if (typeof maybeSpeak === "function") maybeSpeak.call(el, turn.response);
			});
		}
		// Actuality writes the turn whether or not its stream announced a seqPath, so the session list changes in both cases.
		void this.refreshSessionList();
	}

	private onSessionChange = (e: CustomEvent<{ value: string }>): void => {
		const { value } = e.detail;
		if (value === NEW_CONVERSATION.value) closeConversation();
		else void openConversation(value, "activate");
	};

	/** Read the model catalog, reporting a read that fails to actuality. */
	#readModels(): void {
		this.loadModels().catch((err: unknown) => reportToRun("error", "shu-ask", `the model catalog was not read: ${errorDetail(err)}`));
	}

	private loadModels(): Promise<void> {
		this.#catalog ??= this.readCatalog().catch((err: unknown) => {
			this.#catalog = undefined;
			throw err;
		});
		return this.#catalog;
	}

	/** Every model actuality offers, read a page at a time until the pages hold as many as the listing states. */
	private async readCatalog(): Promise<void> {
		await getAvailableSteps();
		const type = conversationModelType();
		if (type === undefined || !findStep(READS_A_TYPE)) return;
		const models: TConversationModel[] = [];
		for (;;) {
			const page = CatalogPageSchema.parse(
				await conduit().follow(reads(requireStep(READS_A_TYPE), { query: { label: type, offset: models.length, limit: CATALOG_PAGE } }), "ask: read the models"),
			);
			models.push(...page.vertices);
			if (page.vertices.length === 0 || (!page.saturated && models.length >= page.total)) break;
		}
		this._models = models;
		this.#providersWithout = await this.readProvidersWithout(type);
		this.#modelsRead = true;
		this.#modelOptions = this._models.map((m) => ({ value: m.id, label: m.displayName || m.id }));
		this.#settleModel();
		this.requestUpdate();
	}

	/** The providers whose models actuality didn't register, read from the records of the type its models are grouped under. */
	private async readProvidersWithout(models: string): Promise<{ type: string; providers: TConversationProvider[] } | undefined> {
		const type = providerType(models);
		if (!type || !findStep(READS_A_TYPE)) return undefined;
		const page = ProviderPageSchema.parse(
			await conduit().follow(reads(requireStep(READS_A_TYPE), { query: { label: type, offset: 0, limit: CATALOG_PAGE } }), "ask: read the providers"),
		);
		return { type, providers: page.vertices.filter((provider) => provider.models === 0) };
	}

	/** The providers whose models actuality didn't register, each linked to its record, with why. */
	private providersWithoutTemplate(): TemplateResult | typeof nothing {
		const without = this.#providersWithout;
		if (!without || without.providers.length === 0) return nothing;
		return html`<span class="providers-without" data-testid=${`${this.testIdPrefix}providers-without`}>${without.providers.map(
			(provider) =>
				html`<span>${recordRef(without.type, provider.id)}: ${provider.answered ? "didn't list a model" : provider.why === undefined ? "did not respond to discovery" : `did not respond to discovery: ${provider.why}`}</span>`,
		)}</span>`;
	}

	/** Settle the chosen model on one actuality offers. A stored model choice that actuality no longer offers, as one stored
	 *  under a provider since renamed, is replaced by actuality's standing model. Where actuality doesn't state a standing
	 *  model, it is replaced by a model that states it does not reason, since a reasoning model's response can spend the
	 *  turn's token budget on reasoning and return without text. Without a catalog, the stored choice stands. */
	#settleModel(): void {
		if (this._models.length > 0 && !this._models.some((m) => m.id === this.state.model))
			this.setState({ model: (this._models.find((m) => m.standing) ?? this._models.find((m) => m.capabilities?.thinking === false) ?? itemAt(this._models, 0)).id });
	}

	/** The model a question is sent to: the settled choice. */
	private offeredModel(): string {
		this.#settleModel();
		const { model } = this.state;
		if (model === undefined)
			throw new Error("a question is sent to a model, and actuality's catalog is empty while the reader hasn't chosen a model. Register a model with actuality.");
		return model;
	}

	render(): TemplateResult {
		const conversation = this.#conversation.state;
		const running = inFlight(conversation.asked?.status);
		const refusal = this.#refusal;
		// The input line's own extensions, and the ask pane's: this pane owns the line in its mode, so it renders both.
		const uiExtensionTags = [...getActionBarChatExtensionTags(), ...getActionBarAskExtensionTags()];
		return html`
			${this.showControls ? this.settingsTemplate(conversation) : nothing}
			<div class="transcript"><slot></slot></div>
			${this.turnAuthorityTemplate(conversation.asked)}
			${
				this.#forking
					? html`<div class="forking" role="status" data-testid=${`${this.testIdPrefix}chat-forking`}>
							Editing an earlier question: asking it starts a new branch where that question replied.
							<button type="button" @click=${this.onCancelFork}>cancel</button>
						</div>`
					: nothing
			}
			${
				this.#files.length > 0
					? html`<div class="ask-files">
							${this.#files.map(
								(file) =>
									html`<span data-testid=${`${this.testIdPrefix}ask-file-shown`}>${file.shown ? html`<img src=${file.shown} alt=${file.name} />` : file.name}</span
										><button type="button" @click=${() => this.removeFile(file)}>remove</button>`,
							)}
						</div>`
					: nothing
			}
			<div class="input-line">
				<slot name="mode-toggle"></slot>
				<input type="file" multiple title="Add files to the question" data-testid=${`${this.testIdPrefix}ask-file`} @change=${this.onFilesChosen} />
				<textarea class="chat-input" placeholder=${this.inputPlaceholder()} data-testid=${`${this.testIdPrefix}chat-input`} rows="1" autofocus .value=${askDraft.get()} @input=${this.onChatInput} @keydown=${this.onChatKeydown}></textarea>
				${unsafeHTML(uiExtensionTags.map((tag) => `<${tag}></${tag}>`).join(""))}
				<button type="button" class="send-btn" data-testid=${`${this.testIdPrefix}chat-submit`} style=${running ? "display:none" : ""} @click=${this.submitChat}>Send</button>
				<button type="button" class="stop-btn" data-testid=${`${this.testIdPrefix}chat-stop`} style=${running ? "" : "display:none"} @click=${this.onStop}>Stop</button>
				${refusal ? html`<span class="refusal" role="status">${refusal}</span>` : nothing}
			</div>
		`;
	}

	/**
	 * What the page's turns may do, so the reader sees it and changes it: what the last turn was delegated, each action it
	 * was refused, with the control that allows it and sends the question again once the turn has ended, where the page
	 * holds the action, and what the reader allowed, each with the control that withdraws it.
	 */
	private turnAuthorityTemplate(asked: TAskedTurn | null): TemplateResult | typeof nothing {
		const allowed = turnAllowance.get();
		const { delegated, refused } = asked === null ? { delegated: [], refused: [] } : asked;
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
												? html`<button type="button" data-testid=${`${prefix}turn-allow`} value=${action} @click=${this.onAllow}>Allow ${action} for this page's turns and send again</button>`
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

	/** Allow the action for the page's turns, and send the refused question again from where it was sent: a turn that
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
	 *  join, the model that responds to them, how many tool calls a turn chains, and what a turn sends about the records. */
	private settingsTemplate(conversation: TConversationState): TemplateResult {
		return html`
			<div class="chat-settings">
				<shu-combobox class="session-select" testid=${`${this.testIdPrefix}session-select`} placeholder="session..." .options=${this.sessionOptions()} .value=${conversation.session === null ? NEW_CONVERSATION.value : conversation.session} @combo-change=${this.onSessionChange}></shu-combobox>
				${
					this._models.length > 0
						? html`<shu-combobox class="model-select" testid=${`${this.testIdPrefix}model-select`} placeholder="model..." .options=${this.#modelOptions} .value=${this.offeredModel()} @combo-change=${this.onModelChange}></shu-combobox>`
						: this.#modelsRead
							? html`<span data-testid=${`${this.testIdPrefix}no-models`}>Actuality doesn't hold a model.</span>`
							: nothing
				}
				${this.providersWithoutTemplate()}
				<label class="tool-limit-label" title="The most rounds of tool calls a turn makes. A round is one reply from the model with the calls it requests. A turn that uses every round without a response fails, and 0 doesn't offer the model a tool.">
					<span>tool calls</span>
					<input class="tool-limit" type="number" min=${TOOL_LIMIT_MIN} max=${TOOL_LIMIT_MAX} step="1" .value=${String(this.state.toolLimit)} data-testid=${`${this.testIdPrefix}tool-limit`} @change=${this.onToolLimitChange}>
				</label>
				<select class="context-read" data-testid=${`${this.testIdPrefix}context-read`} title="What a turn sends about the records of this conversation. Context sends the records themselves. Tool cues send what each type holds and the call that reads it, and the model reads what the question needs. Left at the model default, the model states which." .value=${this.state.contextReadBy} @change=${this.onContextReadChange}>
					<option value=${AS_MODEL_STATES}>${this.modelDefaultLabel()}</option>
					${Object.entries(SENDS).map(([reading, sends]) => html`<option value=${reading}>send ${sends}</option>`)}
				</select>
			</div>
		`;
	}

	private onModelChange = (e: CustomEvent<{ value: string }>): void => {
		const model = e.detail.value;
		if (model === this.state.model) return;
		// What a turn sends about the records is a setting of the responding model: a setting stated for one model, or
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
		// An entry that isn't a number leaves the limit the reader last stated.
		const clamped = Number.isFinite(raw) ? Math.max(TOOL_LIMIT_MIN, Math.min(TOOL_LIMIT_MAX, raw)) : this.state.toolLimit;
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
	 * Send the question in the conversation, or show why it cannot be sent. Send is hidden while a turn is in flight, and
	 * the refusal covers the Enter key and a conversation still opening, stated once the catalog read in flight has
	 * returned, so the refusal reads the context the question would carry. A question not sent stays in the input, and a
	 * turn that ended before actuality recorded its question puts it back.
	 *
	 * The question carries the active record's bundle, and replies to the actions bar's turn where the scope holds one:
	 * the latest response, or the message the reader selected, where the conversation branches.
	 */
	private submitChat = async (): Promise<void> => {
		const chatInput = this.shadowRoot?.querySelector(".chat-input") as HTMLTextAreaElement | null;
		const prompt = chatInput?.value;
		if (!chatInput || !prompt) return;
		try {
			await this.loadModels();
			// A file the reader added is kept before the question names it, so a question sent during the keep carries it.
			await this.#keeping;
			const { carries, repliesTo } = nextQuestion(currentSubjectState.get());
			const forking = this.#forking;
			this.#forking = null;
			// A file the reader added is a record actuality keeps, so the question names it as it names any record.
			const added = this.#files.map((file) => file.record);
			const asking = forking
				? this.askWith(prompt, [...forking.patterns, ...added], forking.inReplyTo)
				: this.askWith(prompt, carries === null ? added : [...carries.bundle.patterns, ...added], repliesTo?.turn);
			const files = this.#files;
			this.#files = [];
			chatInput.value = "";
			askDraft.set("");
			chatInput.style.height = "auto";
			const ended = await asking.catch((err: unknown) => {
				this.#files = files;
				throw err;
			});
			for (const file of files) if (file.shown) URL.revokeObjectURL(file.shown);
			if (ended.askId === null) restoreQuestion(chatInput, prompt);
		} catch (err) {
			restoreQuestion(chatInput, prompt);
			this.#refusal = errorDetail(err);
			this.requestUpdate();
		}
	};
	/** Send `prompt` about the records `patterns` name, replying to the turn `inReplyTo` names, in the open conversation,
	 *  with the model, the tool limit and the context reading the reader set. The view data is the active pane's, whether
	 *  it is a column of the workspace or the bar through which the reader acts. */
	private askWith(prompt: string, patterns: TContextPattern[], inReplyTo: string | undefined): Promise<TAskedTurn> {
		return startTurn({
			prompt,
			envelope: {
				patterns,
				// The page the reader is on, where a page embedding shu posts it, is part of the view with only the bar open.
				viewLd: [...harvestChatViewLd(document), ...embeddedViewLd(embeddedPageView.get())],
				maxToolCalls: this.state.toolLimit,
				contextReadBy: this.state.contextReadBy || undefined,
				session: this.#conversation.state.session ?? undefined,
				inReplyTo,
			},
			target: this.offeredModel(),
		});
	}

	/** The keep of the files the reader chose last, which a question sent before it ends awaits. */
	#keeping: Promise<void> = Promise.resolve();

	/** Keep each file the reader chose as a record of actuality's, which the question then names. */
	private readonly onFilesChosen = (e: Event): Promise<void> => (this.#keeping = this.keepFiles(e.target as HTMLInputElement));

	/** Keeps each file `input` holds, and adds each record to the files the next question names. A refusal is shown. */
	private async keepFiles(input: HTMLInputElement): Promise<void> {
		try {
			if (input.files === null) throw new Error("the file input changed without a file list; the ask reads files only from an input of type file");
			for (const file of input.files) {
				const keep = conversationSteps()?.file;
				if (keep === undefined) throw new Error(`actuality doesn't declare a step that returns ${CONVERSATION_DOMAIN.FILE}, which keeps a question's file`);
				const params = { [FILE_PARAM.file]: await readAsDataUrl(file), [FILE_PARAM.name]: file.name };
				const kept = await conduit().follow(acts(keep.method, params), "ask: keep the question's file");
				const shown = isImageFormat(file.type) ? URL.createObjectURL(file) : undefined;
				const { persistedAs, id } = IndividualAddressSchema.parse(kept);
				this.#files = [...this.#files, { name: file.name, record: anIndividual(persistedAs, id), shown }];
			}
		} catch (err) {
			this.#refusal = errorDetail(err);
		}
		input.value = "";
		this.requestUpdate();
	}

	private removeFile(file: TAddedFile): void {
		if (file.shown) URL.revokeObjectURL(file.shown);
		this.#files = this.#files.filter((kept) => kept !== file);
		this.requestUpdate();
	}

	/** Sends `text`, as the reader typing it and pressing Send does. */
	async enter(text: string): Promise<void> {
		await this.updateComplete;
		const input = this.shadowRoot?.querySelector<HTMLTextAreaElement>(".chat-input");
		if (!input) throw new Error("the ask pane doesn't render its input line");
		input.value = text;
		askDraft.set(text);
		await this.submitChat();
	}

	/**
	 * Send a question from the history again, replying where it replied, as a branch there: at once as it was, or put in
	 * the input to edit, sent with the records it was about when the reader sends it. A question sent at once is started,
	 * as Send starts one, and the turn responds on the stream.
	 */
	async fork({ prompt, patterns, inReplyTo, send }: TQuestionFork): Promise<void> {
		if (send) {
			void this.showingRefusal(async () => {
				await this.loadModels();
				await this.askWith(prompt, patterns, inReplyTo);
			});
			return;
		}
		this.#forking = { patterns, inReplyTo };
		askDraft.set(prompt);
		this.requestUpdate();
		await this.updateComplete;
		this.shadowRoot?.querySelector<HTMLTextAreaElement>(".chat-input")?.focus();
	}

	private onCancelFork = (): void => {
		this.#forking = null;
		this.requestUpdate();
	};

	private onStop = (): void => {
		dispatchConversationEvent({ type: "stop", reason: STOPPED_BY_THE_READER });
	};
}

defineElement(SHU_TAG.ASK, ShuAsk);
