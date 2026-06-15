/**
 * <shu-actions-bar> — reusable actions bar with Ask (chat) and Step modes.
 *
 * Ask mode: streams LLM chat responses using server-side context resolution.
 * Step mode: executes a haibun step via RPC and collects log events.
 */
import { z } from "zod";
import { html, nothing, type TemplateResult } from "lit-html";
import { classMap } from "lit-html/directives/class-map.js";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { css, unsafeCSS, type PropertyValues, type CSSResultGroup } from "lit";
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { ActionsBarSchema, SEARCH_OPERATORS, type TSearchCondition, parseFilterParam } from "../schemas.js";
import { Access, AccessQueryLevelSchema } from "@haibun/core/lib/resources.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { shuBaseStyles } from "./styles.js";
import { errMsg, prettifyGwta } from "../util.js";
import { conduit } from "../hypermedia.js";
import { eventStream, type TEvent } from "../event-stream.js";
import { buildDomainOptions, getAvailableDomains, getAvailableSteps, requireStep, stepsForContext, type DomainOption, type StepDescriptor } from "../rpc-registry.js";
import { getActionBarChatExtensionTags, getProperties, getSelectValues, hasSelectValues, hasUsableSelectValues, setSelectValues, whenSiteMetadataReady } from "../rels-cache.js";
import { getCookie, setCookie } from "../cookies.js";
import { ShuKihanChat } from "./shu-kihan-chat.js";
import type { ShuCombobox } from "./shu-combobox.js";
import type { TContextPattern } from "../schemas.js";

const HEIGHT_COOKIE = "shu-actions-height"; // the expanded overlay's height as a FRACTION of its container (0..1), so it stays proportionate across window sizes
const MIN_PANEL_PX = 50; // a resize drag below this snaps the overlay back to the default proportion
const DEFAULT_PROPORTION = 0.38; // expanded overlay height when the user hasn't dragged one
const MIN_PROPORTION = 0.12;
const MAX_PROPORTION = 0.9;

/**
 * Build the secondary line shown under a step's gwta in the step picker.
 * Reads `paramDomains` and `productsDomain` from the descriptor and renders
 * `inputs · A, B → outputs C`. Falls back to fewer parts when the step has
 * no declared inputs or outputs.
 */
function stepSecondary(s: StepDescriptor): string {
	const inputs = s.paramDomains ? Object.values(s.paramDomains).join(", ") : "";
	const out = s.productsDomain ?? "";
	if (inputs && out) return `${inputs} → ${out}`;
	if (inputs) return inputs;
	if (out) return `→ ${out}`;
	return "";
}

/**
 * Full multi-line details for a step option, revealed when the option is
 * focused / hovered in the picker. Includes the full gwta pattern, per-param
 * domain map, products domain, and capability requirement when present.
 */
function stepDetails(s: StepDescriptor): string {
	// The label already shows the gwta pattern; don't repeat it. Details
	// carries only the structured metadata — per-param domains, products,
	// capability — that the label can't convey.
	const lines: string[] = [];
	if (s.paramDomains && Object.keys(s.paramDomains).length > 0) {
		lines.push("inputs:");
		for (const [k, v] of Object.entries(s.paramDomains)) lines.push(`  ${k}: ${v}`);
	}
	if (s.productsDomain) lines.push(`outputs: ${s.productsDomain}`);
	if (s.capability) lines.push(`capability: ${s.capability}`);
	return lines.join("\n");
}

type TMode = z.infer<typeof ActionsBarSchema>["mode"];

export class ShuActionsBar extends ShuElement<typeof ActionsBarSchema> {
	static schema = ActionsBarSchema;
	static domainSelector = "shu-actions-bar";

	private _contextPatterns: TContextPattern[] = [];
	private _contextAccessLevel: string = Access.private;
	private _statusMessage = "";
	private _timeOffsetLabel = "now";
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
	private _textSearch = "";
	private _steps: StepDescriptor[] = [];
	private _hasAskCapableStep = false;
	private _unsubscribeEvents: (() => void) | null = null;
	private _searchDebounce: ReturnType<typeof setTimeout> | null = null;
	private _settingsOpen = false;
	private _onDocumentClick = (e: Event): void => {
		const path = typeof e.composedPath === "function" ? e.composedPath() : [];
		const inside = path.includes(this);
		if (this._settingsOpen && !inside) {
			this._settingsOpen = false;
			this.requestUpdate();
		}
		if (!this.state.askExpanded) return;
		if (this.state.pinned) return; // a pinned bar stays open — that is what the pin is for
		if (inside) return;
		const target = e.target instanceof Element ? e.target : null;
		// Combobox popups are rendered into document.body, so suggestion picks are
		// outside the host path but still part of actions-bar interaction.
		if (target?.closest('ul[role="listbox"][data-combo-owner="shu-actions-bar"]')) return;
		this.setState({ askExpanded: false });
	};

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
	static persistFields = ["mode", "pinned"] as const;

