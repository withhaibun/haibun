import { defaultLabel } from "../util.js";
import { SHU_EVENT } from "../consts.js";
/**
 * <shu-graph-query> — Query component for the graph store.
 * Renders in light DOM .results-target, hash state, custom scrollbar, sort, multi-select.
 */
import { ShuElement } from "./shu-element.js";
import { QueryViewSchema, type TSearchCondition, parseFilterParam, serializeFilterParam } from "../schemas.js";
import { SHARED_STYLES } from "./styles.js";
import { esc, errMsg, setIdFields } from "../util.js";
import { setSiteMetadata, getConcernDerivedMetadata } from "../rels-cache.js";
import type { ShuResultTable } from "./shu-result-table.js";
import { SseClient } from "../sse-client.js";
import { getAvailableSteps, getAvailableDomains, findStep, requireStep } from "../rpc-registry.js";

type ConditionRow = TSearchCondition;

/** A vertex row: flat property object. */
type VertexRow = Record<string, unknown>;

export class ShuGraphQuery extends ShuElement<typeof QueryViewSchema> {
	static schema = QueryViewSchema;
	static domainSelector = "shu-graph-query";

	private conditions: ConditionRow[] = [];
	private results: VertexRow[] = [];
	private labels: string[] = [];
	private accessLevel = "private";
	private total = 0;
	private limit = 100;
	private offset = 0;
	private error = "";
	private lastQueryKey = "";
	private hashChangeHandler: (() => void) | null = null;
	private selectedIds = new Set<string>();

	static get observedAttributes(): string[] {
		return ["label", "sort-by", "sort-order", "results-target"];
	}

	constructor() {
		super(QueryViewSchema, { sortOrder: "desc" as const });
	}

	attributeChangedCallback(): void {
		if (!this.hasHash()) {
			this.syncFromAttributes();
		}
	}

	connectedCallback(): void {
		if (this.hasHash()) {
			this.syncHashState();
		} else {
			this.syncFromAttributes();
		}
		super.connectedCallback();
		this.hashChangeHandler = () => {
			this.syncHashState();
			void this.executeQuery();
		};
		window.addEventListener("hashchange", this.hashChangeHandler);
		void this.loadMetadata().then(() => this.executeQuery());
	}

	disconnectedCallback(): void {
		if (this.hashChangeHandler) {
			window.removeEventListener("hashchange", this.hashChangeHandler);
			this.hashChangeHandler = null;
		}
	}

	/** Apply filters from the actions bar and re-execute the query. */
	setFilters(filters: { accessLevel?: string; label?: string; textQuery?: string; conditions?: TSearchCondition[] }): void {
		if (filters.accessLevel !== undefined) this.accessLevel = filters.accessLevel;
		if (filters.label !== undefined) this.state = { ...this.state, label: filters.label || undefined };
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
		this.accessLevel = params.get("access") || "private";

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
		if (this.accessLevel !== "private") params.set("access", this.accessLevel);
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
			const client = SseClient.for("");
			const serverMeta = await client.rpc<import("../rels-cache.js").SiteMetadata>(step.method);
			Object.assign(derivedMeta, serverMeta);
		}
		setSiteMetadata(derivedMeta);
		const vertexLabels = Object.values(domains)
			.map((d) => d.vertexLabel)
			.filter((l): l is string => !!l);
		this.labels = vertexLabels.length > 0 ? vertexLabels : derivedMeta.types;
		if (derivedMeta.idFields) setIdFields(derivedMeta.idFields);
		this.render();
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
		});
		const resultsChanged = queryKey !== this.lastQueryKey;
		this.lastQueryKey = queryKey;

		this.error = "";
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
			const client = SseClient.for("");
			const method = requireStep("graphQuery");
			const data = await client.rpc<{
				vertices: VertexRow[];
				total: number;
				cypher: string;
			}>(method, {
				query: payload,
			});

			this.results = data.vertices ?? [];
			this.total = data.total ?? this.results.length;

			// Update column heading with the Cypher query
			if (data.cypher) {
				const pane = this.closest("shu-column-pane");
				if (pane) pane.setAttribute("label", data.cypher);
			}
		} catch (err) {
			this.error = errMsg(err);
		}
		this.pushHash();
		this.renderResults();
		if (resultsChanged) {
			this.selectedIds.clear();
			this.dispatchEvent(new CustomEvent(SHU_EVENT.RESULTS_CHANGED, { bubbles: true, composed: true }));
		}
		this.dispatchContextChange();
	}

	private get resultsTarget(): HTMLElement | null {
		const selector = this.getAttribute("results-target");
		if (!selector) return null;
		return document.querySelector(selector);
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		this.shadowRoot.innerHTML = `
			${this.css(SHARED_STYLES)}
			<style>${QUERY_STYLES}</style>
		`;
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
				const { vertexId: vid, deselect, ctrlKey } = e.detail;
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
					this.dispatchEvent(
						new CustomEvent(SHU_EVENT.COLUMN_OPEN, {
							detail: {
								subject: vid,
								label: this.state.label || defaultLabel(),
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
		if (this.state.label) table.vertexLabel = this.state.label;
		table.setResults(this.results);
		table.setPagination(this.total, this.limit, this.offset);
	}
}

const QUERY_STYLES = `
	:host { display: block; font-family: inherit; color: #222; }
`;
