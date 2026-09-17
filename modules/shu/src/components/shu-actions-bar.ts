/**
 * <shu-actions-bar>: the bar along the bottom of the page, with a strip that stays and a body that opens over the views.
 * Search, Ask and Step modes share one output region, the activity history, and change only the input line beneath it.
 * The bar composes its subsystems, each a controller in its own file: how it stands (height), the corner controls
 * (corners), step mode (steps) and search mode (query). The bar itself holds the mode, the history, the breadcrumb,
 * the conversation its address names, the UI extensions consumers declare for its slots, and the sync notice.
 */
import { z } from "zod";
import { html, nothing, type TemplateResult } from "lit-html";
import { classMap } from "lit-html/directives/class-map.js";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import type { CSSResultGroup } from "lit";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { ActionsBarHeight } from "./actions-bar-height.js";
import { ActionsBarCorners } from "./actions-bar-corners.js";
import { ActionsBarSteps } from "./actions-bar-steps.js";
import { ActionsBarQuery } from "./actions-bar-query.js";
import { ACTIONS_BAR_STYLES } from "./actions-bar-styles.js";
import { SHU_EVENT, ACTION_BAR_ASK_SLOT, ACTION_BAR_CHAT_SLOT, PERMISSIONS_SLOT, SHU_TAG, CONVERSATION_PARAM } from "../consts.js";
import { ActionsBarSchema, StepChoiceSchema } from "../schemas.js";
// Constructed with `new` (not createElement + type-cast): the value use keeps the registering module in the
// bundle: esbuild strips a TS import whose bindings only appear in type positions, silently dropping the
// customElements.define side effect and leaving un-upgraded elements at runtime.
import { ShuActivityHistory } from "./shu-activity-history.js";
import { SignalController } from "../controllers/signal-controller.js";
import { activePane, pageContext, stripPanes } from "../signals.js";
import { isServerUnreachable } from "../hypermedia.js";
import { closeConversation, conversationState, openConversation } from "../conversation.js";
import { hashParam, onHashChanged } from "../view-hash.js";
import { eventStream, type TEvent } from "../event-stream.js";
import { isOffline } from "../rpc-registry.js";
import { getActionBarChatExtensionTags, whenSiteMetadataReady } from "../rels-cache.js";
import { reportToRun, type TClientLogLevel } from "../client-log.js";

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
		onTrailChange: () => this.updateBreadcrumbDisplay(),
	});
	/** Step mode: the steps the run offers, the step input line, and the callers opened in the history. */
	#steps = new ActionsBarSteps(this, { testIdPrefix: () => this.testIdPrefix, selectedLabel: () => this.#query.selectedLabel, history: this._history });
	/** The corner controls and their popover: settings, access and authority, the time offset and playback, the status. */
	#corners = new ActionsBarCorners(this, {
		testIdPrefix: () => this.testIdPrefix,
		accessLevel: () => this.#query.accessLevel,
		setAccessLevel: (level) => this.#query.setAccessLevel(level),
	});
	/** How the bar stands: open or closed, pinned, dragged, and the footprint of its closed strip. */
	#height = new ActionsBarHeight(this, { state: () => this.state, setState: (patch) => this.setState(patch) });
	/** The page's context, which the search describes and the breadcrumb names, read wherever the bar is placed. */
	#context = new SignalController(this, pageContext, (context) => {
		if (context) this.#query.setContext(context.patterns, context.accessLevel, context);
	});
	/** The strip's panes and the one the reader is on, which the breadcrumb names. */
	#panes = new SignalController(this, stripPanes, () => this.updateBreadcrumbDisplay());
	#activePane = new SignalController(this, activePane, () => this.updateBreadcrumbDisplay());

	static observedHtmlAttributes = ["api-base", "testid-prefix"];

	static get styles(): CSSResultGroup {
		return ACTIONS_BAR_STYLES;
	}

	private get testIdPrefix(): string {
		return this.getAttribute("testid-prefix") || "";
	}

	/** The mode toggle and the pinned-open latch are remembered across reloads (ShuElement.persistFields; singleton key). */
	static persistFields = ["mode", "pinned", "heightProportion"] as const;

	constructor() {
		super(ActionsBarSchema, { askExpanded: false, pinned: false, mode: "search" });
	}

	/**
	 * Open the step input pre-selected to `method`, for a `STEP_CHOOSE` a view raises: the affordances panel's cards route
	 * through the same step-caller flow as the actions-bar combo. When `args` are supplied, they are passed as fixed params
	 * (rendered inline, not editable); when `auto` is true, the step-caller dispatches immediately on mount without
	 * showing the input form.
	 */
	private async chooseStep(method: string, args?: Record<string, unknown>, auto?: boolean): Promise<void> {
		this.setState({ mode: "step", askExpanded: true });
		await this.updateComplete;
		this.#steps.pick(method, args, auto);
	}

	expand(): void {
		this.#height.open();
	}

	/** Say something on the strip. */
	setStatus(message: string): void {
		this.#corners.setStatus(message);
	}

	private failFast(message: string): never {
		this.setStatus(message);
		throw new Error(message);
	}

	private updateBreadcrumbDisplay(): void {
		const bc = this.shadowRoot?.querySelector("shu-breadcrumb") as
			| (HTMLElement & {
					setTrail?: (label: string, cols: string[], active: number) => void;
			  })
			| null;
		if (!bc?.setTrail) return;
		const panes = this.#panes.state;
		bc.setTrail(
			this.#query.trailLabel,
			panes.filter((pane) => !pane.query).map((pane) => pane.label),
			panes.findIndex((pane) => pane.key === this.#activePane.state),
		);
	}

	/** Open the conversation the address names, with the bar expanded in Ask mode, or leave the conversation when the
	 *  address names none. An address the conversation already follows changes nothing. */
	private followConversationAddress = (): void => {
		const session = hashParam(CONVERSATION_PARAM);
		if (session === (conversationState.get().session ?? "")) return;
		if (!session) return closeConversation();
		this.setState({ mode: "ask", askExpanded: true });
		void openConversation(session, "update");
	};

	protected override onConnected(): void {
		// The shared output region carries the one output test id every mode's assertions point at.
		this._history.setAttribute("data-testid", `${this.testIdPrefix}chat-output`);
		this.#query.loadProperties();
		this.#height.openIfPinned();
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
			void this.loadUiExtensions().catch((err) => this.reportActionsBar("warn", "optional UI extensions failed to load", { error: errorDetail(err) }));
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
					onBatch: (events) => {
						// The run has moved on, so where the cursor sits in it may read differently.
						this.#corners.showTime(this.timeCursor);
						this.#query.observe(events);
					},
				}),
			);
		}
	}

	protected override onDisconnected(): void {
		this._unsubscribeSync?.();
	}

	private async loadUiExtensions(): Promise<void> {
		// Wait for the concern catalog to populate site metadata before reading
		// `ui` extensions, connectedCallback can fire before the catalog RPC
		// completes, so synchronous reads at mount time miss every extension.
		const meta = await whenSiteMetadataReady();
		const errors: string[] = [];
		const slotted: Array<[string, Record<string, unknown>]> = [];
		for (const [label, ui] of Object.entries(meta.ui)) {
			if ((ui.slot === ACTION_BAR_CHAT_SLOT || ui.slot === ACTION_BAR_ASK_SLOT || ui.slot === PERMISSIONS_SLOT) && ui.js) slotted.push([label, ui]);
		}
		this.reportActionsBar("debug", `loadUiExtensions: ${slotted.length} action-bar slot extensions found`, { count: slotted.length });
		for (const [label, ui] of slotted) {
			const raw = String(ui.js);
			const apiBase = this.getAttribute("api-base") || "";
			const jsUrl = raw.startsWith("http") || raw.startsWith("/") ? raw : `${apiBase}/${raw}`;
			this.reportActionsBar("debug", `loading action-bar slot extension for ${label} from ${jsUrl}`, { label, jsUrl });
			try {
				await import(jsUrl);
				this.requestUpdate();
				this.reportActionsBar("debug", `loaded action-bar slot extension for ${label}`, { label, jsUrl });
			} catch (e) {
				const message = `Failed to load UI extension for ${label} from ${jsUrl}: ${errorDetail(e)}`;
				this.reportActionsBar("error", message, { label, jsUrl, error: errorDetail(e) });
				errors.push(message);
			}
		}
		if (errors.length > 0) throw new Error(errors.join("\n"));
	}

	private reportActionsBar(level: TClientLogLevel, message: string, attributes: Record<string, unknown> = {}): void {
		reportToRun(level, "shu-actions-bar", message, {
			"haibun.shu.actions-bar.event": "ui-extension",
			...attributes,
			...(level === "error"
				? {
						"haibun.autonomic.event": "step.failure",
						"exception.type": "ActionsBarUiExtension",
						"exception.message": typeof attributes.error === "string" ? attributes.error : message,
					}
				: {}),
		});
	}

	/**
	 * Say where the cursor sits in the run, as elapsed seconds from its first event, so the control reads `now` while
	 * every view is showing now and a real offset once a moment is pinned.
	 */
	protected onTimeSync(cursor: number | null): void {
		this.#corners.showTime(cursor);
	}

	render(): TemplateResult {
		// Single outer template so lit preserves the `.actions-bar` host across collapse/expand. The expanded-only children (filter bar, body) are returned conditionally so the `app-mode-select` test id disappears when collapsed, feature tests use `has test id app-mode-select` as the proxy for "bar is expanded" and that check counts elements regardless of CSS visibility.
		const hasAsk = this.#steps.offersAsk;
		const expanded = this.state.askExpanded;
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
		// The resize grip sits at the TOP edge of the open overlay (the bar grows up from the bottom, so the top edge is
		// where it meets the content), drag it to resize. Only present when expanded; there is nothing to resize collapsed.
		const resizeHandle = expanded
			? html`<div class="resize-handle" data-testid=${`${this.testIdPrefix}resize-handle`} title="Drag to resize" @pointerdown=${this.#height.onResizeDown}></div>`
			: nothing;
		return html`<div class=${classMap({ "actions-bar": true, collapsed: !expanded })}>
				${resizeHandle}
				${body}
				${this.summaryTemplate()}
			</div>`;
	}

	protected updated(): void {
		this.updateBreadcrumbDisplay();
	}

	private summaryTemplate(): TemplateResult {
		const pinned = this.state.pinned;
		const expanded = this.state.askExpanded;
		// The opener (step-ui expandActionsBar) clicks `summary-bar` to expand: it must be a small, definite click target,
		// not the full-width strip (a wide div's center lands on empty space / a child and reads as outside the viewport).
		// So the test-id rides this chevron; the strip still expands on a bare click for the human.
		return html`<div class="summary-bar" @click=${this.#height.onStripClick}>
			${this.#corners.popoverTemplate()}
			<button class="bar-twisty" aria-label=${expanded ? "Collapse actions bar" : "Expand actions bar"} aria-expanded=${expanded}
				data-testid=${`${this.testIdPrefix}summary-bar`}>${expanded ? "▾" : "▴"}</button>
			${this.#corners.statusTemplate()}
			<shu-breadcrumb></shu-breadcrumb>
			${this.#corners.controlsTemplate()}
			<button class="pane-icon" aria-label=${pinned ? "Unpin actions bar" : "Pin actions bar open"} aria-pressed=${pinned}
				data-testid=${`${this.testIdPrefix}ask-button`} @click=${this.#height.onPinToggle}>\u{1F4CC}</button>
		</div>`;
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
		// Switching the input mode closes a corner picker floating over the input, and leaves the playback panel open.
		this.#corners.dismissPicker();
		this.setState({ mode });
	};
}
