/**
 * The actions bar's search mode: the type the query surface reads, a text search, filter conditions, the distinct values a
 * type's fields take and a filter by one of them, and the searches recorded in the bar's history. Every change a reader
 * makes announces the search the bar now describes as a filter change, which the query runs. The trail label names what
 * the search is about, for the bar's breadcrumb.
 */
import { html, nothing, type ReactiveController, type ReactiveControllerHost, type TemplateResult } from "lit";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { extractQuadsFromEvents, type TSearchCondition } from "@haibun/core/lib/quad-types.js";
import { SHU_EVENT, SHU_TAG } from "../consts.js";
import type { TEvent } from "../event-stream.js";
import { isServerUnreachable } from "../hypermedia.js";
import { selectValuesFor } from "../quads-snapshot.js";
import { addObservedSelectValues, getQueryableFields, getSelectValues, hasSelectValues, hasUsableSelectValues, setSelectValues } from "../rels-cache.js";
import { buildDomainOptions, getAvailableDomains, getAvailableSteps, type DomainOption } from "../rpc-registry.js";
import { SEARCH_OPERATORS, parseFilterParam, type TContextPattern } from "../schemas.js";
import { appAccessLevel } from "../util.js";
import { hashParams, getHash } from "../view-hash.js";
import { serializeViewQuery, viewQuery } from "../view-query.js";
import { contextLabel, isEntitySelection, type TContextExtra } from "./actions-bar-model.js";
import type { ShuActivityHistory } from "./shu-activity-history.js";
import type { ShuCombobox } from "./shu-combobox.js";
import { ShuSearchSummary } from "./shu-search-summary.js";

/** How long typing rests before the search text is committed. */
export const SEARCH_DEBOUNCE_MS = 300;

/** What a view says about the context it offers the bar: its total, the label the query surface can use, and the
 *  conditions it was opened with. */
export type TQueryContextExtra = TContextExtra & { textQuery?: string; conditions?: TSearchCondition[] };

/** The conditions a search runs: each select filter with a value, then each filter row that names a field. A row with no
 *  field chosen names nothing to match, so it stays in the bar being edited and out of the query. */
export function searchConditions(selectFilters: Record<string, string>, rows: readonly TSearchCondition[]): TSearchCondition[] {
	const selected = Object.entries(selectFilters)
		.filter(([, value]) => value)
		.map(([predicate, value]): TSearchCondition => ({ predicate, operator: "eq", value }));
	return [...selected, ...rows.filter((row) => row.predicate.length > 0)];
}

/** What the query reads from the bar: its test-id prefix, the history searches are recorded in, the elements of its
 *  rendered tree, the status it reports a server that did not answer on, a failure it cannot continue past, and the
 *  breadcrumb it asks to read the trail label again. */
export type TActionsBarQueryDeps = {
	testIdPrefix: () => string;
	history: () => ShuActivityHistory;
	find: <T extends Element>(selector: string) => T | null;
	findAll: <T extends Element>(selector: string) => T[];
	setStatus: (message: string) => void;
	fail: (message: string) => never;
	onTrailChange: () => void;
};

export class ActionsBarQuery implements ReactiveController {
	readonly #host: ReactiveControllerHost & HTMLElement;
	readonly #deps: TActionsBarQueryDeps;
	#contextPatterns: TContextPattern[] = [];
	/** The read access every query here runs at, opening at the level the page opened at, so the bar and the snapshot
	 *  cannot open at different levels. */
	#accessLevel = appAccessLevel();
	#trailLabel = "All";
	#conditions: TSearchCondition[] = [];
	#properties: string[] = [];
	#domainOptions: DomainOption[] = [];
	#selectedDomainKey = "";
	#selectFilters: Record<string, string> = {};
	#selectedLabel = "";
	/** Each recorded search's number, never reused, so removing one never leaves two sharing a test id. */
	#searchNumber = 0;
	#searchDebounce: ReturnType<typeof setTimeout> | null = null;

	constructor(host: ReactiveControllerHost & HTMLElement, deps: TActionsBarQueryDeps) {
		this.#host = host;
		this.#deps = deps;
		host.addController(this);
	}

