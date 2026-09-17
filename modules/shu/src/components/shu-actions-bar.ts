/**
 * <shu-actions-bar>: the view of the page's actions pane, docked along the bottom of the page above the page strip unless
 * the address places it in the strip. Search, Ask and Step modes share one output region, the activity history, and
 * change only the input line beneath it. The bar composes its subsystems, each a controller in its own file: step mode
 * (steps) and search mode (query). The bar itself holds the mode, the history, the conversation its address names, the
 * UI extensions consumers declare for its slots, and the sync notice. The page strip holds the page's status, breadcrumb
 * and corner controls.
 */
import { z } from "zod";
import { html, nothing, type TemplateResult } from "lit-html";
import { classMap } from "lit-html/directives/class-map.js";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import type { CSSResultGroup } from "lit";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { ActionsBarSteps } from "./actions-bar-steps.js";
import { ActionsBarQuery } from "./actions-bar-query.js";
import { ACTIONS_BAR_STYLES } from "./actions-bar-styles.js";
import { SHU_EVENT, ACTION_BAR_ASK_SLOT, ACTION_BAR_CHAT_SLOT, SHU_TAG, CONVERSATION_PARAM } from "../consts.js";
import { SCOPE, dispatchSubjectEvent } from "../current-subject.js";
import type { ShuColumnPane } from "./shu-column-pane.js";
import { ActionsBarSchema, StepChoiceSchema } from "../schemas.js";
// Constructed with `new` (not createElement + type-cast): the value use keeps the registering module in the
// bundle: esbuild strips a TS import whose bindings only appear in type positions, silently dropping the
// customElements.define side effect and leaving un-upgraded elements at runtime.
import { ShuActivityHistory } from "./shu-activity-history.js";
import { SignalController } from "../controllers/signal-controller.js";
import { pageContext, pageStatus, pageTrail } from "../signals.js";
import { loadSlotExtensions } from "./slot-extensions.js";
import { isServerUnreachable } from "../hypermedia.js";
import { closeConversation, conversationState, openConversation } from "../conversation.js";
import { hashParam, onHashChanged } from "../view-hash.js";
import { eventStream, type TEvent } from "../event-stream.js";
import { isOffline } from "../rpc-registry.js";
import { getActionBarChatExtensionTags } from "../rels-cache.js";
import { reportToRun } from "../client-log.js";

type TMode = z.infer<typeof ActionsBarSchema>["mode"];

