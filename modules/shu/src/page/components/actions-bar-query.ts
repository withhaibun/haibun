/**
 * The actions bar's search mode: the type the query surface reads, a text search, a class expression a reader writes, the
 * distinct values a type's fields take and a `value` restriction to one of them, and the searches recorded in the bar's history. Every change a reader
 * makes announces the search the bar now describes as a filter change, which the query runs. The trail label names what
 * the search is about, for the bar's breadcrumb.
 */
import type { AccessQueryLevel } from "@haibun/core/lib/domains/resources.js";
import { html, type ReactiveController, type TemplateResult } from "lit";
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import { extractQuadsFromEvents } from "@haibun/core/lib/steps/derivations/quad-events.js";
import { allOf, manchesterOf, hasValue } from "@haibun/core/lib/records/domains/class-expression.js";
import { SHU_EVENT, SHU_TAG } from "../../domains/elements.js";
import type { TEvent } from "../ports.js";
import { isServerUnreachable } from "@haibun/core/lib/rpc-wire.js";
import { addObservedSelectValues, getSelectValues, hasSelectValues, hasUsableSelectValues, setSelectValues } from "../controllers/catalog-controller.js";
import { domainOptions, StepsChangedController } from "../controllers/registry-controller.js";
import type { TDomainOption } from "../derivations/steps.js";
import { pageTypes } from "../controllers/page-cell-controller.js";
import { NOTHING_SELECTED_LABEL, type TComboboxOption } from "../../domains/schemas.js";
import type { TContextPattern } from "@haibun/core/lib/conversation/domains/conversation.js";
import { getHash } from "../controllers/hash-controller.js";
import { typeNotHeld, viewQuery, appAccessLevel } from "../controllers/view-query-controller.js";
import { parseViewQuery, serializeViewQuery } from "../derivations/view-query.js";
import { contextLabel, isEntitySelection, type TContextExtra } from "../derivations/layout.js";
import type { TControllerHost } from "./controller-host.js";
import type { ShuActivityHistory } from "./shu-activity-history.js";
import { ShuSearchSummary } from "./shu-search-summary.js";
import { readSlashCommand } from "../derivations/step-input.js";
import { ClockController } from "../controllers/clock-controller.js";
import { selectValuesFor } from "../controllers/read-controller.js";
import "./shu-combobox.js";

/** The name of the typed search's trailing pause. */
const TYPED_SEARCH = "typed-search";

/** How long typing rests before the search text is committed. */
export const SEARCH_DEBOUNCE_MS = 300;

/** What a view states about the context it offers the bar: its total, the label the query surface can use, and the
 *  expression with which it was opened. */
type TQueryContextExtra = TContextExtra & { textQuery?: string; expression?: string };

/** The class expression a search runs, in Manchester syntax: the expression a reader wrote, and a `value` restriction for each
 *  select filter with a value; undefined where both are empty. */
export function searchExpression(selectFilters: Record<string, string>, written: string): string | undefined {
	const selected = Object.entries(selectFilters).flatMap(([field, value]) => (value ? [hasValue(field, value)] : []));
	const parts = [...(written.trim() ? [written.trim()] : []), ...(selected.length === 0 ? [] : [manchesterOf(allOf(selected))])];
	if (parts.length < 2) return parts[0];
	return parts.map((part) => `(${part})`).join(" and ");
}

/** What the query reads from the bar: its test-id prefix, the history searches are recorded in, the status it reports
 *  on, and the breadcrumb it requests to read the trail label again. */
type TActionsBarQueryDeps = { testIdPrefix: () => string; history: ShuActivityHistory; setStatus: (message: string) => void; onTrailChange: () => void };

