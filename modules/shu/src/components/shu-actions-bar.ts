/**
 * <shu-actions-bar>: reusable actions bar with Ask (chat) and Step modes.
 *
 * Ask mode: streams LLM chat responses using server-side context resolution.
 * Step mode: executes a haibun step via RPC and collects log events.
 */
import { z } from "zod";
import { html, nothing, type TemplateResult } from "lit-html";
import { classMap } from "lit-html/directives/class-map.js";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import type { PropertyValues, CSSResultGroup } from "lit";
import { SignalController } from "../controllers/index.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { ActionsBarHeight } from "./actions-bar-height.js";
import { ActionsBarCorners } from "./actions-bar-corners.js";
import { ActionsBarSteps } from "./actions-bar-steps.js";
import { SHU_EVENT, ACTION_BAR_ASK_SLOT, ACTION_BAR_CHAT_SLOT, PERMISSIONS_SLOT, SHU_TAG, CONVERSATION_PARAM } from "../consts.js";
import { ActionsBarSchema, SEARCH_OPERATORS, parseFilterParam } from "../schemas.js";
import type { TSearchCondition } from "@haibun/core/lib/quad-types.js";
import { viewQuery, serializeViewQuery } from "../view-query.js";
// Constructed with `new` (not createElement + type-cast): the value use keeps the registering module in the
// bundle: esbuild strips a TS import whose bindings only appear in type positions, silently dropping the
// customElements.define side effect and leaving un-upgraded elements at runtime.
import { ShuActivityHistory } from "./shu-activity-history.js";
import { ShuSearchSummary } from "./shu-search-summary.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { ACTIONS_BAR_STYLES } from "./actions-bar-styles.js";
import { appAccessLevel } from "../util.js";
import { contextLabel, isEntitySelection } from "./actions-bar-model.js";
import { isServerUnreachable } from "../hypermedia.js";
import { closeConversation, conversationState, openConversation } from "../conversation.js";
import { hashParam, onHashChanged } from "../view-hash.js";
import { selectValuesFor } from "../quads-snapshot.js";
import { eventStream, type TEvent } from "../event-stream.js";
import { extractQuadsFromEvents } from "@haibun/core/lib/quad-types.js";
import { buildDomainOptions, getAvailableDomains, getAvailableSteps, type DomainOption, isOffline } from "../rpc-registry.js";
import {
	getActionBarChatExtensionTags,
	getQueryableFields,
	addObservedSelectValues,
	getSelectValues,
	hasSelectValues,
	hasUsableSelectValues,
	setSelectValues,
	whenSiteMetadataReady,
} from "../rels-cache.js";
import type { ShuCombobox } from "./shu-combobox.js";
import type { TContextPattern } from "../schemas.js";
import { reportToRun, type TClientLogLevel } from "../client-log.js";

type TMode = z.infer<typeof ActionsBarSchema>["mode"];