	hostDisconnected(): void {
		if (this.#searchDebounce) clearTimeout(this.#searchDebounce);
		this.#searchDebounce = null;
	}

	/** After each render, the type and property selectors offer their options, and the search box shows the stored text. */
	hostUpdated(): void {
		const types = this.#deps.find<ShuCombobox>(".label-select");
		if (types) {
			// The value is the domain key the hash uses, grouped declared first. The closed display follows the selected key,
			// except while a reader filters the open list: setting the value would close it mid-selection.
			types.setOptions(this.#domainOptions.map((o) => ({ value: o.key, label: o.queryLabel || o.key, group: o.group })));
			if (this.#selectedDomainKey && types.value !== this.#selectedDomainKey && !types.isOpen) types.setValue(this.#selectedDomainKey);
		}
		const properties = this.#properties.map((p) => ({ value: p, label: p }));
		for (const combo of this.#deps.findAll<ShuCombobox>(".cond-property")) {
			const index = Number.parseInt(combo.dataset.index || "0", 10);
			combo.setOptions(properties);
			if (this.#conditions[index]?.predicate) combo.setValue(this.#conditions[index].predicate);
		}
		// The search box is uncontrolled while a reader types; it shows the stored text, never while it has focus.
		const input = this.#deps.find<HTMLInputElement>(".text-search");
		if (!input || this.#host.shadowRoot?.activeElement === input) return;
		const q = viewQuery.signals.q.get() ?? "";
		if (input.value !== q) input.value = q;
	}

	get accessLevel(): string {
		return this.#accessLevel;
	}

	get selectedLabel(): string {
		return this.#selectedLabel;
	}

	get trailLabel(): string {
		return this.#trailLabel;
	}

	/** Take the context a view offers: its patterns, the access it reads at, and the label and conditions it opened with. A
	 *  view offers a label only when the query surface can use one, so a schema view leaves the label as it is. */
	setContext(patterns: TContextPattern[], accessLevel: string, extra?: TQueryContextExtra): void {
		this.#contextPatterns = patterns;
		this.#accessLevel = accessLevel;
		if (extra?.label !== undefined && extra.label !== this.#selectedLabel) {
			this.#selectedLabel = extra.label || "";
			this.#syncSelectedDomainKey();
			this.loadProperties();
			this.#loadSelectValuesReported();
		}
		if (extra?.conditions && this.#selectedLabel && hasSelectValues(this.#selectedLabel)) {
			const fields = getSelectValues(this.#selectedLabel);
			for (const c of extra.conditions) if (c.operator === "eq" && c.predicate in fields) this.#selectFilters[c.predicate] = c.value;
		}
		if (!isEntitySelection(patterns)) this.#trailLabel = contextLabel(patterns, extra);
		this.#deps.onTrailChange();
	}

	/** The read access every query here runs at, set from the permissions panel. */
	setAccessLevel(level: string): void {
		this.#accessLevel = level;
		this.#announce();
	}

	/**
	 * Read the types the query surface offers and settle on one: the label and field filters the address names, else the
	 * first type. The search it describes is announced as not asked for, since the bar restoring itself is no reader
	 * looking for results.
	 */
	async loadDomains(): Promise<void> {
		await getAvailableSteps(); // the concern catalog the domains are read from arrives with the steps
		this.#domainOptions = buildDomainOptions(await getAvailableDomains());
		if (this.#domainOptions.length === 0) throw new Error("No domain options were produced from concern catalog");
		const params = hashParams(getHash());
		if (!this.#selectedLabel) this.#selectedLabel = params.get("label") ?? "";
		for (const f of params.getAll("f")) {
			const c = parseFilterParam(f);
			if (c.predicate && c.operator === "eq" && c.value) this.#selectFilters[c.predicate] = c.value;
		}
		this.#syncSelectedDomainKey();
		this.loadProperties();
		this.#loadSelectValuesReported();
		this.#host.requestUpdate();
		this.#announce(false);
	}

	/** Read the fields of the selected type a condition can name. */
	loadProperties(): void {
		this.#properties = this.#selectedLabel ? getQueryableFields(this.#selectedLabel) : [];
	}

	/** Read the distinct values the selected type's fields take. Values the bar already holds are kept, unless `force`: a
	 *  read made before the type's data was indexed returns none, and keeping that would freeze the menus until a reload. */
	async loadSelectValues(force = false): Promise<void> {
		const label = this.#selectedLabel;
		if (!label || (!force && hasUsableSelectValues(label))) return;
		setSelectValues(label, await selectValuesFor(label));
		this.#host.requestUpdate();
	}

	/** Take the distinct values a batch of events adds for the selected type, rather than asking the server again: the
	 *  question would itself be recorded, and that record would be another change to answer. */
	observe(events: TEvent[]): void {
		if (this.#selectedLabel && addObservedSelectValues(this.#selectedLabel, extractQuadsFromEvents(events))) this.#host.requestUpdate();
	}

	/** The search mode's input line. */
	template(modeToggle: TemplateResult): TemplateResult {
		const prefix = this.#deps.testIdPrefix();
		const label = this.#selectedLabel;
		const fields = label && hasSelectValues(label) ? getSelectValues(label) : {};
		return html`<div class="filter-bar">
			${modeToggle}
			<input type="text" class="text-search" data-testid=${`${prefix}text-search`} placeholder="search..." @input=${this.#onTextInput} @blur=${this.#onTextBlur} />
			<shu-combobox class="label-select" testid=${`${prefix}type-select`} placeholder="type..." @combo-change=${this.#onLabelChange}></shu-combobox>
			${Object.entries(fields)
				.filter(([, values]) => values.length > 0)
				.map(([field, values]) => {
					const current = this.#selectFilters[field] ?? "";
					return html`<select class="select-filter" data-field=${field} data-testid=${`${prefix}select-${field}`} @change=${this.#onSelectFilterChange}>
						<option value="">all ${field}s</option>
						${values.map((v) => html`<option value=${v} ?selected=${v === current} data-testid=${`${prefix}select-${field}-option-${v}`}>${v}</option>`)}
					</select>`;
				})}
			<div class="compound-filters">${this.#conditions.map((c, i) => this.#conditionTemplate(c, i))}</div>
			<button class="add-filter" data-testid=${`${prefix}add-filter`} @click=${this.#onAddCondition}>+</button>
			${this.#conditions.length > 0 ? html`<button class="search-go" data-testid=${`${prefix}search-go`} @click=${this.#onSearchGo}>Go</button>` : nothing}
		</div>`;
	}

	#conditionTemplate(c: TSearchCondition, i: number): TemplateResult {
		const prefix = this.#deps.testIdPrefix();
		return html`<span class="filter-group" data-index=${i}>
			<shu-combobox class="cond-property" data-index=${i} testid=${`${prefix}cond-property-${i}`} placeholder="property..."
				@combo-change=${(e: CustomEvent) => this.#onConditionProperty(i, e)}></shu-combobox>
			<select class="cond-operator" data-index=${i} data-testid=${`${prefix}cond-operator-${i}`} @change=${(e: Event) => this.#onConditionOperator(i, e)}>
				${SEARCH_OPERATORS.map((o) => html`<option value=${o.value} ?selected=${o.value === c.operator}>${o.label}</option>`)}
			</select>
			<input type="text" class="cond-value" data-index=${i} data-testid=${`${prefix}cond-value-${i}`} .value=${c.value} placeholder="value"
				@input=${(e: Event) => this.#onConditionValue(i, "value", e)} />
			${
				c.operator === "between"
					? html`<input type="text" class="cond-value2" data-index=${i} data-testid=${`${prefix}cond-value2-${i}`} .value=${c.value2 || ""} placeholder="to"
						@input=${(e: Event) => this.#onConditionValue(i, "value2", e)} />`
					: nothing
			}
			<button class="remove-filter" data-index=${i} data-testid=${`${prefix}remove-filter-${i}`} @click=${() => this.#onRemoveCondition(i)}>x</button>
		</span>`;
	}

	/** The selected type's key, from its label, or the first type where none is selected. A label no type carries fails. */
	#syncSelectedDomainKey(): void {
		if (this.#selectedLabel) {
			const matching = this.#domainOptions.find((option) => option.queryLabel === this.#selectedLabel);
			if (!matching) throw new Error(`Selected label is not present in discovered concerns: ${this.#selectedLabel}`);
			this.#selectedDomainKey = matching.key;
			return;
		}
		const first = this.#domainOptions[0];
		if (!first) throw new Error("No selectable domain options discovered from concerns");
		this.#selectedDomainKey = first.key;
		this.#selectedLabel = first.queryLabel ?? "";
		if (!this.#selectedLabel) throw new Error(`Concern option ${first.key} is missing queryLabel`);
	}

	/** Read the select values, and report a server that did not answer: the reader then types the value. */
	#loadSelectValuesReported(force = false): void {
		void this.loadSelectValues(force).catch((err) => {
			if (isServerUnreachable(err)) return this.#deps.setStatus(`the values for this step are not available: ${errorDetail(err)}`);
			this.#deps.fail(`ShuActionsBar select-values load failed: ${errorDetail(err)}`);
		});
	}

	/** Announce the search the bar now describes. `asked` says a reader changed it. */
	#announce(asked = true): void {
		this.#trailLabel = contextLabel(this.#contextPatterns, { label: this.#selectedLabel, ...this.#selectFilters });
		this.#deps.onTrailChange();
		const detail = { asked, accessLevel: this.#accessLevel, label: this.#selectedLabel, conditions: searchConditions(this.#selectFilters, this.#conditions) };
		this.#host.dispatchEvent(new CustomEvent(SHU_EVENT.FILTER_CHANGE, { detail, bubbles: true, composed: true }));
	}

	/** Commit the search text to the view query, the source of the hash and a restore, and announce the search. Typing,
	 *  leaving the box and Go commit the same way. */
	#commitSearch(value: string): void {
		viewQuery.set({ q: value || null });
		this.#announce();
	}

	#cancelPendingSearch(): void {
		if (this.#searchDebounce) clearTimeout(this.#searchDebounce);
		this.#searchDebounce = null;
	}

	/**
	 * Record the committed search in the history as an entry a reader can restore. Only a search that searches, by text or
	 * a field value, is recorded, and not again while it is the newest entry. The history itself is compared, so a removed
	 * entry lets the same search be recorded again.
	 */
	#recordSearch(): void {
		const query = viewQuery.current;
		if (!query.q && !query.f.some((c) => c.predicate && c.value)) return;
		const history = this.#deps.history();
		const newest = Array.from(history.querySelectorAll<ShuSearchSummary>(SHU_TAG.SEARCH_SUMMARY)).at(-1);
		if (newest?.query && serializeViewQuery(newest.query) === serializeViewQuery(query)) return;
		const entry = new ShuSearchSummary();
		entry.query = query;
		entry.setAttribute("data-testid", `${this.#deps.testIdPrefix()}search-summary-${this.#searchNumber++}`);
		history.append(entry);
	}

	#onLabelChange = (e: CustomEvent): void => {
		const key = e.detail?.value;
		if (!key) return;
		this.#selectedDomainKey = key;
		this.#selectedLabel = this.#domainOptions.find((option) => option.key === key)?.queryLabel ?? "";
		this.#selectFilters = {};
		this.loadProperties();
		this.#loadSelectValuesReported(true);
		this.#announce();
	};

	#onSelectFilterChange = (e: Event): void => {
		const select = e.target as HTMLSelectElement;
		if (select.dataset.field) this.#selectFilters[select.dataset.field] = select.value;
		this.#announce();
		this.#recordSearch();
	};

	#onTextInput = (e: Event): void => {
		const value = (e.target as HTMLInputElement).value;
		this.#cancelPendingSearch();
		this.#searchDebounce = setTimeout(() => this.#commitSearch(value), SEARCH_DEBOUNCE_MS);
	};

	/** Leaving the search box commits exactly what was typed and records it. */
	#onTextBlur = (e: Event): void => {
		this.#cancelPendingSearch();
		this.#commitSearch((e.target as HTMLInputElement).value);
		this.#recordSearch();
	};

	#onSearchGo = (): void => {
		this.#cancelPendingSearch();
		this.#commitSearch(this.#deps.find<HTMLInputElement>(".text-search")?.value || "");
		this.#recordSearch();
	};

	#onAddCondition = (): void => {
		this.#conditions.push({ predicate: "", operator: "eq", value: "" });
		this.#host.requestUpdate();
	};

	#onRemoveCondition(index: number): void {
		this.#conditions.splice(index, 1);
		this.#host.requestUpdate();
		this.#announce();
	}

	#onConditionProperty(index: number, e: CustomEvent): void {
		this.#conditions[index].predicate = e.detail?.value || "";
	}

	/** A change to or from `between` adds or removes the second value, so it renders again. */
	#onConditionOperator(index: number, e: Event): void {
		const wasBetween = this.#conditions[index].operator === "between";
		this.#conditions[index].operator = (e.target as HTMLSelectElement).value as TSearchCondition["operator"];
		if (wasBetween !== (this.#conditions[index].operator === "between")) this.#host.requestUpdate();
	}

	#onConditionValue(index: number, field: "value" | "value2", e: Event): void {
		this.#conditions[index][field] = (e.target as HTMLInputElement).value;
	}
}