export class ActionsBarQuery implements ReactiveController {
	readonly #host: TControllerHost;
	readonly #deps: TActionsBarQueryDeps;
	#contextPatterns: TContextPattern[] = [];
	/** The read access every query here runs at, opening at the level the page opened at, so the bar and the snapshot
	 *  cannot open at different levels. */
	#readLevel = appAccessLevel();
	#trailLabel = NOTHING_SELECTED_LABEL;
	/** The class expression a reader wrote, which the search runs with the select filters. */
	#written = "";
	/** The expression the bar last announced, so a view stating it back doesn't replace what the reader chose. */
	#announced: string | undefined = undefined;
	#domainOptions: TDomainOption[] = [];
	/** Whether the types the query surface offers have been read, so a selected label can be checked against them. */
	#typesRead = false;
	/** The types, as the type selector offers them: each by the domain key the hash uses, grouped declared first. */
	#typeOptions: TComboboxOption[] = [];
	#selectedDomainKey = "";
	#selectFilters: Record<string, string> = {};
	#selectedLabel = "";
	/** Each recorded search's number, never reused, so removing one never leaves two sharing a test id. */
	#searchNumber = 0;
	/** The search typed text commits after a trailing pause (`SEARCH_DEBOUNCE_MS`). */
	#clock: ClockController;

	constructor(host: TControllerHost, deps: TActionsBarQueryDeps) {
		this.#host = host;
		this.#deps = deps;
		host.addController(this);
		this.#clock = new ClockController(host);
		new StepsChangedController(host, () => this.readTypes());
	}

	hostDisconnected(): void {
		this.#cancelPendingSearch();
	}