	constructor() {
		super(ActionsBarSchema, { askExpanded: false, pinned: false, mode: "step" });
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
		if (extra?.label !== undefined && extra.label !== this._selectedLabel) {
			this._selectedLabel = extra.label || "";
			this.syncSelectedDomainKey();
			this.loadProperties(this._selectedLabel);
			this.triggerSelectValuesLoad(this._selectedLabel);
		}
		if (extra?.textQuery !== undefined) this._textSearch = extra.textQuery || "";
		// Populate select filters from conditions
		if (extra?.conditions) {
			if (this._selectedLabel && hasSelectValues(this._selectedLabel)) {
				const selectFields = getSelectValues(this._selectedLabel);
				for (const c of extra.conditions) {
					if (c.operator === "eq" && c.predicate in selectFields) this._selectFilters[c.predicate] = c.value;
				}
			}
		}

		if (!this.isEntitySelection(patterns)) {
			this._queryLabel = this.contextLabel(patterns, extra);
		}

		this.updateBreadcrumbDisplay();
		if (this.state.askExpanded) this.requestUpdate();
	}

	private isEntitySelection(patterns: TContextPattern[]): boolean {
		return patterns.length > 0 && patterns.every((p) => p.s && !p.p && !p.o);
	}

	private contextLabel(patterns: TContextPattern[], extra?: { total?: number; label?: string; folder?: string }): string {
		if (patterns.length === 0) return "All";
		const subjects = patterns.filter((p) => p.s && !p.p && !p.o);
		if (subjects.length === patterns.length && subjects.length > 0) {
			return subjects.length === 1 ? subjects[0].s || "" : `${subjects.length} items`;
		}
		const fieldPat = patterns.find((p) => p.s && p.p);
		if (fieldPat && patterns.length === 1) return `${fieldPat.p}`;
		const parts: string[] = [];
		if (extra?.label) parts.push(`${extra.label}:`);
		if (extra?.total !== undefined) parts.push(String(extra.total));
		if (extra?.folder) parts.push(`in ${extra.folder}`);
		return parts.length > 0 ? parts.join(" ") : "All";
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
		const stepCombo = this.shadowRoot?.querySelector(".step-combo") as ShuCombobox | null;
		stepCombo?.setValue?.(method);
		const output = this.shadowRoot?.querySelector(".step-output") as HTMLElement | null;
		if (!output) return;
		this.openStepCaller(output, method, args, auto);
	}

