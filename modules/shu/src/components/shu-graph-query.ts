import { errorDetail } from "@haibun/core/lib/util/index.js";
import { html, css, type TemplateResult } from "lit";
import { defaultLabel } from "../util.js";
import { SHU_EVENT, SHU_TAG } from "../consts.js";
/**
 * <shu-graph-query> — Query component for the graph store.
 * Renders in light DOM .results-target, hash state, custom scrollbar, sort, multi-select.
 */
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { QueryViewSchema } from "../schemas.js";
import type { TSearchCondition } from "@haibun/core/lib/quad-types.js";
import { viewQuery, type TViewQuery } from "../view-query.js";
import { ViewQueryControlSchema } from "./shu-graph-query.controls-schema.js";
import { shuBaseStyles } from "./styles.js";
import { esc, setIdFields } from "../util.js";
import { setSiteMetadata, getConcernDerivedMetadata } from "../rels-cache.js";
import type { ShuResultTable } from "./shu-result-table.js";
import { } from "../hypermedia.js";
import { getAvailableDomains, isOffline } from "../rpc-registry.js";
import { QueryController } from "../controllers/index.js";
import { arrayWindowedSource, lazyWindowedSource, type WindowedSource } from "../windowed-source.js";
import { getWindowSize } from "../window-size-setting.js";
import { extractQuadsFromEvents } from "@haibun/core/lib/quad-types.js";

/** A vertex row: flat property object. */
type VertexRow = Record<string, unknown>;

export class ShuGraphQuery extends ShuElement<typeof QueryViewSchema> {
	static styles = [
		shuBaseStyles,
		css`
		:host { display: block; color: var(--shu-fg); }
	`,
	];

	static schema = QueryViewSchema;
	static domainSelector = SHU_TAG.GRAPH_QUERY;

	#query = new QueryController(this);
	private results: VertexRow[] = [];
	private sortableFields: string[] = [];
	private labels: string[] = [];
	private total = 0;
	#source: WindowedSource<VertexRow> = arrayWindowedSource<VertexRow>([]);
	#installedSource: WindowedSource<VertexRow> | null = null;

	/** The current search as linked data: an `as:Collection` of the rows the visible page shows, with the query that produced them; `totalItems` carries the full count. */
	summarizeForKihan(): TLinkedData | null {
		if (this.results.length === 0) return null;
		const { label, textQuery } = this.state as { label?: string; textQuery?: string };
		return {
			"@id": "view:query",
			"@type": "as:Collection",
			name: "the search results shown in this column",
			...(label ? { queryType: label } : {}),
			...(textQuery ? { textQuery } : {}),
			totalItems: this.total,
			items: this.results,
		};
	}
	/** Page size is the one global app setting (theme), so the query view windows by the same size as every other view. */
	private get limit(): number {
		return getWindowSize();
	}
	private error = "";

	// The query (type, search, sort, page, access, filters) IS the hash-backed viewQuery store — the single,
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
	/** The `label` of the most recently *started* query. A change means the node type switched, so the previous type's rows are dropped before the new query lands — a stale-row click would otherwise open the wrong entity. */
	private lastQueriedLabel: string | undefined;
	/** In-flight promise — coalesces concurrent identical `executeQuery` calls. The key is `lastQueryKey` (set immediately after the dedup check). */
	private inflightPromise: Promise<void> | null = null;
	private selectedIds = new Set<string>();

	static observedHtmlAttributes = ["label", "sort-by", "sort-order", "results-target"];

	constructor() {
		super(QueryViewSchema, { sortOrder: "desc" as const });
	}

	protected override onAttributeChanged(_name: string, _old: string | null, _val: string | null): void {
		if (!this.hasHash()) this.seedFromAttributes();
	}