	/** After each render, the search box shows the stored text. It is uncontrolled while a reader types, so never while it
	 *  has focus. */
	hostUpdated(): void {
		const input = this.#searchBox();
		if (!input || this.#host.shadowRoot?.activeElement === input) return;
		const q = viewQuery.signals.q.get() ?? "";
		if (input.value !== q) input.value = q;
	}

	get readLevel(): AccessQueryLevel {
		return this.#readLevel;
	}

	get selectedLabel(): string {
		return this.#selectedLabel;
	}

	get trailLabel(): string {
		return this.#trailLabel;
	}

	/** Take the context a view offers: its patterns, the access it reads at, and the label and expression with which it opened. A
	 *  view offers a label only when the query surface can use one, so a schema view leaves the label as it is. */
	setContext(patterns: TContextPattern[], readLevel: AccessQueryLevel, extra?: TQueryContextExtra): void {
		this.#contextPatterns = patterns;
		this.#readLevel = readLevel;
		if (extra?.label !== undefined && extra.label !== this.#selectedLabel) {
			this.#selectedLabel = extra.label || "";
			this.#syncSelectedDomainKey();
			this.#loadSelectValuesReported();
		}
		// A view that opened at an expression the bar didn't announce states it as written, and the select filters don't narrow it.
		if (extra?.expression !== undefined && extra.expression !== this.#announced) {
			this.#written = extra.expression;
			this.#selectFilters = {};
		}
		if (!isEntitySelection(patterns)) this.#trailLabel = contextLabel(patterns, extra);
		this.#deps.onTrailChange();
	}

	/** The read access every query here runs at, set from the permissions panel. */
	setReadLevel(level: AccessQueryLevel): void {
		this.#readLevel = level;
		this.#announce();
	}

	/**
	 * Read the types the query surface offers and settle on one: the label and expression the address names, else the
	 * first type. The search it describes is announced as not requested, since the bar restoring itself isn't a reader
	 * looking for results.
	 */
	async loadDomains(): Promise<void> {
		const { label, x } = parseViewQuery(getHash());
		if (!this.#selectedLabel) this.#selectedLabel = label ?? "";
		if (x !== null) this.#written = x;
		await this.readTypes();
		this.#loadSelectValuesReported();
		this.#announce(false);
	}

	/** Read the types the query surface offers and the fields of the selected type. The bar reads them again when actuality's
	 *  steps change, which changes what actuality declares and not the search a reader chose, so the bar doesn't announce a search. */
	async readTypes(): Promise<void> {
		this.#domainOptions = await domainOptions();
		if (this.#domainOptions.length === 0) throw new Error("the concern catalog didn't produce a domain option");
		this.#typesRead = true;
		this.#typeOptions = this.#domainOptions.map((o) => ({ value: o.key, label: o.queryLabel, group: o.group }));
		this.#syncSelectedDomainKey();
		this.#host.requestUpdate();
	}

	/** Read the distinct values the selected type's fields take. Values the bar already holds are kept, unless `force`: a
	 *  read made before the type's data was indexed doesn't return values, and keeping that would freeze the menus until a reload. */
	async loadSelectValues(force = false): Promise<void> {
		const label = this.#selectedLabel;
		if (!label || !this.#selectedDomainKey || (!force && hasUsableSelectValues(label))) return;
		setSelectValues(label, await selectValuesFor(label));
		this.#host.requestUpdate();
	}

	/** Take the distinct values a batch of events adds for the selected type, rather than requesting them from the server
	 *  again: the request would itself be recorded, and that record would be another change to read. */
	observe(events: TEvent[]): void {
		if (this.#selectedLabel && addObservedSelectValues(this.#selectedLabel, extractQuadsFromEvents(events))) this.#host.requestUpdate();
	}

	/** The search mode's input line: the mode and the text the search reads. The page strip shows the type the search reads,
	 *  beside what the search found. */
	template(modeToggle: TemplateResult): TemplateResult {
		const prefix = this.#deps.testIdPrefix();
		return html`<div class="filter-bar">
			${modeToggle}
			<input type="text" class="text-search" data-testid=${`${prefix}text-search`} placeholder="search..." @input=${this.#onTextInput} @blur=${this.#onTextBlur} />
		</div>`;
	}

	/** The search's filters, which the pane's settings control shows: the values each field of the type holds, and the class
	 *  expression a reader writes, which the instance reads. */
	settingsTemplate(): TemplateResult {
		const prefix = this.#deps.testIdPrefix();
		const label = this.#selectedLabel;
		const fields = label && hasSelectValues(label) ? getSelectValues(label) : {};
		return html`<div class="filter-bar search-settings">
			${Object.entries(fields)
				.filter(([, values]) => values.length > 0)
				.map(([field, values]) => {
					const current = this.#selectFilters[field] ?? "";
					return html`<select class="select-filter" data-field=${field} data-testid=${`${prefix}select-${field}`} @change=${this.#onSelectFilterChange}>
						<option value="">all ${field}s</option>
						${values.map((v) => html`<option value=${v} ?selected=${v === current} data-testid=${`${prefix}select-${field}-option-${v}`}>${v}</option>`)}
					</select>`;
				})}
			<input type="text" class="expression" data-testid=${`${prefix}expression`} .value=${this.#written} placeholder="class expression, such as folder value &quot;Drafts&quot;"
				@change=${this.#onExpressionChange} />
		</div>`;
	}

	/** The selected type's key, from its label, or the first type where a type isn't selected. A label the types don't carry stays
	 *  selected without a key, and the bar reports that actuality doesn't hold such a type. */
	#syncSelectedDomainKey(): void {
		// A view can state its context before the types are read, when the bar connects after it: the label is held, and
		// reading the types settles it.
		if (!this.#typesRead) return;
		if (this.#selectedLabel) {
			// A type actuality doesn't hold stays chosen, as the address names it, and the page offers actuality's types.
			const matching = this.#domainOptions.find((option) => option.queryLabel === this.#selectedLabel);
			this.#selectedDomainKey = matching?.key ?? "";
			this.#statePageTypes();
			// The bar's type select offers the types actuality holds, so the status states the cause.
			if (!matching) this.#deps.setStatus(typeNotHeld(this.#selectedLabel, []).error);
			return;
		}
		const first = this.#domainOptions[0];
		if (!first) throw new Error("the concerns don't offer a selectable domain option");
		this.#selectedDomainKey = first.key;
		this.#selectedLabel = first.queryLabel ?? "";
		this.#statePageTypes();
		if (!this.#selectedLabel) throw new Error(`Concern option ${first.key} is missing queryLabel`);
	}

	/** Read the select values, and report a server that didn't respond: the reader then types the value. */
	#loadSelectValuesReported(force = false): void {
		void this.loadSelectValues(force).catch((err) => {
			if (isServerUnreachable(err)) return this.#deps.setStatus(`the values for this step are not available: ${errorDetail(err)}`);
			const message = `ShuActionsBar select-values load failed: ${errorDetail(err)}`;
			this.#deps.setStatus(message);
			throw new Error(message);
		});
	}

	/** Emit the search the bar now describes. `asked` states that a reader changed it. */
	#announce(asked = true): void {
		this.#trailLabel = contextLabel(this.#contextPatterns, { label: this.#selectedLabel, ...this.#selectFilters });
		this.#deps.onTrailChange();
		this.#announced = searchExpression(this.#selectFilters, this.#written);
		const detail = { asked, readLevel: this.#readLevel, label: this.#selectedLabel, expression: this.#announced === undefined ? "" : this.#announced };
		this.#host.dispatchEvent(new CustomEvent(SHU_EVENT.FILTER_CHANGE, { detail, bubbles: true, composed: true }));
	}

	/** Commit the search text to the view query, the source of the hash and a restore, and announce the search. Typing,
	 *  leaving the box and Go commit the same way. */
	#commitSearch(value: string): void {
		viewQuery.set({ q: value || null });
		this.#announce();
	}

	#searchBox(): HTMLInputElement | null {
		return this.#host.renderRoot.querySelector<HTMLInputElement>(".text-search");
	}

	#cancelPendingSearch(): void {
		this.#clock.cancel(TYPED_SEARCH);
	}

	/**
	 * Record the committed search in the history as an entry a reader can restore. Only a search that searches, by text or
	 * a field value, is recorded, and not again while it is the newest entry. The history itself is compared, so a removed
	 * entry lets the same search be recorded again.
	 */
	#recordSearch(): void {
		const query = viewQuery.current;
		if (!query.q && !query.x) return;
		const history = this.#deps.history;
		const newest = Array.from(history.querySelectorAll<ShuSearchSummary>(SHU_TAG.SEARCH_SUMMARY)).at(-1);
		if (newest?.query && serializeViewQuery(newest.query) === serializeViewQuery(query)) return;
		const entry = new ShuSearchSummary();
		entry.query = query;
		entry.setAttribute("data-testid", `${this.#deps.testIdPrefix()}search-summary-${this.#searchNumber++}`);
		history.append(entry);
	}

	/** Read the type the key names, as the page strip's type control requests. The search states the type it reads, so a
	 *  choice the strip makes and one the address restores take the same path. */
	chooseType(key: string): void {
		this.#selectedDomainKey = key;
		this.#selectedLabel = this.#domainOptions.find((option) => option.key === key)?.queryLabel ?? "";
		// A field restriction names the fields of the type it was written for, so a new type starts from all its records.
		this.#selectFilters = {};
		this.#written = "";
		this.#loadSelectValuesReported(true);
		this.#statePageTypes();
		this.#announce();
	}

	/** State the types the page offers and the one the search reads, which the page strip shows. A page given what it
	 *  already holds renders again without a change, so the types are stated as they change. */
	#statePageTypes(): void {
		const stated = pageTypes.get();
		if (stated.options === this.#typeOptions && stated.selected === this.#selectedDomainKey) return;
		pageTypes.set({ options: this.#typeOptions, selected: this.#selectedDomainKey });
	}

	#onSelectFilterChange = (e: Event): void => {
		const select = e.target as HTMLSelectElement;
		if (select.dataset.field) this.#selectFilters[select.dataset.field] = select.value;
		this.#announce();
		this.#recordSearch();
	};

	#onTextInput = (e: Event): void => {
		const text = searchText((e.target as HTMLInputElement).value);
		this.#cancelPendingSearch();
		if (text !== undefined) this.#clock.trailing(TYPED_SEARCH, SEARCH_DEBOUNCE_MS, () => this.#commitSearch(text));
	};

	/** Leaving the search box commits exactly what was typed and records it. */
	#onTextBlur = (e: Event): void => {
		const text = searchText((e.target as HTMLInputElement).value);
		this.#cancelPendingSearch();
		if (text === undefined) return;
		this.#commitSearch(text);
		this.#recordSearch();
	};

	/** Searches for `text`, as the reader typing it and leaving the search box does. */
	enter(text: string): void {
		const box = this.#searchBox();
		if (box) box.value = text;
		this.#cancelPendingSearch();
		this.#commitSearch(text);
		this.#recordSearch();
	}

	/** A reader's expression runs as they leave it or press Enter, and is recorded. */
	#onExpressionChange = (e: Event): void => {
		this.#written = (e.target as HTMLInputElement).value;
		this.#announce();
		this.#recordSearch();
	};
}

/** The text that a search box's value searches. A value opening with a slash command is a command until Enter runs it, and
 *  isn't searched; a value opening with a double slash searches for its text with one slash. */
function searchText(value: string): string | undefined {
	const command = readSlashCommand(value);
	if (!command) return value;
	return command.kind === "literal" ? command.text : undefined;
}
