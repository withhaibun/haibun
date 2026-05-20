/**
 * <shu-actions-bar> — reusable actions bar with Ask (chat) and Step modes.
 * Faithful translation of old actions-bar.ts using graph fundamentals.
 *
 * Ask mode: streams LLM chat responses using server-side context resolution.
 * Step mode: executes a haibun step via RPC and collects log events.
 */
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { ActionsBarSchema, SEARCH_OPERATORS, type TSearchCondition, parseFilterParam } from "../schemas.js";
import { Access, AccessQueryLevelSchema } from "@haibun/core/lib/resources.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { SHARED_STYLES } from "./styles.js";
import { errMsg, prettifyGwta } from "../util.js";
import { SseClient, inAction } from "../sse-client.js";
import { buildDomainOptions, getAvailableDomains, getAvailableSteps, requireStep, stepsForContext, type DomainOption, type StepDescriptor } from "../rpc-registry.js";
import { getProperties, getSelectValues, hasSelectValues, setSelectValues, whenSiteMetadataReady } from "../rels-cache.js";
import { getCookie, setCookie } from "../cookies.js";
import { ShuKihanChat } from "./shu-kihan-chat.js";
import type { ShuCombobox } from "./shu-combobox.js";
import type { TContextPattern } from "../schemas.js";