export class ShuActionsBar extends ShuElement<typeof ActionsBarSchema> {
	/** A control, not a view of data, contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static schema = ActionsBarSchema;
	static domainSelector = SHU_TAG.ACTIONS_BAR;

	private _contextPatterns: TContextPattern[] = [];
	/** The read access every query here runs at, opening at the level the page opened at: one reader of the view hash,
	 *  so the bar and the snapshot cannot open at different levels. */
	private _contextAccessLevel: string = appAccessLevel();
	private _columns: string[] = [];
	private _queryLabel = "All";
	private _activeViewIndex = 0;
	private _unsubscribeSync?: () => void;
	private _syncEventSeq = 0;
	private _queriedSyncSeq = 0;
	private _filterConditions: TSearchCondition[] = [];
	private _filterProperties: string[] = [];
	private _domainOptions: DomainOption[] = [];
	private _selectedDomainKey = "";
	private _selectFilters: Record<string, string> = {};
	private _selectedLabel = "";
	/** The shared output region: one node for the bar's lifetime, so accumulated activity survives mode switches
	 *  and collapse/expand. */
	private _history = new ShuActivityHistory();
	/** Monotonic search-entry sequence for test ids, never reused, so a removal can't leave two entries sharing one id. */
	private _searchEntrySeq = 0;
	private _unsubscribeEvents: (() => void) | null = null;
	private _searchDebounce: ReturnType<typeof setTimeout> | null = null;
	/** Step mode: the steps the run offers, the step input line, and the callers opened in the history. */
	#steps = new ActionsBarSteps(this, {
		testIdPrefix: () => this.testIdPrefix,
		selectedLabel: () => this._selectedLabel,
		history: () => this._history,
		combo: () => this.shadowRoot?.querySelector<ShuCombobox>(".step-combo") ?? null,
	});
	/** The corner controls and their popover: settings, access and authority, the time offset and playback, the status. */
	#corners = new ActionsBarCorners(this, {
		testIdPrefix: () => this.testIdPrefix,
		accessLevel: () => this._contextAccessLevel,
		setAccessLevel: (level) => this.setAccessLevel(level),
		popover: () => this.shadowRoot?.querySelector<HTMLElement>(".corner-popover") ?? null,
	});
	/** How the bar stands: open or closed, pinned, dragged, and the footprint of its closed strip. */
	#height = new ActionsBarHeight(this, {
		state: () => this.state,
		setState: (patch) => this.setState(patch),
		strip: () => {
			const summary = this.shadowRoot?.querySelector<HTMLElement>(".summary-bar");
			const frame = this.shadowRoot?.querySelector<HTMLElement>(".actions-bar");
			return summary && frame ? { summary, frame } : null;
		},
		focusInput: () => (this.shadowRoot?.querySelector(".chat-input") as HTMLTextAreaElement | null)?.focus(),
	});

	static observedHtmlAttributes = ["api-base", "testid-prefix"];

	static get styles(): CSSResultGroup {
		return ACTIONS_BAR_STYLES;
	}

	private get testIdPrefix(): string {
		return this.getAttribute("testid-prefix") || "";
	}

	private tid(id: string): string {
		return `data-testid="${this.testIdPrefix}${id}"`;
	}

	/** The mode toggle and the pinned-open latch are remembered across reloads (ShuElement.persistFields; singleton key). */
	static persistFields = ["mode", "pinned", "heightProportion"] as const;

	constructor() {
		super(ActionsBarSchema, { askExpanded: false, pinned: false, mode: "search" });
	}

	setContext(
		patterns: TContextPattern[],
		accessLevel: string,
		extra?: {
			total?: number;
			label?: string;
			textQuery?: string;
			conditions?: TSearchCondition[];
		},
	): void {
		this._contextPatterns = patterns;
		this._contextAccessLevel = accessLevel;
		// A view offers a label only when it has one the query surface can use: a schema view offers none, so the
		// surface keeps the label it has.
		if (extra?.label !== undefined && extra.label !== this._selectedLabel) {
			this._selectedLabel = extra.label || "";
			this.syncSelectedDomainKey();
			this.loadProperties(this._selectedLabel);
			this.triggerSelectValuesLoad(this._selectedLabel);
		}
		// The search box is store-backed (viewQuery.q) and reads itself; setContext no longer touches it, so an
		// active-column context change can't wipe an in-progress search.
		// Populate select filters from conditions
		if (extra?.conditions) {
			if (this._selectedLabel && hasSelectValues(this._selectedLabel)) {
				const selectFields = getSelectValues(this._selectedLabel);
				for (const c of extra.conditions) {
					if (c.operator === "eq" && c.predicate in selectFields) this._selectFilters[c.predicate] = c.value;
				}
			}
		}

		if (!isEntitySelection(patterns)) {
			this._queryLabel = contextLabel(patterns, extra);
		}

		this.updateBreadcrumbDisplay();
		if (this.state.askExpanded) this.requestUpdate();
	}

	setColumns(columns: string[]): void {
		this._columns = columns;
		this.updateBreadcrumbDisplay();
	}

	setActiveView(index: number): void {
		this._activeViewIndex = index;
		if (this.state.askExpanded) this.requestUpdate();
		else this.updateBreadcrumbDisplay();
	}

	/**
	 * Open the step input pre-selected to `method`. Used by the affordances panel so clicking a card
	 * routes through the same step-caller flow as the actions-bar combo. When `args` are supplied,
	 * they are passed as fixed params (rendered inline, not editable); when `auto` is true, the
	 * step-caller dispatches immediately on mount without showing the input form.
	 */
	async chooseStep(method: string, args?: Record<string, unknown>, auto?: boolean): Promise<void> {
		this.setState({ mode: "step", askExpanded: true });
		await this.updateComplete;
		this.#steps.pick(method, args, auto);
	}

	private updateBreadcrumbDisplay(): void {
		const bc = this.shadowRoot?.querySelector("shu-breadcrumb") as
			| (HTMLElement & {
					setTrail?: (label: string, cols: string[], active: number) => void;
			  })
			| null;
		if (!bc?.setTrail) return;
		bc.setTrail(this._queryLabel, this._columns, this._activeViewIndex);
	}

	/** Say something on the strip. */
	setStatus(message: string): void {
		this.#corners.setStatus(message);
	}

	private failFast(message: string): never {
		this.setStatus(message);
		throw new Error(message);
	}

	private triggerSelectValuesLoad(label?: string, force = false): void {
		void this.loadSelectValues(label, force).catch((err) => {
			// The values a step offers come from the server; unreachable, the bar reports it and the reader types the value.
			if (isServerUnreachable(err)) return this.setStatus(`the values for this step are not available: ${errorDetail(err)}`);
			this.failFast(`ShuActionsBar select-values load failed: ${errorDetail(err)}`);
		});
	}

	/** The conversation the ask is open on, which the view hash addresses. */
	#conversation = new SignalController(
		this,
		conversationState,
		() => undefined,
		(conversation) => conversation.session,
	);

	/** Open the conversation the address names, with the bar expanded in Ask mode, or leave the conversation when the
	 *  address names none. An address the conversation already follows changes nothing. */
	private followConversationAddress = (): void => {
		const session = hashParam(CONVERSATION_PARAM);
		if (session === (this.#conversation.state.session ?? "")) return;
		if (!session) return closeConversation();
		this.setState({ mode: "ask", askExpanded: true });
		void openConversation(session, "update");
	};

	protected override onConnected(): void {
		// The shared output region carries the one output test id every mode's assertions point at.
		this._history.setAttribute("data-testid", `${this.testIdPrefix}chat-output`);
		this.loadProperties();
		this.#height.openIfPinned();
		this.followConversationAddress();
		this.autoTeardown(onHashChanged(this.followConversationAddress));

		void Promise.all([this.loadDomainOptions(), this.#steps.load(), this.loadSelectValues()]).catch((err) => {
			// What this bar offers comes from the server; unreachable, it reports that and the page reads what it caches.
			if (isServerUnreachable(err)) return this.setStatus(`the server did not respond: this bar offers what the page already read`);
			this.failFast(`ShuActionsBar initialization failed: ${errorDetail(err)}`);
		});

		try {
			this._unsubscribeSync = eventStream().subscribe(
				(event: TEvent) => {
					this._syncEventSeq++;
					this.dispatchEvent(new CustomEvent(SHU_EVENT.SYNC_AVAILABLE, { detail: event, bubbles: true, composed: true }));
				},
				(event: TEvent) => event.kind === "imap-sync",
			);
		} catch {
			// No EventStream installed (early-mount in tests); skip live sync wiring.
		}

		// Live filter values: when a batch carries a change in the selected type's named graph, the distinct-value
		// dropdowns may have gained a value (a new folder, status, …). It is read out of the batch, so the menus stay
		// current without a page reload and without a request.
		if (!isOffline()) {
			this.autoTeardown(
				this.subscribeBatched({
					onBatch: (events) => {
						// The run has moved on, so where the cursor sits in it may read differently.
						this.#corners.showTime(this.timeCursor);
						// The values are in the quads the batch carries, so they are taken from it. Answering a change by
						// asking the server again is what made this a loop: the question is itself a step, the step is
						// recorded in the graph, and that recording is another change to answer, every debounce forever.
						if (!this._selectedLabel) return;
						if (addObservedSelectValues(this._selectedLabel, extractQuadsFromEvents(events))) this.requestUpdate();
					},
				}),
			);
		}
	}

	protected override onDisconnected(): void {
		this._unsubscribeEvents?.();
		this._unsubscribeEvents = null;
		this._unsubscribeSync?.();
		if (this._searchDebounce) clearTimeout(this._searchDebounce);
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

	notifyQueryCompleted(): void {
		this._queriedSyncSeq = this._syncEventSeq;
	}

	get hasSyncUpdate(): boolean {
		return this._syncEventSeq > this._queriedSyncSeq;
	}

	private async loadDomainOptions(): Promise<void> {
		await getAvailableSteps(); // populates concern catalog via step.list
		const domains = await getAvailableDomains();
		this._domainOptions = buildDomainOptions(domains);
		if (this._domainOptions.length === 0) throw new Error("No domain options were produced from concern catalog");
		// Restore state from URL hash before defaulting to first domain
		if (ShuElement.getHash().startsWith("#?")) {
			const hashParams = new URLSearchParams(ShuElement.getHash().slice(2));
			if (!this._selectedLabel) {
				const hashLabel = hashParams.get("label");
				if (hashLabel) this._selectedLabel = hashLabel;
			}
			for (const f of hashParams.getAll("f")) {
				const c = parseFilterParam(f);
				if (c.predicate && c.operator === "eq" && c.value) this._selectFilters[c.predicate] = c.value;
			}
		}
		this.syncSelectedDomainKey();
		this.loadProperties(this._selectedLabel);
		this.triggerSelectValuesLoad(this._selectedLabel);
		// Optional action-bar slot extensions: a missing/un-served one is logged per-extension inside, but the
		// aggregate throw on this fire-and-forget call would otherwise become an unhandled rejection (a browser
		// pageerror): a missing optional extension must not crash the bar.
		void this.loadUiExtensions().catch((err) => this.reportActionsBar("warn", "optional UI extensions failed to load", { error: errorDetail(err) }));
		this.requestUpdate();
		this.dispatchFilterChange(false);
	}

	private syncSelectedDomainKey(): void {
		if (this._selectedLabel) {
			const matchingOption = this._domainOptions.find((option) => option.queryLabel === this._selectedLabel);
			if (matchingOption) {
				this._selectedDomainKey = matchingOption.key;
				return;
			}
			throw new Error(`Selected label is not present in discovered concerns: ${this._selectedLabel}`);
		}
		const firstOption = this._domainOptions[0];
		if (!firstOption) throw new Error("No selectable domain options discovered from concerns");
		this._selectedDomainKey = firstOption.key;
		this._selectedLabel = firstOption.queryLabel ?? "";
		if (!this._selectedLabel) throw new Error(`Concern option ${firstOption.key} is missing queryLabel`);
	}

	private loadProperties(label?: string): void {
		const target = label || this._selectedLabel;
		this._filterProperties = target ? getQueryableFields(target) : [];
	}

	private async loadSelectValues(label?: string, force = false): Promise<void> {
		const target = label || this._selectedLabel;
		if (!target) return;
		// Refetch unless the bar already holds usable (non-empty) values: a fetch made before the label's data
		// was indexed returns empty dropdowns, and caching that as "loaded" would freeze them until a full
		// page reload. `force` lets an explicit type selection always pull the current values.
		if (!force && hasUsableSelectValues(target)) return;
		setSelectValues(target, await selectValuesFor(target));
		this.requestUpdate();
	}

	/** Announce the search this bar now describes. `asked` says a reader changed it; the bar restoring its own state at
	 *  load says the same search without anyone having asked for it, which is not a reader looking for results. */
	private dispatchFilterChange(asked = true): void {
		this._queryLabel = contextLabel(this._contextPatterns, {
			label: this._selectedLabel,
			...this._selectFilters,
		});
		this.updateBreadcrumbDisplay();

		// Merge select filters into conditions
		const selectConditions = Object.entries(this._selectFilters)
			.filter(([, v]) => v)
			.map(([predicate, value]) => ({
				predicate,
				operator: "eq" as const,
				value,
			}));
		// A filter row with no field chosen names nothing to match, so it is not a condition yet: it stays in the bar
		// being edited and out of the query. Sent, it would be a condition the reader sees and the query ignores.
		const allConditions = [...selectConditions, ...this._filterConditions.filter((c) => c.predicate.length > 0)];

		this.dispatchEvent(
			new CustomEvent(SHU_EVENT.FILTER_CHANGE, {
				detail: {
					asked,
					accessLevel: this._contextAccessLevel,
					label: this._selectedLabel,
					conditions: allConditions as TSearchCondition[],
				},
				bubbles: true,
				composed: true,
			}),
		);
	}

	expand(): void {
		this.#height.open();
	}

	/**
	 * Say where the cursor sits in the run, as elapsed seconds from its first event, so the control reads `now` while
	 * every view is showing now and a real offset once a moment is pinned.
	 */
	protected onTimeSync(cursor: number | null): void {
		this.#corners.showTime(cursor);
	}

	/** Lit handles the render via the standard `render() \u2192 TemplateResult \u2192 reconcile against the shadow root` path. `updated()` is where side-effects that depend on the freshly-reconciled DOM run \u2014 wiring drag handlers to nodes Lit just mounted, pushing combobox option lists, etc. */
	render(): TemplateResult {
		const hasAsk = this.#steps.offersAsk;
		return this.template(hasAsk);
	}

	protected updated(_changedProperties: PropertyValues): void {
		this.populateComboboxes();
		this.syncSearchInput();
		this.updateBreadcrumbDisplay();
	}

	/** The search input is uncontrolled (the user types freely); reflect the store's q into it on render, e.g. a
	 *  reloaded or step-set query, but never while it is focused, so a render can't stomp an in-progress search. */
	private syncSearchInput(): void {
		const input = this.shadowRoot?.querySelector(".text-search") as HTMLInputElement | null;
		if (!input || this.shadowRoot?.activeElement === input) return;
		const q = viewQuery.signals.q.get() ?? "";
		if (input.value !== q) input.value = q;
	}

	private template(hasAsk: boolean): TemplateResult {
		// Single outer template so lit preserves the `.actions-bar` host across collapse/expand. The expanded-only children (filter bar, body) are returned conditionally so the `app-mode-select` test id disappears when collapsed, feature tests use `has test id app-mode-select` as the proxy for "bar is expanded" and that check counts elements regardless of CSS visibility.
		const expanded = this.state.askExpanded;
		// Every mode shares ONE output region (this._history, the same node every render) with the mode's input line
		// beneath: switching modes changes only the input line. Ask renders only when an ask-capable step exists, so a
		// chosen Ask mode renders search until the steps load, and on a deployment with no ask-capable step.
		const mode = this.state.mode === "ask" && !hasAsk ? "search" : this.state.mode;
		const inputLine =
			mode === "ask"
				? this.askModeTemplate(hasAsk)
				: mode === "step"
					? this.#steps.template(this.modeToggleTemplate(hasAsk), this.state.mode === "step")
					: this.filterBarTemplate(hasAsk);
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

	private summaryTemplate(): TemplateResult {
		const pinned = this.state.pinned;
		const expanded = this.state.askExpanded;
		// The opener (step-ui expandActionsBar) clicks `summary-bar` to expand: it must be a small, definite click target,
		// not the full-width strip (a wide div's center lands on empty space / a child and reads as outside the viewport).
		// So the test-id rides this chevron; the strip still expands on a bare click for the human.
		return html`<div class="summary-bar" @click=${this.#height.onStripClick}>
			${this.#corners.popoverTemplate()}
			<button class="bar-twisty" aria-label=${expanded ? "Collapse actions bar" : "Expand actions bar"} aria-expanded=${expanded}
				data-testid=${`${this.testIdPrefix}summary-bar`} @click=${this.#height.onTwistyToggle}>${expanded ? "▾" : "▴"}</button>
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

	private filterBarTemplate(hasAsk: boolean): TemplateResult {
		const selectFields = this._selectedLabel && hasSelectValues(this._selectedLabel) ? getSelectValues(this._selectedLabel) : {};
		const selectEntries = Object.entries(selectFields).filter(([, values]) => values.length > 0);
		return html`<div class="filter-bar">
			${this.modeToggleTemplate(hasAsk)}
			<input type="text" class="text-search"
				data-testid=${`${this.testIdPrefix}text-search`}
				placeholder="search..."
				@input=${this.onTextSearchInput}
				@blur=${this.onTextSearchBlur} />
			<shu-combobox class="label-select"
				testid=${`${this.testIdPrefix}type-select`}
				placeholder="type..."
				@combo-change=${this.onLabelChange}></shu-combobox>
			${selectEntries.map(([field, values]) => {
				const current = this._selectFilters[field] ?? "";
				return html`<select class="select-filter" data-field=${field} data-testid=${`${this.testIdPrefix}select-${field}`} @change=${this.onSelectFilterChange}>
					<option value="">all ${field}s</option>
					${values.map((v) => html`<option value=${v} ?selected=${v === current} data-testid=${`${this.testIdPrefix}select-${field}-option-${v}`}>${v}</option>`)}
				</select>`;
			})}
			<div class="compound-filters">
				${this._filterConditions.map((c, i) => this.condTemplate(c, i))}
			</div>
			<button class="add-filter" data-testid=${`${this.testIdPrefix}add-filter`} @click=${this.onAddFilter}>+</button>
			${this._filterConditions.length > 0 ? html`<button class="search-go" data-testid=${`${this.testIdPrefix}search-go`} @click=${this.onSearchGo}>Go</button>` : nothing}
		</div>`;
	}

	private condTemplate(c: TSearchCondition, i: number): TemplateResult {
		return html`<span class="filter-group" data-index=${i}>
			<shu-combobox class="cond-property" data-index=${i}
				testid=${`${this.testIdPrefix}cond-property-${i}`}
				placeholder="property..."
				@combo-change=${(e: CustomEvent) => this.onCondPropertyChange(i, e)}></shu-combobox>
			<select class="cond-operator" data-index=${i}
				data-testid=${`${this.testIdPrefix}cond-operator-${i}`}
				@change=${(e: Event) => this.onCondOperatorChange(i, e)}>
				${SEARCH_OPERATORS.map((o) => html`<option value=${o.value} ?selected=${o.value === c.operator}>${o.label}</option>`)}
			</select>
			<input type="text" class="cond-value" data-index=${i}
				data-testid=${`${this.testIdPrefix}cond-value-${i}`}
				.value=${c.value}
				placeholder="value"
				@input=${(e: Event) => this.onCondValueChange(i, e)} />
			${
				c.operator === "between"
					? html`<input type="text" class="cond-value2" data-index=${i}
					data-testid=${`${this.testIdPrefix}cond-value2-${i}`}
					.value=${c.value2 || ""}
					placeholder="to"
					@input=${(e: Event) => this.onCondValue2Change(i, e)} />`
					: nothing
			}
			<button class="remove-filter" data-index=${i}
				data-testid=${`${this.testIdPrefix}remove-filter-${i}`}
				@click=${() => this.onRemoveFilter(i)}>x</button>
		</span>`;
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

	/** Populate combobox options after each render. The combobox elements themselves persist (lit's diff), so setOptions just refreshes their data without recreating the element, typed-ahead filter text, focus, and open dropdown state survive. */
	private populateComboboxes(): void {
		const labelCombo = this.shadowRoot?.querySelector(".label-select") as ShuCombobox | null;
		if (labelCombo) {
			// Value is the domain key (what onLabelChange and the hash use); the
			// visible label is the queryLabel. `group` drives the Declared/Built-in
			// section headers, buildDomainOptions already orders declared-first.
			labelCombo.setOptions(this._domainOptions.map((o) => ({ value: o.key, label: o.queryLabel || o.key, group: o.group })));
			// Re-sync the closed display to the selected key, but never while the user has the dropdown open and is
			// filtering: setValue closes the dropdown, and a render-driven close would interrupt an in-progress selection
			// (deterministically so in step mode, where the event stream churns renders on every keystroke).
			if (this._selectedDomainKey && labelCombo.value !== this._selectedDomainKey && !labelCombo.isOpen) labelCombo.setValue(this._selectedDomainKey);
		}
		const propOpts = this._filterProperties.map((p) => ({ value: p, label: p }));
		this.shadowRoot?.querySelectorAll(".cond-property").forEach((el) => {
			const combo = el as ShuCombobox;
			const idx = parseInt((el as HTMLElement).dataset.index || "0", 10);
			combo.setOptions(propOpts);
			if (this._filterConditions[idx]?.predicate) combo.setValue(this._filterConditions[idx].predicate);
		});
	}

	// --- inline event handlers wired via lit-html @event=${} directives ---

	private onModeChange = (e: Event): void => {
		const mode = (e.target as HTMLSelectElement).value as TMode;
		// Switching the input mode closes a corner picker floating over the input, and leaves the playback panel open.
		this.#corners.dismissPicker();
		this.setState({ mode });
	};

	/** The read access every query here runs at. Set from the permissions panel, which is where a reader sees what it
	 *  bounds beside what they may do. */
	private setAccessLevel(level: string): void {
		this._contextAccessLevel = level;
		this.dispatchFilterChange();
	}

	private onLabelChange = (e: CustomEvent): void => {
		const key = e.detail?.value;
		if (!key) return;
		this._selectedDomainKey = key;
		const selectedOption = this._domainOptions.find((option) => option.key === this._selectedDomainKey);
		this._selectedLabel = selectedOption?.queryLabel ?? "";
		this._selectFilters = {};
		this.loadProperties(this._selectedLabel);
		this.triggerSelectValuesLoad(this._selectedLabel, true);
		this.dispatchFilterChange();
	};

	private onSelectFilterChange = (e: Event): void => {
		const select = e.target as HTMLSelectElement;
		const field = select.dataset.field;
		if (field) this._selectFilters[field] = select.value;
		this.dispatchFilterChange();
		this.recordSearch();
	};

	/** Commit the search text: write it to the viewQuery store (the source of truth for the hash and restore) and
	 *  fire the filter-change that re-runs the query. The FILTER_CHANGE → setFilters → executeQuery path is the
	 *  reliable re-query trigger, executeQuery reads q back from the store, so a live search doesn't depend on a
	 *  signal-effect firing. All three entry points (typing, blur, Go) commit the same way. */
	private commitSearch(value: string): void {
		viewQuery.set({ q: value || null });
		this.dispatchFilterChange();
	}

	private onTextSearchInput = (e: Event): void => {
		const value = (e.target as HTMLInputElement).value;
		if (this._searchDebounce) clearTimeout(this._searchDebounce);
		this._searchDebounce = setTimeout(() => this.commitSearch(value), 300);
	};

	/** Focus leaving the search input is the meaningful commit of a typed search: flush the pending debounce so the
	 *  store holds exactly what was typed, then record the search into the activity history. */
	private onTextSearchBlur = (e: Event): void => {
		if (this._searchDebounce) clearTimeout(this._searchDebounce);
		this.commitSearch((e.target as HTMLInputElement).value);
		this.recordSearch();
	};

	private onSearchGo = (): void => {
		if (this._searchDebounce) clearTimeout(this._searchDebounce);
		const input = this.shadowRoot?.querySelector(".text-search") as HTMLInputElement | null;
		this.commitSearch(input?.value || "");
		this.recordSearch();
	};

	/** Record the committed search as a clickable, restorable entry in the shared activity history. Only a search
	 *  that searches (text or field conditions) is history-worthy, and a commit identical to the newest
	 *  recorded entry records nothing, blur without change stays silent. Deduping against the live history (not a
	 *  remembered key) means removing an entry lets the same search be recorded again. */
	private recordSearch(): void {
		const query = viewQuery.current;
		if (!query.q && !query.f.some((c) => c.predicate && c.value)) return;
		const entries = this._history.querySelectorAll<ShuSearchSummary>("shu-search-summary");
		const newest = entries[entries.length - 1];
		if (newest?.query && serializeViewQuery(newest.query) === serializeViewQuery(query)) return;
		const entry = new ShuSearchSummary();
		entry.query = query;
		// Sequenced test id, entries repeat and can be removed, and a Playwright locator is strict (a duplicate id fails the click), the same reason step callers carry call-index.
		entry.setAttribute("data-testid", `${this.testIdPrefix}search-summary-${this._searchEntrySeq++}`);
		this._history.append(entry);
	}

	private onAddFilter = (): void => {
		this._filterConditions.push({ predicate: "", operator: "eq", value: "" });
		this.requestUpdate();
	};

	private onRemoveFilter(idx: number): void {
		this._filterConditions.splice(idx, 1);
		this.requestUpdate();
		this.dispatchFilterChange();
	}

	private onCondPropertyChange(idx: number, e: CustomEvent): void {
		this._filterConditions[idx].predicate = e.detail?.value || "";
	}

	private onCondOperatorChange(idx: number, e: Event): void {
		const prev = this._filterConditions[idx].operator;
		this._filterConditions[idx].operator = (e.target as HTMLSelectElement).value as TSearchCondition["operator"];
		if ((prev === "between") !== (this._filterConditions[idx].operator === "between")) {
			this.requestUpdate();
		}
	}

	private onCondValueChange(idx: number, e: Event): void {
		this._filterConditions[idx].value = (e.target as HTMLInputElement).value;
	}

	private onCondValue2Change(idx: number, e: Event): void {
		this._filterConditions[idx].value2 = (e.target as HTMLInputElement).value;
	}
}
