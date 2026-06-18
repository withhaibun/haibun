import { html, css, type TemplateResult } from "lit";
import { defaultLabel } from "../util.js";
import { SHU_EVENT } from "../consts.js";
/**
 * <shu-graph-query> — Query component for the graph store.
 * Renders in light DOM .results-target, hash state, custom scrollbar, sort, multi-select.
 */
import { ShuElement } from "./shu-element.js";
import { QueryViewSchema, type TSearchCondition, parseFilterParam, serializeFilterParam } from "../schemas.js";
import { Access } from "@haibun/core/lib/resources.js";
import { shuBaseStyles } from "./styles.js";
import { esc, errMsg, setIdFields } from "../util.js";
import { setSiteMetadata, getConcernDerivedMetadata } from "../rels-cache.js";
import type { ShuResultTable } from "./shu-result-table.js";
import { conduit, isOffline } from "../hypermedia.js";
import { getAvailableSteps, getAvailableDomains, findStep, requireStep } from "../rpc-registry.js";
import { extractQuadsFromEvents } from "@haibun/core/lib/quad-types.js";

type ConditionRow = TSearchCondition;

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
	static domainSelector = "shu-graph-query";

	private conditions: ConditionRow[] = [];
	private results: VertexRow[] = [];
	private sortableFields: string[] = [];
	private labels: string[] = [];
	private accessLevel: string = Access.private;
	private total = 0;
	private limit = 100;
	private offset = 0;
	private error = "";
	private lastQueryKey = "";
	/** In-flight promise — coalesces concurrent identical `executeQuery` calls. The key is `lastQueryKey` (set immediately after the dedup check). */
	private inflightPromise: Promise<void> | null = null;
	private selectedIds = new Set<string>();

	static observedHtmlAttributes = ["label", "sort-by", "sort-order", "results-target"];

	constructor() {
		super(QueryViewSchema, { sortOrder: "desc" as const });
	}

	protected override onAttributeChanged(name: string, _old: string | null, _val: string | null): void {
		if (!this.hasHash()) {
			this.syncFromAttributes();
		}
	}

	protected override onConnected(): void {
		if (this.hasHash()) {
			this.syncHashState();
		} else {
			this.syncFromAttributes();
		}
		this.autoListen(window, "hashchange", () => {
			this.syncHashState();
			void this.executeQuery();
		});
		void this.loadMetadata().then(() => this.executeQuery());

		if (!isOffline()) {
			this.autoTeardown(
				this.subscribeBatched({
					onBatch: (events) => {
						const quads = extractQuadsFromEvents(events);
						if (quads.length === 0) return;
						const label = this.state.label;
						const relevant = !label || quads.some((q) => q.namedGraph === label);
						if (relevant) void this.executeQuery();
					},
				}),
			);
		}
	}

	/** Apply filters from the actions bar and re-execute the query. */
	setFilters(filters: { accessLevel?: string; label?: string; textQuery?: string; conditions?: TSearchCondition[] }): void {
		if (filters.accessLevel !== undefined) this.accessLevel = filters.accessLevel;
		if (filters.label !== undefined) {
			const nextLabel = filters.label || undefined;
			// Sort columns are label-specific — the server rejects a sortBy not in the new label's topology.sortColumns
			// — so switching type drops any sort carried over from the previous type (the new label sorts by its default).
			this.state = nextLabel !== this.state.label ? { ...this.state, label: nextLabel, sortBy: undefined } : { ...this.state, label: nextLabel };
		}
		if (filters.textQuery !== undefined) this.state = { ...this.state, textQuery: filters.textQuery || undefined };
		if (filters.conditions) this.conditions = filters.conditions;
		this.offset = 0;
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
					accessLevel: this.accessLevel,
					total: this.total,
					label: this.state.label,
					textQuery: this.state.textQuery,
					labels: this.labels,
					conditions: this.conditions.filter((c) => c.predicate && c.value),
				},
				bubbles: true,
				composed: true,
			}),
		);
	}

	private buildQueryContextPatterns(): Array<{ s?: string; p?: string; o?: string }> {
		const patterns: Array<{ s?: string; p?: string; o?: string }> = [];
		const { label } = this.state;
		if (label) patterns.push({ p: "label", o: label });
		for (const c of this.conditions) {
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

	private syncHashState(): void {
		const h = ShuElement.getHash();
		if (!h || h.length <= 2) return;
		const params = new URLSearchParams(h.slice(2));

		const label = params.get("label") || undefined;
		const textQuery = params.get("q") || undefined;
		const sortBy = params.get("sort") || undefined;
		const sortOrder = (params.get("order") || "desc") as "asc" | "desc";
		const offsetStr = params.get("offset");
		this.accessLevel = params.get("access") || Access.private;

		if (offsetStr) this.offset = parseInt(offsetStr, 10) || 0;

		this.conditions = params.getAll("f").map(parseFilterParam);

		const result = this.safeValidate({ label, textQuery, sortBy, sortOrder });
		if (result.success && result.data) this.state = result.data;
	}

	private pushHash(): void {
		const { label, textQuery, sortBy, sortOrder } = this.state;

		// Preserve existing col params (managed by app.ts via columns-changed events)
		const currentHash = ShuElement.getHash();
		const existing = currentHash.startsWith("#?") ? new URLSearchParams(currentHash.slice(2)) : new URLSearchParams();
		const colValues = existing.getAll("col");

		const params = new URLSearchParams();
		if (label) params.set("label", label);
		if (this.accessLevel !== Access.private) params.set("access", this.accessLevel);
		if (textQuery) params.set("q", textQuery);
		if (sortBy) params.set("sort", sortBy);
		if (sortOrder) params.set("order", sortOrder);
		params.set("offset", String(this.offset));

		for (const c of this.conditions) {
			if (c.predicate && c.value) params.append("f", serializeFilterParam(c));
		}

		for (const col of colValues) {
			params.append("col", col);
		}

		const newHash = `#?${params.toString()}`;
		ShuElement.pushHash(newHash);
	}

	private syncFromAttributes(): void {
		const label = this.getAttribute("label") || undefined;
		const textQuery = this.getAttribute("text-query") || undefined;
		const sortBy = this.getAttribute("sort-by") || undefined;
		const sortOrder = (this.getAttribute("sort-order") || "desc") as "asc" | "desc";
		const result = this.safeValidate({ label, textQuery, sortBy, sortOrder });
		if (result.success && result.data) {
			this.state = result.data;
		}
	}

	async loadMetadata(): Promise<void> {
		await getAvailableSteps();
		const domains = await getAvailableDomains();
		const derivedMeta = getConcernDerivedMetadata();
		const step = findStep("getSiteMetadata");
		if (step) {
			const serverMeta = await conduit().follow<import("../rels-cache.js").SiteMetadata>({ method: step.method }, "graph-query: load site metadata");
			Object.assign(derivedMeta, serverMeta);
		}
		setSiteMetadata(derivedMeta);
		const persistedTypes = Object.values(domains)
			.map((d) => d.persistedAs)
			.filter((l): l is string => !!l);
		this.labels = persistedTypes.length > 0 ? persistedTypes : derivedMeta.types;
		if (derivedMeta.idFields) setIdFields(derivedMeta.idFields);
		this.requestUpdate();
	}

	async executeQuery(): Promise<void> {
		await getAvailableSteps();
		const { label, textQuery, sortBy, sortOrder } = this.state;

		const validConditions = this.conditions
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
			offset: this.offset,
			limit: this.limit,
		});
		// Coalesce concurrent identical fires (e.g. hashchange + initial connect).
		if (this.inflightPromise && this.lastQueryKey === queryKey) return this.inflightPromise;
		const resultsChanged = queryKey !== this.lastQueryKey;
		this.lastQueryKey = queryKey;

		this.error = "";
		const work = (async () => {
			try {
				const payload = {
					accessLevel: this.accessLevel,
					label,
					filters: validConditions,
					textQuery: textQuery || undefined,
					sortBy: sortBy || "",
					sortOrder,
					limit: this.limit,
					offset: this.offset,
				};
				const method = requireStep("graphQuery");
				const data = await conduit().follow<{
					vertices: VertexRow[];
					total: number;
					cypher: string;
					sort?: { fields: string[]; orders: ("asc" | "desc")[]; current: { field?: string; order: "asc" | "desc" } };
				}>({ method, params: { query: payload } }, `graph-query: ${label || "(any)"}${textQuery ? ` "${textQuery}"` : ""}`);
				this.results = data.vertices ?? [];
				this.total = data.total ?? this.results.length;
				this.sortableFields = data.sort?.fields ?? [];
				// Reflect the server's resolved sort — including the per-type default the client didn't explicitly pick — so the result-table indicator highlights the active column.
				if (data.sort?.current?.field && !this.state.sortBy) this.state = { ...this.state, sortBy: data.sort.current.field, sortOrder: data.sort.current.order };
				if (data.cypher) {
					const pane = this.closest("shu-column-pane");
					if (pane) pane.setAttribute("label", data.cypher);
				}
			} catch (err) {
				this.error = errMsg(err);
			}
			this.pushHash();
			this.renderResults();
			if (resultsChanged) this.selectedIds.clear(); // a fresh result set invalidates the row selection
			this.dispatchContextChange();
		})();
		this.inflightPromise = work.finally(() => {
			this.inflightPromise = null;
		});
		return this.inflightPromise;
	}

	private get resultsTarget(): HTMLElement | null {
		const selector = this.getAttribute("results-target");
		if (!selector) return null;
		return document.querySelector(selector);
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
				this.state = { ...this.state, sortBy: field, sortOrder: order };
				this.offset = 0;
				void this.executeQuery();
			}) as EventListener);

			table.addEventListener(SHU_EVENT.PAGE_CHANGE, ((e: CustomEvent) => {
				this.offset = e.detail.offset;
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
								label: this.state.label || defaultLabel(),
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
		const { sortBy, sortOrder } = this.state;
		table.updateState({
			sortBy,
			sortOrder,
			selectable: true,
			paginated: this.total > this.limit,
		});
		if (this.state.label) table.persistedAs = this.state.label;
		table.setSortableFields(this.sortableFields);
		table.setResults(this.results);
		table.setPagination(this.total, this.limit, this.offset);
	}
}