const MODE_COOKIE = "shu-mode";
const HEIGHT_COOKIE = "shu-actions-height";

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
	private _detachedChat: Element | null = null;
	private _detachedStepOutput: Element | null = null;
	private _onDocumentClick = (e: Event): void => {
		if (!this.state.askExpanded) return;
		const path = typeof e.composedPath === "function" ? e.composedPath() : [];
		if (path.includes(this)) return;
		const target = e.target instanceof Element ? e.target : null;
		// Combobox popups are rendered into document.body, so suggestion picks are
		// outside the host path but still part of actions-bar interaction.
		if (target?.closest('ul[role="listbox"][data-combo-owner="shu-actions-bar"]')) return;
		this.setState({ askExpanded: false });
	};

	static get observedAttributes(): string[] {
		return ["api-base", "testid-prefix"];
	}

	private get testIdPrefix(): string {
		return this.getAttribute("testid-prefix") || "";
	}

	private tid(id: string): string {
		return `data-testid="${this.testIdPrefix}${id}"`;
	}

	constructor() {
		const mode = (getCookie(MODE_COOKIE) as TMode) || "step";
		super(ActionsBarSchema, { askExpanded: false, mode });
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

		const searchInput = this.shadowRoot?.querySelector(".text-search");
		const searchFocused = searchInput && this.shadowRoot?.activeElement === searchInput;
		if (searchFocused) {
			this.updateBreadcrumbDisplay();
		} else if (this.state.askExpanded) {
			this.render();
		} else {
			this.updateBreadcrumbDisplay();
		}
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
		if (this.state.askExpanded) {
			this.render();
		} else {
			this.updateBreadcrumbDisplay();
		}
	}

	/**
	 * Open the step input pre-selected to `method`. Used by the affordances panel so clicking a card
	 * routes through the same step-caller flow as the actions-bar combo. When `args` are supplied,
	 * they are passed as fixed params (rendered inline, not editable); when `auto` is true, the
	 * step-caller dispatches immediately on mount without showing the input form.
	 */
	chooseStep(method: string, args?: Record<string, unknown>, auto?: boolean): void {
		this.state = { ...this.state, mode: "step", askExpanded: true };
		this.render();
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
					update?: (label: string, cols: string[], active: number) => void;
			  })
			| null;
		if (!bc?.update) return;
		bc.update(this._queryLabel, this._columns, this._activeViewIndex);
	}

	setStatus(message: string): void {
		this._statusMessage = message;
		const el = this.shadowRoot?.querySelector(".status-area");
		if (el) {
			el.textContent = message;
			(el as HTMLElement).style.display = message ? "" : "none";
		}
	}

	private failFast(message: string): never {
		this.setStatus(message);
		throw new Error(message);
	}

	private triggerSelectValuesLoad(label?: string): void {
		void this.loadSelectValues(label).catch((err) => {
			this.failFast(`ShuActionsBar select-values load failed: ${errMsg(err)}`);
		});
	}

	connectedCallback(): void {
		super.connectedCallback();
		document.addEventListener("click", this._onDocumentClick, true);
		this.loadProperties();
		void Promise.all([this.loadDomainOptions(), this.loadSteps(), this.loadSelectValues()]).catch((err) => {
			this.failFast(`ShuActionsBar initialization failed: ${errMsg(err)}`);
		});

		const client = SseClient.for("");
		this._unsubscribeSync = client.onEvent(
			(event) => {
				this._syncEventSeq++;
				this.dispatchEvent(
					new CustomEvent(SHU_EVENT.SYNC_AVAILABLE, {
						detail: event,
						bubbles: true,
						composed: true,
					}),
				);
			},
			(event) => event.kind === "imap-sync",
		);
	}

	disconnectedCallback(): void {
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
		this.reportActionsBar("info", `loadUiExtensions: ${slotted.length} action-bar slot extensions found`, { count: slotted.length });
		for (const [label, ui] of slotted) {
			const raw = String(ui.js);
			const apiBase = this.getAttribute("api-base") || "";
			const jsUrl = raw.startsWith("http") || raw.startsWith("/") ? raw : `${apiBase}/${raw}`;
			this.reportActionsBar("info", `loading action-bar slot extension for ${label} from ${jsUrl}`, { label, jsUrl });
			try {
				await import(jsUrl);
				this.render();
				this.reportActionsBar("info", `loaded action-bar slot extension for ${label}`, { label, jsUrl });
			} catch (e) {
				const message = `Failed to load UI extension for ${label} from ${jsUrl}: ${errMsg(e)}`;
				this.reportActionsBar("error", message, { label, jsUrl, error: errMsg(e) });
				errors.push(message);
			}
		}
		if (errors.length > 0) throw new Error(errors.join("\n"));
	}

	private reportActionsBar(level: "info" | "warn" | "error", message: string, attributes: Record<string, unknown> = {}): void {
		void inAction(async (scope) => {
			await SseClient.for("").rpc(scope, "MonitorStepper-logClient", {
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
			});
		}).catch((err) => {
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
		this.render();
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

	private async loadSelectValues(label?: string): Promise<void> {
		const target = label || this._selectedLabel;
		if (!target) return;
		if (hasSelectValues(target)) return;
		await getAvailableSteps();
		const client = SseClient.for("");
		const data = await inAction((scope) => client.rpc<{ values: Record<string, string[]> }>(scope, requireStep("getSelectValues"), { label: target }));
		if (data.values) setSelectValues(target, data.values);
		this.render();
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
		const el = this.shadowRoot?.querySelector(".time-offset");
		if (el) el.textContent = label;
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

	protected render(): void {
		if (!this.shadowRoot) return;

		const liveChat = this.shadowRoot.querySelector(ShuKihanChat.domainSelector);
		if (liveChat) {
			this._detachedChat = liveChat;
			liveChat.remove();
		}
		const liveStepOutput = this.shadowRoot.querySelector(".step-output");
		if (liveStepOutput) {
			this._detachedStepOutput = liveStepOutput;
			liveStepOutput.remove();
		}

		const hasAsk = this._hasAskCapableStep;
		if (!hasAsk && this.state.mode === "ask") {
			this.setState({ mode: "step" });
			return;
		}
		const modeToggle = (slot?: string) => `<select ${slot ? `slot="${slot}" ` : ""}class="mode-select" ${this.tid("mode-select")}>
			${hasAsk ? `<option value="ask"${this.state.mode === "ask" ? " selected" : ""}>Ask</option>` : ""}
			<option value="step"${this.state.mode === "step" ? " selected" : ""}>Step</option>
		</select>`;

		const stepCombobox =
			this.state.mode === "step" && this._steps.length > 0
				? `<shu-combobox class="step-combo" testid="${this.testIdPrefix}step-select" placeholder="type to filter steps..."></shu-combobox>`
				: "";

		const twisty = this.state.askExpanded ? "\u25B6" : "\u25BC";

		const summaryBar = `
			<div class="summary-bar">
				<span class="status-area" style="${this._statusMessage ? "" : "display:none"}">${this._statusMessage}</span>
				<shu-breadcrumb></shu-breadcrumb>
				<span class="time-offset" ${this.tid("time-offset")}>${this._timeOffsetLabel}</span>
				<span class="access-indicator" ${this.tid("access-indicator")}>${this._contextAccessLevel}</span>
				<button class="twisty" ${this.tid("ask-button")}>${twisty}</button>
			</div>`;

		const labelSelect = `<select class="label-select" ${this.tid("type-select")}>${this._domainOptions.map((option) => `<option value="${option.key}"${option.key === this._selectedDomainKey ? " selected" : ""}${option.selectable ? "" : " disabled"}>${option.selectable ? option.queryLabel || option.key : `${option.key} (not queryable)`}</option>`).join("")}</select>`;
		const selectFields = this._selectedLabel && hasSelectValues(this._selectedLabel) ? getSelectValues(this._selectedLabel) : {};
		const selectDropdowns = Object.entries(selectFields)
			.filter(([, values]) => values.length > 0)
			.map(([field, values]) => {
				const current = this._selectFilters[field] ?? "";
				return `<select class="select-filter" data-field="${field}" ${this.tid(`select-${field}`)}><option value="">all ${field}s</option>${values.map((v) => `<option value="${v}"${v === current ? " selected" : ""}>${v}</option>`).join("")}</select>`;
			})
			.join("");

		const filterControls = this.state.askExpanded
			? `<div class="filter-bar">
					<select class="access-select" ${this.tid("access-select")}>${AccessQueryLevelSchema.options.map((a) => `<option value="${a}"${a === this._contextAccessLevel ? " selected" : ""}>${a}</option>`).join("")}</select>
					<shu-timeline class="bar-timeline"></shu-timeline>
					${labelSelect}
					${selectDropdowns}
					<input type="text" class="text-search" ${this.tid("text-search")} placeholder="search..." value="${this._textSearch}" />
					<div class="compound-filters">${this._filterConditions.map((c, i) => `<span class="filter-group" data-index="${i}"><shu-combobox class="cond-property" data-index="${i}" ${this.tid(`cond-property-${i}`)} placeholder="property..."></shu-combobox><select class="cond-operator" data-index="${i}" ${this.tid(`cond-operator-${i}`)}>${SEARCH_OPERATORS.map((o) => `<option value="${o.value}"${o.value === c.operator ? " selected" : ""}>${o.label}</option>`).join("")}</select><input type="text" class="cond-value" data-index="${i}" ${this.tid(`cond-value-${i}`)} value="${c.value}" placeholder="value" />${c.operator === "between" ? `<input type="text" class="cond-value2" data-index="${i}" ${this.tid(`cond-value2-${i}`)} value="${c.value2 || ""}" placeholder="to" />` : ""}<button class="remove-filter" data-index="${i}" ${this.tid(`remove-filter-${i}`)}>x</button></span>`).join("")}</div>
					<button class="add-filter" ${this.tid("add-filter")}>+</button>
					${this._filterConditions.length > 0 ? `<button class="search-go" ${this.tid("search-go")}>Go</button>` : ""}
				</div>`
			: "";

		const askMode = `<shu-kihan-chat testid-prefix="${this.testIdPrefix}">${modeToggle("mode-toggle")}</shu-kihan-chat>`;
		const stepMode = `
			<div class="step-output" ${this.tid("chat-output")}></div>
			<div class="input-line">
				${modeToggle()}
				${stepCombobox}
			</div>`;

		if (this.state.askExpanded) {
			this.setAttribute("expanded", "");
			this.style.height = "";
			const saved = getCookie(HEIGHT_COOKIE);
			if (saved) this.style.maxHeight = `${saved}px`;
			this.shadowRoot.innerHTML = `
				${this.css(SHARED_STYLES)}
				${this.css(STYLES)}
				<div class="actions-bar">
					${filterControls}
					${this.state.mode === "ask" ? askMode : stepMode}
					${summaryBar}
				</div>
			`;
		} else {
			this.removeAttribute("expanded");
			this.style.height = "";
			this.style.maxHeight = "";
			this.shadowRoot.innerHTML = `
				${this.css(SHARED_STYLES)}
				${this.css(STYLES)}
				<div class="actions-bar collapsed">
					${summaryBar}
				</div>
			`;
		}

		if (this.state.askExpanded && this.state.mode === "ask" && this._detachedChat) {
			const slot = this.shadowRoot.querySelector(ShuKihanChat.domainSelector);
			if (slot) slot.replaceWith(this._detachedChat);
			this._detachedChat = null;
		}
		if (this.state.askExpanded && this.state.mode === "step" && this._detachedStepOutput) {
			const slot = this.shadowRoot.querySelector(".step-output");
			if (slot) slot.replaceWith(this._detachedStepOutput);
			this._detachedStepOutput = null;
		}

		this.pushContextToChat();
		this.bindEvents();
		this.updateBreadcrumbDisplay();
	}

	private pushContextToChat(): void {
		const chat = this.shadowRoot?.querySelector(ShuKihanChat.domainSelector) as { setContext?: (p: TContextPattern[], a: string, extra?: { label?: string; textQuery?: string; conditions?: TSearchCondition[] }) => void } | null;
		chat?.setContext?.(this._contextPatterns, this._contextAccessLevel, {
			label: this._selectedLabel,
			textQuery: this._textSearch,
			conditions: this._filterConditions,
		});
	}

	private bindEvents(): void {
		const bar = this.shadowRoot?.querySelector(".summary-bar") as HTMLElement | null;
		if (bar) {
			let startY = 0;
			let dragged = false;
			let rafPending = false;
			let moveCleanup: (() => void) | null = null;
			let startedOnTwisty = false;

			const onMove = (y: number) => {
				if (!this.state.askExpanded) return;
				if (Math.abs(y - startY) > 5) {
					dragged = true;
					if (!rafPending) {
						rafPending = true;
						requestAnimationFrame(() => {
							rafPending = false;
							this.dispatchEvent(
								new CustomEvent(SHU_EVENT.RESIZE_DRAG, {
									bubbles: true,
									composed: true,
									detail: { clientY: y },
								}),
							);
						});
					}
				}
			};
			const onUp = () => {
				moveCleanup?.();
				moveCleanup = null;
				if (!dragged) {
					const nextExpanded = startedOnTwisty ? true : !this.state.askExpanded;
					startedOnTwisty = false;
					this.setState({ askExpanded: nextExpanded });
					if (nextExpanded) {
						requestAnimationFrame(() => {
							(this.shadowRoot?.querySelector(".chat-input") as HTMLTextAreaElement | null)?.focus();
						});
					}
				} else {
					startedOnTwisty = false;
					this.dispatchEvent(new CustomEvent(SHU_EVENT.RESIZE_END, { bubbles: true, composed: true }));
				}
			};
			const startListening = () => {
				moveCleanup?.();
				const ac = new AbortController();
				const s = { signal: ac.signal };
				document.addEventListener("mousemove", (e) => onMove(e.clientY), s);
				document.addEventListener("mouseup", () => onUp(), s);
				document.addEventListener("touchmove", (e) => onMove(e.touches[0].clientY), s);
				document.addEventListener("touchend", () => onUp(), s);
				moveCleanup = () => ac.abort();
			};

			bar.addEventListener("mousedown", (e) => {
				startY = e.clientY;
				dragged = false;
				startedOnTwisty = !!(e.target instanceof HTMLElement && e.target.closest(".twisty"));
				startListening();
				e.preventDefault();
			});
			bar.addEventListener("touchstart", (e) => {
				startY = e.touches[0].clientY;
				dragged = false;
				const target = e.target;
				startedOnTwisty = !!(target instanceof HTMLElement && target.closest(".twisty"));
				startListening();
				e.preventDefault();
			});
		}

		this.shadowRoot?.querySelector(".mode-select")?.addEventListener("change", (e) => {
			const mode = (e.target as HTMLSelectElement).value as TMode;
			setCookie(MODE_COOKIE, mode);
			this.setState({ mode });
		});

		const stepCombo = this.shadowRoot?.querySelector(".step-combo") as ShuCombobox | null;
		if (stepCombo) {
			const contextSteps = this._selectedLabel ? stepsForContext(this._selectedLabel) : [];
			const contextMethods = new Set(contextSteps.map((s) => s.method));
			const otherSteps = this._steps.filter((s) => !contextMethods.has(s.method));
			// Option value is the fully-qualified method (StepperName-stepName) —
			// stepName alone collides when multiple steppers expose the same key
			// (e.g. ResourcesStepper.comment vs a peer stepper's comment).
			const toOption = (s: StepDescriptor, contextMark: boolean) => ({
				value: s.method,
				label: contextMark ? `● ${prettifyGwta(s.pattern)}` : prettifyGwta(s.pattern),
				secondary: stepSecondary(s),
				details: stepDetails(s),
			});
			const options = [...contextSteps.map((s) => toOption(s, true)), ...otherSteps.map((s) => toOption(s, false))];
			stepCombo.setOptions(options);
		}
		stepCombo?.addEventListener("combo-change", ((e: CustomEvent) => {
			const method = e.detail?.value;
			if (!method) return;

			const output = this.shadowRoot?.querySelector(".step-output") as HTMLElement | null;
			if (!output) return;

			this.openStepCaller(output, method);

			requestAnimationFrame(() => {
				output.scrollTop = output.scrollHeight;
			});
		}) as EventListener);

		// Filter controls
		this.shadowRoot?.querySelectorAll(".select-filter").forEach((el) => {
			el.addEventListener("change", (e) => {
				const select = e.target as HTMLSelectElement;
				const field = select.dataset.field;
				if (field) this._selectFilters[field] = select.value;
				this.dispatchFilterChange();
			});
		});
		this.shadowRoot?.querySelector(".label-select")?.addEventListener("change", (e) => {
			this._selectedDomainKey = (e.target as HTMLSelectElement).value;
			const selectedOption = this._domainOptions.find((option) => option.key === this._selectedDomainKey);
			this._selectedLabel = selectedOption?.queryLabel ?? "";
			this._selectFilters = {};
			this.loadProperties(this._selectedLabel);
			this.triggerSelectValuesLoad(this._selectedLabel);
			this.dispatchFilterChange();
		});
		this.shadowRoot?.querySelector(".access-select")?.addEventListener("change", (e) => {
			this._contextAccessLevel = (e.target as HTMLSelectElement).value;
			this.dispatchFilterChange();
		});

		this.shadowRoot?.querySelector(".add-filter")?.addEventListener("click", () => {
			this._filterConditions.push({
				predicate: "",
				operator: "eq",
				value: "",
			});
			this.render();
		});

		const propOpts = this._filterProperties.map((p) => ({
			value: p,
			label: p,
		}));
		this.shadowRoot?.querySelectorAll(".cond-property").forEach((el) => {
			const combo = el as ShuCombobox;
			const idx = parseInt((el as HTMLElement).dataset.index || "0", 10);
			combo.setOptions(propOpts);
			if (this._filterConditions[idx]?.predicate) combo.setValue(this._filterConditions[idx].predicate);
			el.addEventListener("combo-change", ((e: CustomEvent) => {
				this._filterConditions[idx].predicate = e.detail?.value || "";
			}) as EventListener);
		});
		this.shadowRoot?.querySelectorAll(".cond-operator").forEach((el) => {
			const idx = parseInt((el as HTMLElement).dataset.index || "0", 10);
			el.addEventListener("change", () => {
				const prev = this._filterConditions[idx].operator;
				this._filterConditions[idx].operator = (el as HTMLSelectElement).value as import("../schemas.js").TSearchOperator;
				if ((prev === "between") !== (this._filterConditions[idx].operator === "between")) {
					this.render();
				}
			});
		});
		this.shadowRoot?.querySelectorAll(".cond-value").forEach((el) => {
			const idx = parseInt((el as HTMLElement).dataset.index || "0", 10);
			el.addEventListener("input", () => {
				this._filterConditions[idx].value = (el as HTMLInputElement).value;
			});
		});
		this.shadowRoot?.querySelectorAll(".cond-value2").forEach((el) => {
			const idx = parseInt((el as HTMLElement).dataset.index || "0", 10);
			el.addEventListener("input", () => {
				this._filterConditions[idx].value2 = (el as HTMLInputElement).value;
			});
		});
		this.shadowRoot?.querySelectorAll(".remove-filter").forEach((el) => {
			el.addEventListener("click", () => {
				const idx = parseInt((el as HTMLElement).dataset.index || "0", 10);
				this._filterConditions.splice(idx, 1);
				this.render();
				this.dispatchFilterChange();
			});
		});
		this.shadowRoot?.querySelector(".text-search")?.addEventListener("input", (e) => {
			this._textSearch = (e.target as HTMLInputElement).value;
			if (this._searchDebounce) clearTimeout(this._searchDebounce);
			this._searchDebounce = setTimeout(() => this.dispatchFilterChange(), 300);
		});
		this.shadowRoot?.querySelector(".search-go")?.addEventListener("click", () => {
			if (this._searchDebounce) clearTimeout(this._searchDebounce);
			this.dispatchFilterChange();
		});
	}
}

const STYLES = `
	:host { display: flex; flex-direction: column; color: #222; font-family: inherit; min-width: 0; overflow: hidden; }
	.actions-bar { padding: 0; background: #fafafa; display: flex; flex-direction: column; min-width: 0; overflow: hidden; flex: 1; min-height: 0; }
	.summary-bar {
		display: flex; align-items: center; gap: 6px; padding: 4px 8px;
		min-height: 28px; flex-shrink: 0;
		cursor: ns-resize; user-select: none; touch-action: none;
		margin-top: auto; background: #f4f4f4;
	}
	.actions-bar.collapsed .summary-bar { cursor: pointer; margin-top: 0; background: #fafafa; }
	.status-area {
		font-size: 12px; color: #888; padding: 0 4px; cursor: pointer;
		max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.twisty { background: none; border: none; font-size: 10px; color: #aaa; cursor: pointer; padding: 0 2px; flex-shrink: 0; }
	shu-breadcrumb { flex: 1; font-size: 13px; min-width: 0; overflow: hidden; }
	.access-indicator, .time-offset { font-size: 11px; color: #999; flex-shrink: 0; }
	.filter-bar { display: flex; gap: 4px; align-items: center; padding: 3px 6px; flex-wrap: wrap; }
	input[type="text"], input:not([type]), textarea, .text-input {
		font: inherit; padding: 2px 6px; border: none;
		background: #f0f0f0; border-radius: 3px; color: inherit; outline: none;
	}
	input[type="text"]:focus, input:not([type]):focus, textarea:focus, .text-input:focus { background: #e8e8e8; }
	select {
		font: inherit; padding: 2px 4px; border: none;
		background: transparent; color: inherit; outline: none;
	}
	.filter-bar .access-select, .filter-bar .label-select, .filter-bar .select-filter { width: auto; flex: 0 0 auto; }
	.filter-bar .text-search { flex: 1 1 20ch; min-width: 20ch; }
	.filter-bar .bar-timeline { flex: 2 1 0; min-width: 0; }
	.compound-filters { display: flex; gap: 3px; flex-wrap: wrap; margin-left: auto; }
	.filter-group {
		display: inline-flex; gap: 2px; align-items: center;
		background: #f0f0f0; border-radius: 3px; padding: 1px 3px;
		flex: 0 0 auto;
	}
	.filter-group select, .filter-group input { width: auto; }
	.filter-group .cond-property { max-width: 10em; }
	.filter-group .cond-operator { max-width: 5em; }
	.filter-group .cond-value, .filter-group .cond-value2 { max-width: 8em; }
	.filter-group .remove-filter { border: none; background: none; color: #bbb; padding: 0 3px; cursor: pointer; }
	.filter-group .remove-filter:hover { color: #c00; }
	.filter-bar .add-filter, .filter-bar .search-go {
		font: inherit; padding: 2px 8px; border: none;
		background: #eee; color: #444; cursor: pointer; flex: 0 0 auto; border-radius: 3px;
	}
	.filter-bar .add-filter:hover, .filter-bar .search-go:hover { background: #e0e0e0; }
	shu-step-caller { display: block; padding: 4px 6px; margin: 2px 6px; background: #f5f5f5; border-radius: 3px; }
	.mode-select { flex-shrink: 0; width: auto; }
	.step-output { font-size: inherit; padding: 3px 6px; width: 100%; min-width: 0; flex: 1; overflow-y: auto; }
	.input-line { display: flex; gap: 3px; align-items: stretch; padding: 3px 6px; flex-shrink: 0; }
	.step-combo { flex: 1 1 120px; min-width: 80px; width: auto; }
	shu-kihan-chat { display: flex; flex: 1; min-height: 0; }
`;