	/**
	 * Append (or reuse) a step-caller for the given method. The caller carries:
	 *   - `method`: qualified method (canonical identity, used to dispatch)
	 *   - `gwta`: the user-facing gwta pattern, used as the test-id prefix so
	 *     test selectors read naturally ("show affordances-0-step-run" rather
	 *     than "GoalResolutionStepper-showAffordances-0-step-run")
	 *   - `call-index`: counts prior callers for the same method so test-ids
	 *     stay unique across repeated invocations
	 */
	private openStepCaller(output: HTMLElement, method: string, args?: Record<string, unknown>, auto?: boolean): void {
		const countOthers = () => output.querySelectorAll(`shu-step-caller[method="${method}"]`).length;
		const descriptor = this._steps.find((s) => s.method === method);
		const gwta = descriptor ? prettifyGwta(descriptor.pattern) : method;
		const lastCaller = output.querySelector("shu-step-caller:last-of-type") as (HTMLElement & { executed?: boolean; reset?: (name: string) => void }) | null;
		if (lastCaller && !lastCaller.executed && lastCaller.reset && !args && !auto) {
			const wasSame = lastCaller.getAttribute("method") === method;
			lastCaller.setAttribute("method", method);
			lastCaller.setAttribute("gwta", gwta);
			lastCaller.setAttribute("call-index", String(countOthers() - (wasSame ? 1 : 0)));
			lastCaller.reset(method);
			return;
		}
		const caller = document.createElement("shu-step-caller");
		caller.setAttribute("step", method);
		caller.setAttribute("method", method);
		caller.setAttribute("gwta", gwta);
		caller.setAttribute("call-index", String(countOthers()));
		if (args) caller.setAttribute("params", JSON.stringify(args));
		if (auto) caller.setAttribute("auto", "");
		output.appendChild(caller);
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

	setStatus(message: string): void {
		this._statusMessage = message;
		this.requestUpdate();
	}

	private failFast(message: string): never {
		this.setStatus(message);
		throw new Error(message);
	}

	private triggerSelectValuesLoad(label?: string, force = false): void {
		void this.loadSelectValues(label, force).catch((err) => {
			this.failFast(`ShuActionsBar select-values load failed: ${errMsg(err)}`);
		});
	}

	protected override onConnected(): void {
		document.addEventListener("click", this._onDocumentClick, true);
		this.loadProperties();
		if (this.state.pinned && !this.state.askExpanded) this.setState({ askExpanded: true }); // a pinned bar restored from persistence opens

		void Promise.all([this.loadDomainOptions(), this.loadSteps(), this.loadSelectValues()]).catch((err) => {
			this.failFast(`ShuActionsBar initialization failed: ${errMsg(err)}`);
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
	}

	protected override onDisconnected(): void {
		document.removeEventListener("click", this._onDocumentClick, true);
		this._unsubscribeEvents?.();
		this._unsubscribeEvents = null;
		this._unsubscribeSync?.();
		if (this._searchDebounce) clearTimeout(this._searchDebounce);
	}

	private async loadUiExtensions(): Promise<void> {
		// Wait for the concern catalog to populate site metadata before reading
		// `ui` extensions — connectedCallback can fire before the catalog RPC
		// completes, so synchronous reads at mount time miss every extension.
		const meta = await whenSiteMetadataReady();
		const errors: string[] = [];
		const slotted: Array<[string, Record<string, unknown>]> = [];
		for (const [label, ui] of Object.entries(meta.ui)) {
			if (ui.slot === "action-bar-chat" && ui.js) slotted.push([label, ui]);
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
				const message = `Failed to load UI extension for ${label} from ${jsUrl}: ${errMsg(e)}`;
				this.reportActionsBar("error", message, { label, jsUrl, error: errMsg(e) });
				errors.push(message);
			}
		}
		if (errors.length > 0) throw new Error(errors.join("\n"));
	}

	private reportActionsBar(level: "debug" | "info" | "warn" | "error", message: string, attributes: Record<string, unknown> = {}): void {
		void conduit()
			.follow(
				{
					method: "MonitorStepper-logClient",
					params: {
						event: {
							level,
							source: "shu-actions-bar",
							message,
							attributes: {
								"haibun.shu.actions-bar.event": "ui-extension",
								...attributes,
								...(level === "error"
									? {
											"haibun.autonomic.event": "step.failure",
											"exception.type": "ActionsBarUiExtension",
											"exception.message": typeof attributes.error === "string" ? attributes.error : message,
										}
									: {}),
							},
						},
					},
				},
				`actions-bar: log ${level}`,
			)
			.catch((err: unknown) => {
				failFastOrLog(`[shu-actions-bar] reportActionsBar dispatch failed: ${errorDetail(err)}`, err);
			});
	}

	notifyQueryCompleted(): void {
		this._queriedSyncSeq = this._syncEventSeq;
	}

	get hasSyncUpdate(): boolean {
		return this._syncEventSeq > this._queriedSyncSeq;
	}

	private async loadSteps(): Promise<void> {
		this._steps = await getAvailableSteps();
		this._hasAskCapableStep = !!this._steps.find((s) => s.method.endsWith("chatWithContext"));
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
		void this.loadUiExtensions();
		this.requestUpdate();
		this.dispatchFilterChange();
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
		this._filterProperties = target ? (getProperties(target) ?? []) : [];
	}

	private async loadSelectValues(label?: string, force = false): Promise<void> {
		const target = label || this._selectedLabel;
		if (!target) return;
		// Refetch unless we already hold usable (non-empty) values: a fetch made before the label's data
		// was indexed returns empty dropdowns, and caching that as "loaded" would freeze them until a full
		// page reload. `force` lets an explicit type selection always pull the current values.
		if (!force && hasUsableSelectValues(target)) return;
		await getAvailableSteps();
		const data = await conduit().follow<{ values: Record<string, string[]> }>(
			{ method: requireStep("getSelectValues"), params: { label: target } },
			`actions-bar: load select values for ${target}`,
		);
		if (data.values) setSelectValues(target, data.values);
		this.requestUpdate();
	}

	private dispatchFilterChange(): void {
		this._queryLabel = this.contextLabel(this._contextPatterns, {
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
		const allConditions = [...selectConditions, ...this._filterConditions];

		this.dispatchEvent(
			new CustomEvent(SHU_EVENT.FILTER_CHANGE, {
				detail: {
					accessLevel: this._contextAccessLevel,
					label: this._selectedLabel,
					textQuery: this._textSearch,
					conditions: allConditions as TSearchCondition[],
				},
				bubbles: true,
				composed: true,
			}),
		);
	}

	expand(): void {
		if (!this.state.askExpanded) {
			this.setState({ askExpanded: true });
		}
	}

	/**
	 * Track the timeline cursor as elapsed seconds since the first event, so the
	 * collapsed summary bar reads `0s` at start and grows positive toward `now`.
	 * The display sits next to the access-indicator and is read-only.
	 */
	protected onTimeSync(cursor: number | null): void {
		const label = this.formatTimeOffset(cursor);
		if (label === this._timeOffsetLabel) return;
		this._timeOffsetLabel = label;
		this.requestUpdate();
	}

	private _firstEventTime = 0;
	private _latestEventTime = 0;

	private formatTimeOffset(cursor: number | null): string {
		if (cursor == null || cursor <= 0) return "now";
		if (this._firstEventTime === 0 || cursor < this._firstEventTime) this._firstEventTime = cursor;
		if (cursor > this._latestEventTime) this._latestEventTime = cursor;
		const elapsed = cursor - this._firstEventTime;
		const seconds = Math.round(elapsed / 1000);
		if (cursor >= this._latestEventTime) return "now";
		if (seconds < 60) return `${seconds}s`;
		return `${Math.round(seconds / 60)}m`;
	}

	/** Lit handles the render via the standard `render() \u2192 TemplateResult \u2192 reconcile against the shadow root` path. `updated()` is where side-effects that depend on the freshly-reconciled DOM run \u2014 wiring drag handlers to nodes Lit just mounted, pushing combobox option lists, etc. */
	render(): TemplateResult {
		const hasAsk = this._hasAskCapableStep;
		// Expanded: a definite, proportionate height (the dragged fraction, remembered in the cookie, or a default) so the
		// overlay never balloons to fit its content — the body scrolls inside instead. Collapsed: just the summary bar.
		this.style.height = this.state.askExpanded ? `${(this.expandedProportion() * 100).toFixed(2)}%` : "";
		return this.template(hasAsk);
	}

	/** The remembered expanded height as a fraction of the container (drag-set, cookie-persisted), or the default. */
	private expandedProportion(): number {
		const saved = Number.parseFloat(getCookie(HEIGHT_COOKIE));
		return saved >= MIN_PROPORTION && saved <= MAX_PROPORTION ? saved : DEFAULT_PROPORTION;
	}

	/** Height of the overlay's positioning container (the offset parent), the basis for the proportionate sizing. */
	private containerHeight(): number {
		return (this.offsetParent as HTMLElement | null)?.clientHeight || this.offsetHeight || 1;
	}

	protected updated(_changedProperties: PropertyValues): void {
		const hasAsk = this._hasAskCapableStep;
		if (!hasAsk && this.state.mode === "ask") {
			this.setState({ mode: "step" });
			return;
		}
		this.populateComboboxes();
		this.pushContextToChat();
		this.updateBreadcrumbDisplay();
	}

	private template(hasAsk: boolean): TemplateResult {
		// Single outer template so lit preserves the `.actions-bar` host across collapse/expand. The expanded-only children (filter bar, body) are returned conditionally so the `app-mode-select` test id genuinely disappears when collapsed — feature tests use `has test id app-mode-select` as the proxy for "bar is expanded" and that check counts elements regardless of CSS visibility.
		const expanded = this.state.askExpanded;
		const body = expanded ? (this.state.mode === "ask" ? this.askModeTemplate(hasAsk) : this.stepModeTemplate(hasAsk)) : nothing;
		const filterBar = expanded ? this.filterBarTemplate() : nothing;
		// The resize grip sits at the TOP edge of the open overlay (the bar grows up from the bottom, so the top edge is
		// where it meets the content) — drag it to resize. Only present when expanded; there is nothing to resize collapsed.
		const resizeHandle = expanded
			? html`<div class="resize-handle" data-testid=${`${this.testIdPrefix}resize-handle`} title="Drag to resize" @mousedown=${this.onResizeDown} @touchstart=${this.onResizeDown}></div>`
			: nothing;
		return html`<div class=${classMap({ "actions-bar": true, collapsed: !expanded })}>
				${resizeHandle}
				${this.settingsPopoverTemplate()}
				${filterBar}
				${body}
				${this.summaryTemplate()}
			</div>`;
	}

	/** Theme + scale controls sit in the top-right of the open panel; the gear on the summary bar toggles them. */
	private settingsPopoverTemplate(): TemplateResult | typeof nothing {
		if (!this._settingsOpen) return nothing;
		return html`<div class="settings-popover" data-testid=${`${this.testIdPrefix}settings-popover`}>
			<shu-theme-switch></shu-theme-switch>
		</div>`;
	}

	private summaryTemplate(): TemplateResult {
		const pinned = this.state.pinned;
		return html`<div class="summary-bar" @click=${this.onSummaryClick}>
			<span class="status-area" style=${this._statusMessage ? "" : "display:none"}>${this._statusMessage}</span>
			<shu-breadcrumb></shu-breadcrumb>
			<span class="time-offset" data-testid=${`${this.testIdPrefix}time-offset`}>${this._timeOffsetLabel}</span>
			<span class="access-indicator" data-testid=${`${this.testIdPrefix}access-indicator`}>${this._contextAccessLevel}</span>
			<button class="settings-button" aria-label="Settings" aria-expanded=${this._settingsOpen} data-testid=${`${this.testIdPrefix}settings-button`}
				@click=${this.onSettingsToggle}>\u2699</button>
			<button class=${classMap({ pin: true, pinned })} aria-label=${pinned ? "Unpin actions bar" : "Pin actions bar open"} aria-pressed=${pinned}
				data-testid=${`${this.testIdPrefix}ask-button`} @click=${this.onPinToggle}>\u{1F4CC}</button>
		</div>`;
	}

	private onSettingsToggle = (e: Event): void => {
		e.stopPropagation();
		this._settingsOpen = !this._settingsOpen;
		// The controls render in the top-right of the open panel, so opening them opens the bar.
		if (this._settingsOpen && !this.state.askExpanded) {
			this.setState({ askExpanded: true });
			return;
		}
		this.requestUpdate();
	};

	private modeToggleTemplate(hasAsk: boolean, slot?: string): TemplateResult {
		return html`<select
			class="mode-select"
			slot=${slot ?? nothing}
			data-testid=${`${this.testIdPrefix}mode-select`}
			@change=${this.onModeChange}
		>
			${hasAsk ? html`<option value="ask" ?selected=${this.state.mode === "ask"}>Ask</option>` : nothing}
			<option value="step" ?selected=${this.state.mode === "step"}>Step</option>
		</select>`;
	}

	private filterBarTemplate(): TemplateResult {
		const selectFields = this._selectedLabel && hasSelectValues(this._selectedLabel) ? getSelectValues(this._selectedLabel) : {};
		const selectEntries = Object.entries(selectFields).filter(([, values]) => values.length > 0);
		return html`<div class="filter-bar">
			<select class="access-select" data-testid=${`${this.testIdPrefix}access-select`} @change=${this.onAccessChange}>
				${AccessQueryLevelSchema.options.map((a) => html`<option value=${a} ?selected=${a === this._contextAccessLevel}>${a}</option>`)}
			</select>
			<shu-timeline class="bar-timeline"></shu-timeline>
			<shu-combobox class="label-select"
				testid=${`${this.testIdPrefix}type-select`}
				placeholder="type..."
				@combo-change=${this.onLabelChange}></shu-combobox>
			${selectEntries.map(([field, values]) => {
				const current = this._selectFilters[field] ?? "";
				return html`<select class="select-filter" data-field=${field} data-testid=${`${this.testIdPrefix}select-${field}`} @change=${this.onSelectFilterChange}>
					<option value="">all ${field}s</option>
					${values.map((v) => html`<option value=${v} ?selected=${v === current}>${v}</option>`)}
				</select>`;
			})}
			<input type="text" class="text-search"
				data-testid=${`${this.testIdPrefix}text-search`}
				placeholder="search..."
				.value=${this._textSearch}
				@input=${this.onTextSearchInput} />
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

	private stepModeTemplate(hasAsk: boolean): TemplateResult {
		const stepCombobox =
			this.state.mode === "step" && this._steps.length > 0
				? html`<shu-combobox class="step-combo"
					testid=${`${this.testIdPrefix}step-select`}
					placeholder="type to filter steps..."
					@combo-change=${this.onStepComboChange}></shu-combobox>`
				: nothing;
		return html`
			<div class="step-output" data-testid=${`${this.testIdPrefix}chat-output`}></div>
			<div class="input-line">
				${this.modeToggleTemplate(hasAsk)}
				${stepCombobox}
				${this.uiExtensionsTemplate()}
			</div>`;
	}

	/** Render `action-bar-chat` slot custom elements. In ask mode these are rendered inside
	 *  <shu-kihan-chat>; step mode has no chat element, so the actions bar renders them directly
	 *  here so the slot is present in both modes (the elements are defined by loadUiExtensions). */
	private uiExtensionsTemplate(): TemplateResult {
		return html`${unsafeHTML(
			getActionBarChatExtensionTags()
				.map((tag) => `<${tag}></${tag}>`)
				.join(""),
		)}`;
	}

	private pushContextToChat(): void {
		const chat = this.shadowRoot?.querySelector(ShuKihanChat.domainSelector) as {
			setContext?: (p: TContextPattern[], a: string, extra?: { label?: string; textQuery?: string; conditions?: TSearchCondition[] }) => void;
		} | null;
		chat?.setContext?.(this._contextPatterns, this._contextAccessLevel, {
			label: this._selectedLabel,
			textQuery: this._textSearch,
			conditions: this._filterConditions,
		});
	}

	private _dragStartY = 0;
	private _dragStartH = 0; // overlay height when a resize drag began; the bar grows up from the bottom, so drag-up enlarges it
	private _dragRafPending = false;
	private _dragMoveCleanup: (() => void) | null = null;

	/** Open/close the bar; the pin and the collapsed summary share this. Focuses the input when opening. */
	private toggleExpanded(): void {
		const next = !this.state.askExpanded;
		this.setState({ askExpanded: next });
		if (next) requestAnimationFrame(() => (this.shadowRoot?.querySelector(".chat-input") as HTMLTextAreaElement | null)?.focus());
	}

	/** The pin pins the bar open (a latch against click-away dismissal) — it does NOT open/close it. Pinning also opens it
	 * if needed; unpinning leaves it open but now dismissible by clicking away. */
	private onPinToggle = (e: Event): void => {
		e.stopPropagation();
		const pinned = !this.state.pinned;
		this.setState({ pinned, askExpanded: pinned || this.state.askExpanded });
	};

	/** Clicking the collapsed summary strip opens the bar (transient — it dismisses on click-away unless pinned). */
	private onSummaryClick = (): void => {
		if (!this.state.askExpanded) this.toggleExpanded();
	};

	/** Start a resize drag from the top grip. The bar is bottom-anchored, so dragging the top edge UP enlarges it. */
	private onResizeDown = (e: MouseEvent | TouchEvent): void => {
		this._dragStartY = "touches" in e ? e.touches[0].clientY : e.clientY;
		this._dragStartH = this.offsetHeight;
		this._dragMoveCleanup?.();
		const ac = new AbortController();
		const s = { signal: ac.signal };
		document.addEventListener("mousemove", (ev) => this.onResizeMove((ev as MouseEvent).clientY), s);
		document.addEventListener("mouseup", () => this.onResizeEnd(), s);
		document.addEventListener("touchmove", (ev) => this.onResizeMove((ev as TouchEvent).touches[0].clientY), s);
		document.addEventListener("touchend", () => this.onResizeEnd(), s);
		this._dragMoveCleanup = () => ac.abort();
		e.preventDefault();
	};

	private onResizeMove(y: number): void {
		if (this._dragRafPending) return;
		this._dragRafPending = true;
		requestAnimationFrame(() => {
			this._dragRafPending = false;
			// Live feedback in px while dragging (top edge up = taller); on release it becomes a container fraction (onResizeEnd).
			const h = Math.min(this.containerHeight(), Math.max(MIN_PANEL_PX, this._dragStartH - (y - this._dragStartY)));
			this.style.height = `${h}px`;
		});
	}

	private onResizeEnd(): void {
		this._dragMoveCleanup?.();
		this._dragMoveCleanup = null;
		// Remember the dragged size as a fraction of the container so it stays proportionate across window sizes.
		const frac = Math.min(MAX_PROPORTION, Math.max(MIN_PROPORTION, this.offsetHeight / this.containerHeight()));
		setCookie(HEIGHT_COOKIE, frac.toFixed(3));
		this.style.height = `${(frac * 100).toFixed(2)}%`;
	}

	/** Populate combobox options after each render. The combobox elements themselves persist (lit's diff), so setOptions just refreshes their data without recreating the element — typed-ahead filter text, focus, and open dropdown state survive. */
	private populateComboboxes(): void {
		const labelCombo = this.shadowRoot?.querySelector(".label-select") as ShuCombobox | null;
		if (labelCombo) {
			// Value is the domain key (what onLabelChange and the hash use); the
			// visible label is the queryLabel. `group` drives the Declared/Built-in
			// section headers — buildDomainOptions already orders declared-first.
			labelCombo.setOptions(this._domainOptions.map((o) => ({ value: o.key, label: o.queryLabel || o.key, group: o.group })));
			if (this._selectedDomainKey && labelCombo.value !== this._selectedDomainKey) labelCombo.setValue(this._selectedDomainKey);
		}
		const stepCombo = this.shadowRoot?.querySelector(".step-combo") as ShuCombobox | null;
		if (stepCombo) {
			const contextSteps = this._selectedLabel ? stepsForContext(this._selectedLabel) : [];
			const contextMethods = new Set(contextSteps.map((s) => s.method));
			const otherSteps = this._steps.filter((s) => !contextMethods.has(s.method));
			// Option value is the fully-qualified method (StepperName-stepName) — stepName
			// alone collides when multiple steppers expose the same key.
			const toOption = (s: StepDescriptor, contextMark: boolean) => ({
				value: s.method,
				label: contextMark ? `● ${prettifyGwta(s.pattern)}` : prettifyGwta(s.pattern),
				secondary: stepSecondary(s),
				details: stepDetails(s),
			});
			stepCombo.setOptions([...contextSteps.map((s) => toOption(s, true)), ...otherSteps.map((s) => toOption(s, false))]);
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
		this.setState({ mode });
	};

	private onAccessChange = (e: Event): void => {
		this._contextAccessLevel = (e.target as HTMLSelectElement).value;
		this.dispatchFilterChange();
	};

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
	};

	private onTextSearchInput = (e: Event): void => {
		this._textSearch = (e.target as HTMLInputElement).value;
		if (this._searchDebounce) clearTimeout(this._searchDebounce);
		this._searchDebounce = setTimeout(() => this.dispatchFilterChange(), 300);
	};

	private onSearchGo = (): void => {
		if (this._searchDebounce) clearTimeout(this._searchDebounce);
		this.dispatchFilterChange();
	};

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
		this._filterConditions[idx].operator = (e.target as HTMLSelectElement).value as import("../schemas.js").TSearchOperator;
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

	private onStepComboChange = (e: CustomEvent): void => {
		const method = e.detail?.value;
		if (!method) return;
		const output = this.shadowRoot?.querySelector(".step-output") as HTMLElement | null;
		if (!output) return;
		this.openStepCaller(output, method);
		requestAnimationFrame(() => {
			output.scrollTop = output.scrollHeight;
		});
	};
}

const STYLES = `
	/* A bottom-anchored, translucent overlay: it floats up over the content from the bottom edge instead of taking
	   layout space, so the rows behind it never resize. Self-positioning — drop it into any position:relative host
	   (the app shell or a column view) and it pins to that host's bottom. */
	:host {
		/* Above column content and any in-column overlays (e.g. the fisheye's own corner controls at z-index 10-12),
		   below the fullscreen artifact modal (z-index 100). */
		position: absolute; left: 0; right: 0; bottom: 0; z-index: 20;
		display: flex; flex-direction: column; min-width: 0; max-height: 100%; overflow: hidden;
	}
	.actions-bar {
		padding: 0; display: flex; flex-direction: column; min-width: 0; overflow: hidden; flex: 1; min-height: 0; position: relative;
		background: color-mix(in srgb, var(--shu-bg-soft) 68%, transparent);
		-webkit-backdrop-filter: blur(14px) saturate(1.4); backdrop-filter: blur(14px) saturate(1.4);
		border-top: var(--shu-border-w) solid var(--shu-border);
		box-shadow: 0 -2px 10px var(--shu-shadow);
	}
	/* The resize grip — a thin bar with a centred grab pill at the TOP edge of the open overlay. */
	.resize-handle {
		flex-shrink: 0; height: 10px; cursor: ns-resize; user-select: none; touch-action: none;
		display: flex; align-items: center; justify-content: center;
	}
	.resize-handle::before { content: ""; width: 40px; height: 4px; border-radius: 2px; background: var(--shu-border); }
	.resize-handle:hover::before { background: var(--shu-fg-faded); }
	.summary-bar {
		display: flex; align-items: center; gap: var(--shu-space-3); padding: var(--shu-space-2) var(--shu-space-4);
		min-height: var(--shu-row-h); flex-shrink: 0;
		user-select: none; margin-top: auto; background: transparent;
		border-top: var(--shu-border-w) solid var(--shu-border);
	}
	.actions-bar.collapsed { box-shadow: none; }
	.actions-bar.collapsed .summary-bar { cursor: pointer; margin-top: 0; border-top: none; }
	/* Pin control (lower right): upright + accented when open, tilted + faded when closed. */
	.pin {
		background: transparent; border: none; cursor: pointer; flex-shrink: 0;
		width: var(--shu-icon-btn); height: var(--shu-icon-btn);
		display: inline-flex; align-items: center; justify-content: center;
		font-size: var(--shu-font-sm); color: var(--shu-fg-faded); border-radius: var(--shu-radius);
		transform: rotate(45deg); opacity: 0.6;
	}
	.pin:hover { color: var(--shu-fg); background: var(--shu-bg-hover); }
	.pin.pinned { transform: rotate(0deg); opacity: 1; color: var(--shu-accent); }
	.status-area {
		font-size: var(--shu-font-sm); color: var(--shu-fg-muted); padding: 0 var(--shu-space-2); cursor: pointer;
		max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.settings-button {
		background: transparent; border: none; cursor: pointer; flex-shrink: 0;
		width: var(--shu-icon-btn); height: var(--shu-icon-btn);
		display: inline-flex; align-items: center; justify-content: center;
		font-size: var(--shu-font-sm); color: var(--shu-fg-faded);
		border-radius: var(--shu-radius);
	}
	.settings-button:hover, .settings-button[aria-expanded="true"] { color: var(--shu-fg); background: var(--shu-bg-hover); }
	.settings-popover {
		position: absolute; top: var(--shu-space-2); right: var(--shu-space-3);
		z-index: 10; cursor: default;
		display: inline-flex; align-items: center;
		padding: var(--shu-space-2) var(--shu-space-3);
		background: var(--shu-bg-elevated); color: var(--shu-fg);
		border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius);
		box-shadow: 0 1px 4px var(--shu-shadow);
	}
	shu-breadcrumb { flex: 1; font-size: var(--shu-font-md); min-width: 0; overflow: hidden; }
	.access-indicator, .time-offset { font-size: var(--shu-font-xs); color: var(--shu-fg-faded); flex-shrink: 0; }
	.filter-bar {
		display: flex; gap: var(--shu-space-2); align-items: center;
		padding: var(--shu-space-2) var(--shu-space-3); flex-wrap: wrap;
		border-bottom: var(--shu-border-w) solid var(--shu-border);
	}
	/* Inputs/selects style is centralised in SHU_BASE (above). The actions-bar only adds layout. */
	.filter-bar .access-select, .filter-bar .label-select, .filter-bar .select-filter { width: auto; flex: 0 0 auto; }
	.filter-bar .text-search { flex: 1 1 20ch; min-width: 16ch; }
	.filter-bar .bar-timeline { flex: 2 1 0; min-width: 0; }
	.compound-filters { display: flex; gap: var(--shu-space-1); flex-wrap: wrap; margin-left: auto; }
	.filter-group {
		display: inline-flex; gap: var(--shu-space-1); align-items: center;
		background: var(--shu-bg-input); border-radius: var(--shu-radius);
		padding: var(--shu-space-1) var(--shu-space-2);
		flex: 0 0 auto;
	}
	.filter-group select, .filter-group input { width: auto; }
	.filter-group .cond-property { max-width: 10em; }
	.filter-group .cond-operator { max-width: 5em; }
	.filter-group .cond-value, .filter-group .cond-value2 { max-width: 8em; }
	.filter-group .remove-filter { border: none; background: none; color: var(--shu-fg-faded); padding: 0 var(--shu-space-1); cursor: pointer; }
	.filter-group .remove-filter:hover { color: var(--shu-error); }
	.filter-bar .add-filter, .filter-bar .search-go {
		font: inherit; padding: var(--shu-space-1) var(--shu-space-4); border: var(--shu-border-w) solid var(--shu-border);
		background: var(--shu-bg-elevated); color: var(--shu-fg); cursor: pointer; flex: 0 0 auto;
		border-radius: var(--shu-radius);
		min-height: var(--shu-input-h);
	}
	.filter-bar .add-filter:hover, .filter-bar .search-go:hover { background: var(--shu-bg-hover); }
	.filter-bar .search-go { background: var(--shu-accent); color: var(--shu-accent-fg); border-color: var(--shu-accent); }
	shu-step-caller {
		display: block; padding: var(--shu-space-3); margin: var(--shu-space-2) var(--shu-space-4);
		background: var(--shu-bg-elevated); border-radius: var(--shu-radius); border: var(--shu-border-w) solid var(--shu-border);
	}
	.mode-select { flex-shrink: 0; width: auto; min-width: 5em; }
	.step-output { font-size: inherit; padding: var(--shu-space-3) var(--shu-space-4); width: 100%; min-width: 0; flex: 1; overflow-y: auto; }
	.input-line {
		display: flex; gap: var(--shu-space-2); align-items: stretch;
		padding: var(--shu-space-3) var(--shu-space-4); flex-shrink: 0;
	}
	.step-combo { flex: 1 1 280px; min-width: 12ch; width: auto; }
	shu-kihan-chat { display: flex; flex: 1; min-height: 0; min-width: 0; }
`;

const ACTIONS_BAR_STYLES: CSSResultGroup = [shuBaseStyles, css`${unsafeCSS(STYLES)}`];