export class ShuActionsBar extends ShuElement<typeof ActionsBarSchema> {
	/** A control, not a view of data, contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static schema = ActionsBarSchema;
	static domainSelector = SHU_TAG.ACTIONS_BAR;

	private _unsubscribeSync?: () => void;
	/** The shared output region: one node for the bar's lifetime, so accumulated activity survives mode switches
	 *  and collapse/expand. */
	private _history = new ShuActivityHistory();
	/** Search mode: the type, text search, conditions and select filters, and the searches recorded in the history. */
	#query = new ActionsBarQuery(this, {
		testIdPrefix: () => this.testIdPrefix,
		history: this._history,
		setStatus: (message) => this.setStatus(message),
		onTrailChange: () => pageTrail.set(this.#query.trailLabel),
	});
	/** Step mode: the steps the run offers, the step input line, and the callers opened in the history. */
	#steps = new ActionsBarSteps(this, { testIdPrefix: () => this.testIdPrefix, selectedLabel: () => this.#query.selectedLabel, history: this._history });
	/** The page's context, which the search describes, read wherever the bar is placed. */
	#context = new SignalController(this, pageContext, (context) => {
		if (context) this.#query.setContext(context.patterns, context.accessLevel, context);
	});

	static observedHtmlAttributes = ["api-base", "testid-prefix"];

	/** The reader acts on another view through the bar, so acting in the bar leaves that view the active pane. */
	static override activates = false;

	/** Whether the bar's scope of the active record was last raised open. */
	#scopeOpen = false;

	static get styles(): CSSResultGroup {
		return ACTIONS_BAR_STYLES;
	}

	private get testIdPrefix(): string {
		return this.getAttribute("testid-prefix") || "";
	}

	/** The mode is remembered across reloads (ShuElement.persistFields; singleton key). Its pane remembers its height and pin. */
	static persistFields = ["mode"] as const;

	constructor() {
		super(ActionsBarSchema, { mode: "search" });
	}

	/** Whether the bar is open: its pane isn't collapsed. */
	private get isOpen(): boolean {
		return !this.columnCollapsed;
	}

	/** Open the bar's pane, wherever the pane is placed. */
	private openPane(): void {
		(this.closest(SHU_TAG.COLUMN_PANE) as ShuColumnPane | null)?.open();
	}

	/** The bar opening or closing, as its pane opens or collapses, opens or closes its scope of the active record. */
	#raiseScope(): void {
		const open = this.isConnected && this.isOpen;
		if (open === this.#scopeOpen) return;
		this.#scopeOpen = open;
		dispatchSubjectEvent({ type: open ? "open" : "close", scope: SCOPE.actionsBar });
	}

	/**
	 * Open the step input pre-selected to `method`, for a `STEP_CHOOSE` a view raises: the affordances panel's cards route
	 * through the same step-caller flow as the actions-bar combo. When `args` are supplied, they are passed as fixed params
	 * (rendered inline, not editable); when `auto` is true, the step-caller dispatches immediately on mount without
	 * showing the input form.
	 */
	private async chooseStep(method: string, args?: Record<string, unknown>, auto?: boolean): Promise<void> {
		this.setState({ mode: "step" });
		this.openPane();
		await this.updateComplete;
		this.#steps.pick(method, args, auto);
	}

	/** Say something on the page strip. */
	setStatus(message: string): void {
		pageStatus.set(message);
	}

	private failFast(message: string): never {
		this.setStatus(message);
		throw new Error(message);
	}

	/** Open the conversation the address names, with the bar expanded in Ask mode, or leave the conversation when the
	 *  address names none. An address the conversation already follows changes nothing. */
	private followConversationAddress = (): void => {
		const session = hashParam(CONVERSATION_PARAM);
		if (session === (conversationState.get().session ?? "")) return;
		if (!session) return closeConversation();
		this.setState({ mode: "ask" });
		this.openPane();
		void openConversation(session, "update");
	};

	protected override onConnected(): void {
		// The shared output region carries the one output test id every mode's assertions point at.
		this._history.setAttribute("data-testid", `${this.testIdPrefix}chat-output`);
		this.#query.loadProperties();
		this.followConversationAddress();
		this.autoTeardown(onHashChanged(this.followConversationAddress));
		// A view raises a step choice wherever it is placed, and the bar is not its ancestor, so the document is where both meet.
		this.autoListen(document, SHU_EVENT.STEP_CHOOSE, (e: Event) => {
			const { method, args, auto } = StepChoiceSchema.parse((e as CustomEvent).detail);
			void this.chooseStep(method, args, auto);
		});

		// Optional action-bar slot extensions load once the types are read: a missing or unserved one is reported by itself
		// and does not stop the bar.
		const types = this.#query.loadDomains().then(() => {
			void loadSlotExtensions(SHU_TAG.ACTIONS_BAR, [ACTION_BAR_CHAT_SLOT, ACTION_BAR_ASK_SLOT], this.getAttribute("api-base") || "", () => this.requestUpdate()).catch((err) =>
				reportToRun("warn", SHU_TAG.ACTIONS_BAR, "optional UI extensions failed to load", { error: errorDetail(err) }),
			);
		});
		void Promise.all([types, this.#steps.load(), this.#query.loadSelectValues()]).catch((err) => {
			// What this bar offers comes from the server; unreachable, it reports that and the page reads what it caches.
			if (isServerUnreachable(err)) return this.setStatus(`the server did not respond: this bar offers what the page already read`);
			this.failFast(`ShuActionsBar initialization failed: ${errorDetail(err)}`);
		});

		try {
			this._unsubscribeSync = eventStream().subscribe(
				(event: TEvent) => this.dispatchEvent(new CustomEvent(SHU_EVENT.SYNC_AVAILABLE, { detail: event, bubbles: true, composed: true })),
				(event: TEvent) => event.kind === "imap-sync",
			);
		} catch {
			// No EventStream installed (early-mount in tests); skip live sync wiring.
		}

		// Live filter values: a batch carrying a change in the selected type's named graph may add a distinct value (a new
		// folder, a status), read out of the batch, so the menus stay current without a reload or a request.
		if (!isOffline()) {
			this.autoTeardown(
				this.subscribeBatched({
					onBatch: (events) => this.#query.observe(events),
				}),
			);
		}
	}

	protected override onDisconnected(): void {
		this._unsubscribeSync?.();
		this.#raiseScope();
	}

	/** The bar opens or closes with its pane, which renders the bar again. */
	protected updated(): void {
		this.#raiseScope();
	}

	render(): TemplateResult {
		// Single outer template so lit preserves the `.actions-bar` host across collapse/expand. The expanded-only children (filter bar, body) are returned conditionally so the `app-mode-select` test id disappears when collapsed, feature tests use `has test id app-mode-select` as the proxy for "bar is expanded" and that check counts elements regardless of CSS visibility.
		const hasAsk = this.#steps.offersAsk;
		const expanded = this.isOpen;
		// Every mode shares ONE output region (this._history, the same node every render) with the mode's input line
		// beneath: switching modes changes only the input line. Ask renders only when an ask-capable step exists, so a
		// chosen Ask mode renders search until the steps load, and on a deployment with no ask-capable step.
		const mode = this.state.mode === "ask" && !hasAsk ? "search" : this.state.mode;
		const inputLine =
			mode === "ask"
				? this.askModeTemplate(hasAsk)
				: mode === "step"
					? this.#steps.template(this.modeToggleTemplate(hasAsk))
					: this.#query.template(this.modeToggleTemplate(hasAsk));
		// The input line's own extensions (dictation among them) serve every mode, and the ask pane renders them where it
		// owns that line; the bar renders them for every other mode. What is about the ask itself rides the ask's slot,
		// which the pane alone renders: rendered in every mode, the context status stood under a search bar reporting a
		// conversation the reader was not having.
		const body = expanded ? html`${this._history}${mode === "ask" ? nothing : this.uiExtensionsTemplate()}${inputLine}` : nothing;
		return html`<div class=${classMap({ "actions-bar": true, collapsed: !expanded })}>${body}</div>`;
	}

	private modeToggleTemplate(hasAsk: boolean, slot?: string): TemplateResult {
		return html`<select
			class="mode-select"
			slot=${slot ?? nothing}
			data-testid=${`${this.testIdPrefix}mode-select`}
			@change=${this.onModeChange}
		>
			<option value="search" ?selected=${this.state.mode === "search"}>Search</option>
			${hasAsk ? html`<option value="ask" ?selected=${this.state.mode === "ask"}>Ask</option>` : nothing}
			<option value="step" ?selected=${this.state.mode === "step"}>Step</option>
		</select>`;
	}

	private askModeTemplate(hasAsk: boolean): TemplateResult {
		return html`<shu-kihan-chat testid-prefix=${this.testIdPrefix}>${this.modeToggleTemplate(hasAsk, "mode-toggle")}</shu-kihan-chat>`;
	}

	private uiExtensionsTemplate(): TemplateResult {
		return html`${unsafeHTML(
			getActionBarChatExtensionTags()
				.map((tag) => `<${tag}></${tag}>`)
				.join(""),
		)}`;
	}

	private onModeChange = (e: Event): void => {
		const mode = (e.target as HTMLSelectElement).value as TMode;
		this.setState({ mode });
	};
}
