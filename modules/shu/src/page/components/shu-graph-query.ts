/**
 * <shu-graph-query>: the query of the graph store, as the address states it, and its rows in a result table: sorted,
 * read a window at a time, and selected one or several at a time.
 */
import { firstDeclaredType, getTypes } from "../controllers/catalog-controller.js";
import { html, css, nothing, type TemplateResult } from "lit";
import { ref, createRef } from "lit/directives/ref.js";
import { SHU_EVENT, SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { openRef } from "./ref-navigation.js";
import { REF_DENOTES } from "@haibun/core/lib/typed-links.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { CountedSchema, MAX_PAGE_ROWS, counted, viewCollection, type TCounted } from "@haibun/core/lib/hypermedia.js";
import { QueryViewSchema } from "../../schemas.js";
import { anIndividual, aType, type TContextPattern } from "@haibun/core/lib/conversation/domains/conversation.js";
import type { TSearchCondition } from "@haibun/core/lib/quad-types.js";
import { typeNotHeld, viewQuery, type THeldTypeLink, type TViewQuery } from "../../view-query.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { ViewQueryControlSchema } from "./shu-graph-query.controls-schema.js";
import { shuBaseStyles } from "./styles.js";
import type { ShuResultTable } from "./shu-result-table.js";
import "./shu-result-table.js";
import "./shu-refusal.js";
import { isOffline } from "../controllers/hydration-controller.js";
import { getAvailableSteps } from "../controllers/registry-controller.js";
import { QueryController } from "../controllers/query-controller.js";
import { arrayWindowedSource, readWindowedSource, type WindowedSource } from "../../windowed-source.js";
import { SettingController } from "../controllers/setting-controller.js";
import { INITIAL_WINDOW_SIZE, WindowSizeSchema } from "../domains/settings.js";
import { windowRows } from "../derivations/settings.js";
import { extractQuadsFromEvents } from "@haibun/core/lib/quad-types.js";
import { ClockController } from "../controllers/clock-controller.js";
import { refusalOf } from "../derivations/refusal.js";
import type { TPageRefusal } from "../domains/refusal.js";

/** The name of the delay before the query reads again after arrivals. */
const ARRIVAL = "arrival";

/** A vertex row: flat property object. */
type VertexRow = Record<string, unknown>;

/** How long the view waits after a record arrives before asking again. One record arrives as many quads and mail
 *  arrives in bursts, so a trailing pause turns a burst into one query. */
const ARRIVAL_DEBOUNCE_MS = 400;

export class ShuGraphQuery extends ShuElement<typeof QueryViewSchema> {
	static styles = [
		shuBaseStyles,
		css`
		:host { display: block; height: 100%; overflow: hidden; color: var(--shu-fg); }
		.results-pane { display: flex; flex-direction: column; height: 100%; overflow: hidden; position: relative; }
		.remedies { display: flex; flex-wrap: wrap; gap: var(--shu-space-3); padding: var(--shu-space-2) var(--shu-space-4); }
	`,
	];

	static schema = QueryViewSchema;
	static domainSelector = SHU_TAG.GRAPH_QUERY;

	#query = new QueryController(this);
	private results: VertexRow[] = [];
	private sortableFields: string[] = [];
	private labels: string[] = [];
	/** The read of actuality's types, which a query waits on: a type is asked for only where actuality holds it. */
	#metadata: Promise<void> = Promise.resolve();
	/** The query's row count and whether that count stopped at a ceiling. */
	#counted: TCounted = counted(0);
	#source: WindowedSource<VertexRow> = arrayWindowedSource<VertexRow>([]);
	#installedSource: WindowedSource<VertexRow> | null = null;

	/** The current search as linked data: the rows the visible page shows, with the query that produced them.
	 *  `totalItems` carries the count. `saturated` reports whether the count stopped at a ceiling. */
	summarizeForContext(): TLinkedData | null {
		if (this.results.length === 0) return null;
		const { label, textQuery } = this.state as { label?: string; textQuery?: string };
		return viewCollection({
			id: "view:query",
			name: "the search results shown in this column",
			items: this.results,
			totalItems: this.#counted.total,
			stated: { saturated: this.#counted.saturated, ...(label ? { queryType: label } : {}), ...(textQuery ? { textQuery } : {}) },
		});
	}
	/** The window size `<shu-window-size>` stores. A change of it reads the query again, since it sets the page's limit. */
	readonly #windowSize = new SettingController(this, SHU_TAG.WINDOW_SIZE, WindowSizeSchema, INITIAL_WINDOW_SIZE, () => void this.executeQuery());
	/** The page size: the window size every windowed view reads. */
	private get limit(): number {
		return windowRows(this.#windowSize.value);
	}
	/** Why the query wasn't read, where it was refused. */
	#refusal: TPageRefusal | undefined = undefined;
	readonly #table = createRef<ShuResultTable>();
	/** The links a refusal offers: the query of each type actuality holds, where the address names a type it doesn't hold. */
	#remedies: THeldTypeLink[] = [];

	// The query (type, search, sort, page, access, filters) IS the hash-backed viewQuery store: the single,
	// schema-validated, reload-safe source of truth. These getters read it; writes go through viewQuery.set().
	private get qLabel(): string | undefined {
		return viewQuery.signals.label.get() ?? undefined;
	}
	private get qText(): string | undefined {
		return viewQuery.signals.q.get() ?? undefined;
	}
	private get qSort(): string | undefined {
		return viewQuery.signals.sort.get() ?? undefined;
	}
	private get qOrder(): "asc" | "desc" {
		return viewQuery.signals.order.get();
	}
	private get qConditions(): TSearchCondition[] {
		return viewQuery.signals.f.get();
	}
	private get qAccess(): string {
		return viewQuery.signals.access.get();
	}
	private get qOffset(): number {
		return viewQuery.signals.offset.get();
	}
	private lastQueryKey = "";
	/** The `label` of the most recently *started* query. A change means the node type switched, so the previous type's rows are dropped before the new query lands: a stale-row click would otherwise open the wrong entity. */
	private lastQueriedLabel: string | undefined;
	/** In-flight promise, coalesces concurrent identical `executeQuery` calls. The key is `lastQueryKey` (set immediately after the dedup check). */
	private inflightPromise: Promise<void> | null = null;
	private selectedIds = new Set<string>();

	static observedHtmlAttributes = ["label", "sort-by", "sort-order"];

	constructor() {
		super(QueryViewSchema, { sortOrder: "desc" as const });
	}

	protected override onAttributeChanged(_name: string, _old: string | null, _val: string | null): void {
		if (!this.hasHash()) this.seedFromAttributes();
	}

	protected override onConnected(): void {
		viewQuery.hydrate(); // store ← URL hash (fail-fast); defaults when empty
		if (!this.hasHash()) this.seedFromAttributes(); // alternate input when the URL doesn't carry a query
		this.autoListen(window, "hashchange", () => {
			if (viewQuery.wroteHash(ShuElement.getHash())) return; // the component's own writes use replaceState (which doesn't fire an event); this catches back/forward
			viewQuery.hydrate();
			void this.executeQuery();
		});
		this.#metadata = this.loadMetadata();
		void this.#metadata.then(() => this.executeQuery());

		// Re-query when the text search changes in the store. The actions-bar search box writes viewQuery
		// directly (not through this component's lifecycle), so a store write is the single, lifecycle-proof
		// trigger, without debounce-cleared-on-disconnect or setContext-reset fragility. Subscribes to `q` only,
		// so the server-default-sort reflection (which writes `sort`) can't re-trigger it.
		let firstSearch = true;
		this.updateEffect(() => {
			viewQuery.signals.q.get(); // subscribe to the search term
			if (firstSearch) {
				firstSearch = false;
				return;
			}
			void this.executeQuery();
		});

		if (!isOffline()) {
			this.autoTeardown(this.subscribeBatched({ onBatch: (events) => this.applyLiveQuads(events) }));
		}
	}

	/** Apply filters from the actions bar and re-execute the query. */
	setFilters(filters: { readLevel?: string; label?: string; textQuery?: string; conditions?: TSearchCondition[] }): void {
		const patch: Partial<TViewQuery> = { offset: 0 }; // any filter change resets pagination
		if (filters.readLevel !== undefined) patch.access = filters.readLevel as TViewQuery["access"];
		if (filters.label !== undefined) {
			patch.label = filters.label || null;
			// Sort columns are label-specific: the server rejects a sortBy not in the new label's topology.sortColumns:
			// so switching type drops any sort carried over from the previous type (the new label sorts by its default).
			if ((filters.label || null) !== (this.qLabel ?? null)) patch.sort = null;
		}
		if (filters.textQuery !== undefined) patch.q = filters.textQuery || null;
		if (filters.conditions) patch.f = filters.conditions;
		viewQuery.set(patch);
		void this.executeQuery();
	}

	/** Apply a view-query control product (from a shu-graph-query.controls step) to the store, then re-query.
	 *  The product is validated against the control schema; hypermedia markers (_component, _type, …) added by
	 *  dispatch are stripped by the schema. This is the scriptable, hypermedia-driven entry the feature steps reach. */
	set products(product: Record<string, unknown>) {
		viewQuery.set(ViewQueryControlSchema.parse(product));
		void this.executeQuery();
	}

	/** Deselect all rows and revert to query context. */
	deselectAll(): void {
		if (this.selectedIds.size === 0) return;
		this.selectedIds.clear();
		this.#table.value?.deselectAll();
		this.dispatchContextChange();
	}

	/** What this view shows: the selected rows as records of the queried type, else the type narrowed by its conditions. */
	override paneSubject(): TContextPattern[] | null {
		const label = this.qLabel;
		if (!label) return null;
		return this.selectedIds.size > 0 ? [...this.selectedIds].map((id) => anIndividual(label, id)) : [aType(label, this.qConditions)];
	}

	private dispatchContextChange(): void {
		// Selected rows are records of the label this query ran under, so each is named by that pair; where a row isn't selected,
		// the ask is about the queried type itself, narrowed by whatever the filter rows carry.
		const conditions = this.qConditions.filter((c) => c.predicate && c.value);
		const patterns: TContextPattern[] = this.paneSubject() ?? [];

		this.dispatchEvent(
			new CustomEvent(SHU_EVENT.CONTEXT_CHANGE, {
				detail: { patterns, readLevel: this.qAccess, total: this.#counted, label: this.qLabel, textQuery: this.qText, labels: this.labels, conditions },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private hasHash(): boolean {
		const h = ShuElement.getHash();
		return h.length > 1 && h.startsWith("#?");
	}

	/** Alternate input: when the URL doesn't carry a query, seed the store from the element's attributes. */
	private seedFromAttributes(): void {
		const patch: Partial<TViewQuery> = {};
		const label = this.getAttribute("label");
		if (label) patch.label = label;
		const textQuery = this.getAttribute("text-query");
		if (textQuery) patch.q = textQuery;
		const sortBy = this.getAttribute("sort-by");
		if (sortBy) patch.sort = sortBy;
		const sortOrder = this.getAttribute("sort-order");
		if (sortOrder === "asc" || sortOrder === "desc") patch.order = sortOrder;
		if (Object.keys(patch).length > 0) viewQuery.set(patch);
	}

	/** Reads the types the query offers: those the catalog declares, read with actuality's steps (CA4B4). */
	async loadMetadata(): Promise<void> {
		await getAvailableSteps();
		this.labels = getTypes();
		this.requestUpdate();
	}

	async executeQuery(): Promise<void> {
		await this.#metadata;
		const label = this.qLabel;
		const textQuery = this.qText;
		// The server rejects a query that doesn't name a type or text, or a type actuality doesn't hold; asking anyway fails
		// identically on every retrigger (each SSE batch fires one), flooding the server and actuality log. Report why once
		// instead. An address outlives the actuality it was made in, so it keeps the type it names.
		if (!label && !textQuery?.trim()) return this.#refuse("a query needs a record type or search text");
		if (label && !this.labels.includes(label)) {
			const refusal = typeNotHeld(label, this.labels);
			return this.#refuse(refusal.error, refusal.held);
		}
		const sortBy = this.qSort;
		const sortOrder = this.qOrder;

		const validConditions = this.qConditions
			.filter((c) => c.predicate && c.value)
			.map((c) => ({ predicate: c.predicate, operator: c.operator, value: c.value, ...(c.operator === "between" && c.value2 ? { value2: c.value2 } : {}) }));

		const queryKey = JSON.stringify({ label, textQuery, conditions: validConditions, sortBy: sortBy || "", sortOrder, offset: this.qOffset, limit: this.limit });
		// Coalesce concurrent identical fires (e.g. hashchange + initial connect).
		if (this.inflightPromise && this.lastQueryKey === queryKey) return this.inflightPromise;
		const resultsChanged = queryKey !== this.lastQueryKey;
		this.lastQueryKey = queryKey;

		if (label !== this.lastQueriedLabel) {
			// The node type changed: drop the previous type's rows now so they are never left
			// clickable while the new query is in flight: a stale-row click would open the wrong
			// entity (its id is a different type). The new rows render when `work` resolves.
			this.lastQueriedLabel = label;
			this.results = [];
			this.#counted = counted(0);
			this.#source = arrayWindowedSource<VertexRow>([]);
			this.requestUpdate();
		}

		this.#refusal = undefined;
		this.#remedies = [];
		const work = (async () => {
			try {
				const payload = {
					accessLevel: this.qAccess,
					label,
					filters: validConditions,
					textQuery: textQuery || undefined,
					...(sortBy ? { sortBy } : {}),
					sortOrder,
					// A request reads at most MAX_PAGE_ROWS rows. The source reads the rest of a larger window after these rows.
					limit: Math.min(this.limit, MAX_PAGE_ROWS),
					offset: this.qOffset,
				};
				const data = await this.#query.run(payload);
				// Out-of-order guard: a newer query (e.g. a type switch) replaced this queryKey while this
				// RPC was in flight, so this response is stale. Ignore it, applying it would overwrite the
				// current type's rows with the previous type's, leaving the wrong type's rows clickable. The
				// current query renders its own response when it resolves.
				if (this.lastQueryKey !== queryKey) return;
				this.results = data.vertices;
				this.#counted = CountedSchema.parse(data);
				this.#buildSource(payload, this.results, this.qOffset);
				this.sortableFields = data.sort?.fields ?? [];
				// Reflect the server's resolved sort, including the per-type default the client didn't explicitly pick, so the result-table indicator highlights the active column.
				if (data.sort?.current?.field && !this.qSort) viewQuery.set({ sort: data.sort.current.field, order: data.sort.current.order });
				if (data.cypher) {
					const pane = this.closest("shu-column-pane");
					if (pane) pane.setAttribute("label", data.cypher);
				}
			} catch (err) {
				this.#refusal = refusalOf(err);
			}
			this.requestUpdate();
			if (resultsChanged) this.selectedIds.clear(); // a fresh result set invalidates the row selection
			this.dispatchContextChange();
		})();
		this.inflightPromise = work.finally(() => {
			this.inflightPromise = null;
		});
		return this.inflightPromise;
	}

	/**
	 * Apply what a live batch carries to the rows on screen, instead of asking the server again.
	 *
	 * A change arrives AS the quads that changed, so a row already shown is brought up to date from them. Answering a
	 * change with a fresh query is what made a view of actuality's own records feed itself: the query is dispatched as a
	 * step, the step is recorded in the graph, and that recording is another change to answer, without end. Rows past
	 * the ones on screen are read when a reader reaches them, which is what the windowed source already does.
	 */
	private applyLiveQuads(events: Record<string, unknown>[]): void {
		if (!this.qLabel) return;
		const quads = extractQuadsFromEvents(events);
		let changed = false;
		let arrived = false;
		for (const quad of quads) {
			if (quad.namedGraph !== this.qLabel) continue;
			const row = this.results.find((r) => String(r.id) === quad.subject);
			// A record this view holds takes the new value in place. One it does not hold is a record that arrived: which
			// rows the query matches, and in what order, is the server's answer, so the view asks again rather than
			// placing the record itself. Without this a record that arrived showed only after a reload.
			if (!row) {
				arrived = true;
				continue;
			}
			if (row[quad.predicate] === quad.object) continue;
			row[quad.predicate] = quad.object;
			changed = true;
		}
		if (arrived) this.#requeryOnArrival();
		else if (changed) this.requestUpdate();
	}

	readonly #clock = new ClockController(this);

	/** Reads the query again `ARRIVAL_DEBOUNCE_MS` after the first arrival of a burst. A record arrives as many quads, and
	 *  mail arrives in bursts, so one read covers them. */
	#requeryOnArrival(): void {
		this.#clock.coalesce(ARRIVAL, ARRIVAL_DEBOUNCE_MS, () => void this.executeQuery());
	}

	/** The rows of the current query, read a page at a time by the same graphQuery the first read used, with that page
	 *  already in hand so the first paint doesn't need a second read. */
	#buildSource(payload: Record<string, unknown>, page0: readonly VertexRow[], startRow: number): void {
		this.#source = readWindowedSource<VertexRow>({
			size: this.limit,
			read: (start, end) => this.#query.run({ ...payload, limit: end - start, offset: start }),
			held: { vertices: page0, ...this.#counted },
			from: startRow,
		});
	}

	private onSortChange = (e: Event): void => {
		const { field, order } = (e as CustomEvent<{ field: string; order: "asc" | "desc" }>).detail;
		viewQuery.set({ sort: field === "" ? null : field, order, offset: 0 });
		void this.executeQuery();
	};

	/** A row selects its record, a press with ctrl adds it to the selection, and a press on a selected row alone clears it.
	 *  A selection opens its record beside the query's pane. */
	private onRowClick = (e: Event): void => {
		const { individualId: vid, deselect, ctrlKey } = (e as CustomEvent<{ individualId: string | null; deselect?: boolean; ctrlKey?: boolean }>).detail;
		if (deselect === true) {
			this.selectedIds.clear();
			this.dispatchContextChange();
			return;
		}
		if (vid === null) return;
		if (ctrlKey === true) {
			if (this.selectedIds.has(vid)) this.selectedIds.delete(vid);
			else this.selectedIds.add(vid);
		} else if (this.selectedIds.has(vid) && this.selectedIds.size === 1) {
			this.selectedIds.clear();
		} else {
			this.selectedIds.clear();
			this.selectedIds.add(vid);
		}
		this.dispatchContextChange();
		// The result table is the source, since the pruning of the columns starts from the query's pane.
		if (this.selectedIds.size > 0) openRef(e.target as Element, REF_DENOTES.individual, { persistedAs: this.qLabel ?? firstDeclaredType(), id: vid }, ctrlKey === true);
	};

	/** Show why the query wasn't sent, with the links that remedy it, and clear the rows. */
	#refuse(why: string, remedies: THeldTypeLink[] = []): void {
		this.#refusal = { error: why };
		this.#remedies = remedies;
		this.results = [];
		this.#counted = counted(0);
		this.#source = arrayWindowedSource<VertexRow>([]);
		this.requestUpdate();
	}

	/** Gives the table the query's sort, selection mode, type and rows. */
	protected override updated(): void {
		const table = this.#table.value;
		if (table === undefined) return;
		table.updateState({ sortBy: this.qSort, sortOrder: this.qOrder, selectable: true, paginated: this.#counted.saturated || this.#counted.total > this.limit });
		if (this.qLabel !== undefined) table.persistedAs = this.qLabel;
		table.collection = viewQuery.hashWith({ offset: 0 });
		table.setSortableFields(this.sortableFields);
		if (this.#source !== this.#installedSource) {
			table.setSource(this.#source);
			this.#installedSource = this.#source;
		}
	}

	render(): TemplateResult {
		const refusal = this.#refusal;
		if (refusal !== undefined) {
			const links = this.#remedies.map(({ label, href }) => html`<a href=${href} data-testid=${`${SHU_TEST_IDS.QUERY.HELD_TYPE}-${label}`}>${label}</a>`);
			return html`<div class="results-pane" data-testid=${SHU_TEST_IDS.QUERY.ROOT}><shu-refusal .refusal=${refusal} .readAgain=${() => void this.executeQuery()}></shu-refusal>${links.length === 0 ? nothing : html`<nav class="remedies">${links}</nav>`}</div>`;
		}
		return html`<div class="results-pane" data-testid=${SHU_TEST_IDS.QUERY.ROOT}><shu-result-table ${ref(this.#table)} @sort-change=${this.onSortChange} @row-click=${this.onRowClick}></shu-result-table></div>`;
	}
}

defineElement(SHU_TAG.GRAPH_QUERY, ShuGraphQuery);