	protected override onConnected(): void {
		viewQuery.hydrate(); // store ← URL hash (fail-fast); defaults when empty
		if (!this.hasHash()) this.seedFromAttributes(); // alternate input when the URL carries no query
		this.autoListen(window, "hashchange", () => {
			if (viewQuery.wroteHash(ShuElement.getHash())) return; // our own writes use replaceState (no event); this catches back/forward
			viewQuery.hydrate();
			void this.executeQuery();
		});
		void this.loadMetadata().then(() => this.executeQuery());

		// Re-query when the global data window size changes — it sets the server-side limit, so the result set resizes.
		let firstWindow = true;
		this.updateEffect(() => {
			getWindowSize(); // subscribe to the window-size setting
			if (firstWindow) {
				firstWindow = false;
				return;
			}
			void this.executeQuery();
		});

		// Re-query when the text search changes in the store. The actions-bar search box writes viewQuery
		// directly (not through this component's lifecycle), so a store write is the single, lifecycle-proof
		// trigger — no debounce-cleared-on-disconnect or setContext-reset fragility. Subscribes to `q` only,
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
			this.autoTeardown(
				this.subscribeBatched({
					onBatch: (events) => this.applyLiveQuads(events),
				}),
			);
		}
	}

	/** Apply filters from the actions bar and re-execute the query. */
	setFilters(filters: { accessLevel?: string; label?: string; textQuery?: string; conditions?: TSearchCondition[] }): void {
		const patch: Partial<TViewQuery> = { offset: 0 }; // any filter change resets pagination
		if (filters.accessLevel !== undefined) patch.access = filters.accessLevel as TViewQuery["access"];
		if (filters.label !== undefined) {
			patch.label = filters.label || null;
			// Sort columns are label-specific — the server rejects a sortBy not in the new label's topology.sortColumns —
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
		const target = this.resultsTarget;
		if (target) {
			target.querySelectorAll(".clickable-row").forEach((r) => r.classList.remove("selected"));
		}
		this.dispatchContextChange();
	}

	private dispatchContextChange(): void {
		const patterns = this.selectedIds.size > 0 ? [...this.selectedIds].map((s) => ({ s })) : this.buildQueryContextPatterns();

		this.dispatchEvent(
			new CustomEvent(SHU_EVENT.CONTEXT_CHANGE, {
				detail: {
					patterns,
					accessLevel: this.qAccess,
					total: this.total,
					label: this.qLabel,
					textQuery: this.qText,
					labels: this.labels,
					conditions: this.qConditions.filter((c) => c.predicate && c.value),
				},
				bubbles: true,
				composed: true,
			}),
		);
	}

	private buildQueryContextPatterns(): Array<{ s?: string; p?: string; o?: string }> {
		const patterns: Array<{ s?: string; p?: string; o?: string }> = [];
		const label = this.qLabel;
		if (label) patterns.push({ p: "label", o: label });
		for (const c of this.qConditions) {
			if (c.predicate && c.value) {
				patterns.push({ p: c.predicate, o: c.value });
			}
		}
		if (patterns.length === 0) patterns.push({});
		return patterns;
	}

	private hasHash(): boolean {
		const h = ShuElement.getHash();
		return h.length > 1 && h.startsWith("#?");
	}

	/** Alternate input: when the URL carries no query, seed the store from the element's attributes. */
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

	async loadMetadata(): Promise<void> {
		const domains = await getAvailableDomains();
		const derivedMeta = getConcernDerivedMetadata();
		const serverMeta = await this.#query.siteMetadata();
		if (serverMeta) Object.assign(derivedMeta, serverMeta);
		setSiteMetadata(derivedMeta);
		const persistedTypes = Object.values(domains)
			.map((d) => d.persistedAs)
			.filter((l): l is string => !!l);
		this.labels = persistedTypes.length > 0 ? persistedTypes : derivedMeta.types;
		if (derivedMeta.idFields) setIdFields(derivedMeta.idFields);
		this.requestUpdate();
	}

	executeQuery(): Promise<void> {
		const label = this.qLabel;
		const textQuery = this.qText;
		// The server rejects a query naming neither a type nor text; asking anyway fails identically on every
		// retrigger (each SSE batch fires one), flooding the server and the run log. Say why once instead.
		if (!label && !textQuery?.trim()) {
			this.error = "no record type or search text to query";
			this.results = [];
			this.total = 0;
			this.#source = arrayWindowedSource<VertexRow>([]);
			this.renderResults();
			return Promise.resolve();
		}
		const sortBy = this.qSort;
		const sortOrder = this.qOrder;

		const validConditions = this.qConditions
			.filter((c) => c.predicate && c.value)
			.map((c) => ({
				predicate: c.predicate,
				operator: c.operator,
				value: c.value,
				...(c.operator === "between" && c.value2 ? { value2: c.value2 } : {}),
			}));

		const queryKey = JSON.stringify({
			label,
			textQuery,
			conditions: validConditions,
			sortBy: sortBy || "",
			sortOrder,
			offset: this.qOffset,
			limit: this.limit,
		});
		// Coalesce concurrent identical fires (e.g. hashchange + initial connect).
		if (this.inflightPromise && this.lastQueryKey === queryKey) return this.inflightPromise;
		const resultsChanged = queryKey !== this.lastQueryKey;
		this.lastQueryKey = queryKey;

		if (label !== this.lastQueriedLabel) {
			// The node type changed: drop the previous type's rows now so they are never left
			// clickable while the new query is in flight — a stale-row click would open the wrong
			// entity (its id is a different type). The new rows render when `work` resolves.
			this.lastQueriedLabel = label;
			this.results = [];
			this.total = 0;
			this.#source = arrayWindowedSource<VertexRow>([]);
			this.renderResults();
		}

		this.error = "";
		const work = (async () => {
			try {
				const payload = {
					accessLevel: this.qAccess,
					label,
					filters: validConditions,
					textQuery: textQuery || undefined,
					sortBy: sortBy || "",
					sortOrder,
					limit: this.limit,
					offset: this.qOffset,
				};
				const data = await this.#query.run(payload);
				// Out-of-order guard: a newer query (e.g. a type switch) replaced our queryKey while this
				// RPC was in flight, so this response is stale. Ignore it — applying it would overwrite the
				// current type's rows with the previous type's, leaving the wrong type's rows clickable. The
				// current query renders its own response when it resolves.
				if (this.lastQueryKey !== queryKey) return;
				this.results = data.vertices ?? [];
				this.total = data.total ?? this.results.length;
				this.#buildSource(payload, this.results, this.qOffset);
				this.sortableFields = data.sort?.fields ?? [];
				// Reflect the server's resolved sort — including the per-type default the client didn't explicitly pick — so the result-table indicator highlights the active column.
				if (data.sort?.current?.field && !this.qSort) viewQuery.set({ sort: data.sort.current.field, order: data.sort.current.order });
				if (data.cypher) {
					const pane = this.closest("shu-column-pane");
					if (pane) pane.setAttribute("label", data.cypher);
				}
			} catch (err) {
				this.error = errorDetail(err);
			}
			this.renderResults();
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
	 * change with a fresh query is what made a view of the run's own records feed itself: the query is dispatched as a
	 * step, the step is recorded in the graph, and that recording is another change to answer, without end. Rows past
	 * the ones on screen are read when a reader reaches them, which is what the windowed source already does.
	 */
	private applyLiveQuads(events: Record<string, unknown>[]): void {
		if (!this.qLabel) return;
		const quads = extractQuadsFromEvents(events);
		let changed = false;
		for (const quad of quads) {
			if (quad.namedGraph !== this.qLabel) continue;
			const row = this.results.find((r) => String(r.id) === quad.subject);
			if (!row || row[quad.predicate] === quad.object) continue;
			row[quad.predicate] = quad.object;
			changed = true;
		}
		if (changed) this.renderResults();
	}

	private get resultsTarget(): HTMLElement | null {
		const selector = this.getAttribute("results-target");
		if (!selector) return null;
		return document.querySelector(selector);
	}

	/** Build the lazy row source for the current query: it fetches a page at a time via the same graphQuery the first
	 *  fetch used, primed with the page already in hand so the first paint needs no second round-trip. */
	#buildSource(payload: Record<string, unknown>, page0: readonly VertexRow[], startRow: number): void {
		const src = lazyWindowedSource<VertexRow>({
			count: () => this.total,
			fetch: (start, end) => this.#query.run({ ...payload, limit: end - start, offset: start }).then((d) => d.vertices ?? []),
			pageSize: this.limit,
		});
		src.prime(startRow, page0);
		this.#source = src;
	}

	render(): TemplateResult {
		return html``;
	}

	protected updated(): void {
		this.renderResults();
	}

	private resultTable: ShuResultTable | null = null;

	private ensureResultTable(target: HTMLElement): ShuResultTable {
		let pane = target.querySelector(".results-pane") as HTMLElement | null;
		if (!pane) {
			pane = document.createElement("div");
			pane.className = "results-pane";
			pane.dataset.testid = "shu-query";
			target.appendChild(pane);
		}

		if (!this.resultTable || !pane.contains(this.resultTable)) {
			// Create result table element
			const table = document.createElement("shu-result-table") as ShuResultTable;
			pane.innerHTML = "";
			pane.appendChild(table);
			this.resultTable = table;

			// Listen for result table events
			table.addEventListener(SHU_EVENT.SORT_CHANGE, ((e: CustomEvent) => {
				const { field, order } = e.detail;
				viewQuery.set({ sort: field || null, order, offset: 0 });
				void this.executeQuery();
			}) as EventListener);

			table.addEventListener(SHU_EVENT.ROW_CLICK, ((e: CustomEvent) => {
				const { individualId: vid, deselect, ctrlKey } = e.detail;
				if (deselect) {
					this.selectedIds.clear();
					this.dispatchContextChange();
					return;
				}
				if (!vid) return;

				if (ctrlKey) {
					if (this.selectedIds.has(vid)) {
						this.selectedIds.delete(vid);
					} else {
						this.selectedIds.add(vid);
					}
				} else if (this.selectedIds.has(vid) && this.selectedIds.size === 1) {
					this.selectedIds.clear();
				} else {
					this.selectedIds.clear();
					this.selectedIds.add(vid);
				}

				this.dispatchContextChange();

				if (this.selectedIds.size > 0) {
					// Dispatch from the result table (inside the query pane's results-target)
					// rather than from this controller (which lives outside the strip), so the
					// composed path traverses the query shu-column-pane. The Miller-column
					// pruning logic in app.ts then identifies the source pane via the natural
					// path with no special case.
					table.dispatchEvent(
						new CustomEvent(SHU_EVENT.COLUMN_OPEN, {
							detail: {
								subject: vid,
								label: this.qLabel || defaultLabel(),
								addToSelection: ctrlKey,
							},
							bubbles: true,
							composed: true,
						}),
					);
				}
			}) as EventListener);
		}

		return this.resultTable;
	}

	private renderResults(): void {
		const target = this.resultsTarget;
		if (!target) return;

		if (this.error) {
			target.innerHTML = `<div class="results-pane" data-testid="shu-query"><div class="error-banner">${esc(this.error)}</div></div>`;
			return;
		}

		const table = this.ensureResultTable(target);
		table.updateState({
			sortBy: this.qSort,
			sortOrder: this.qOrder,
			selectable: true,
			paginated: this.total > this.limit,
		});
		if (this.qLabel) table.persistedAs = this.qLabel;
		table.setSortableFields(this.sortableFields);
		if (this.#source !== this.#installedSource) {
			table.setSource(this.#source);
			this.#installedSource = this.#source;
		}
	}
}
