import { defaultLabel } from "./util.js";
/**
 * <shu-graph-query> — Query component for the graph store.
 * Faithful translation of shu-query.ts using graph vertices instead of quads.
 * Renders in light DOM .results-target, hash state, custom scrollbar, sort, multi-select.
 */
import { ShuElement } from "./shu-element.js";
import { QueryViewSchema } from "./schemas.js";
import { SHARED_STYLES } from "./styles.js";
import { esc, errMsg, setIdFields } from "./util.js";
import { setSiteMetadata } from "./rels-cache.js";
import type { ShuResultTable } from "./shu-result-table.js";
import { SseClient } from "./sse-client.js";
import { getAvailableSteps, getAvailableDomains, requireStep, getVertexLabelDomainKey } from "./rpc-registry.js";

interface ConditionRow {
	property: string;
	operator: string;
	value: string;
	value2: string;
}

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
	setFilters(filters: {
		accessLevel?: string;
		label?: string;
		textQuery?: string;
		conditions?: Array<{ property: string; operator: string; value: string; value2?: string }>;
	}): void {
		if (filters.accessLevel !== undefined) this.accessLevel = filters.accessLevel;
		if (filters.label !== undefined) this.state = { ...this.state, label: filters.label || undefined };
		if (filters.textQuery !== undefined) this.state = { ...this.state, textQuery: filters.textQuery || undefined };
		if (filters.conditions) this.conditions = filters.conditions.map((c) => ({ ...c, value2: c.value2 || "" }));
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
			new CustomEvent("context-change", {
				detail: {
					patterns,
					accessLevel: this.accessLevel,
					total: this.total,
					label: this.state.label,
					textQuery: this.state.textQuery,
					labels: this.labels,
					conditions: this.conditions.filter((c) => c.property && c.value),
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
			if (c.property && c.value) {
				patterns.push({ p: c.property, o: c.value });
			}
		}
		if (patterns.length === 0) patterns.push({});
		return patterns;
	}

	private hasHash(): boolean {
		const h = location.hash;
		return h.length > 1 && h.startsWith("#?");
	}

	private syncHashState(): void {
		const h = location.hash;
		if (!h || h.length <= 2) return;
		const params = new URLSearchParams(h.slice(2));

		const label = params.get("label") || undefined;
		const textQuery = params.get("q") || undefined;
		const sortBy = params.get("sort") || undefined;
		const sortOrder = (params.get("order") || "desc") as "asc" | "desc";
		const offsetStr = params.get("offset");
		this.accessLevel = params.get("access") || "private";

		if (offsetStr) this.offset = parseInt(offsetStr, 10) || 0;

		// Filter conditions use | delimiter to avoid conflict with colons in property names
		this.conditions = params.getAll("f").map((f) => {
			const parts = f.split("|");
			return { property: parts[0] || "", operator: parts[1] || "eq", value: parts[2] || "", value2: parts[3] || "" };
		});

		const result = this.safeValidate({ label, textQuery, sortBy, sortOrder });
		if (result.success && result.data) this.state = result.data;
	}

	private pushHash(): void {
		const { label, textQuery, sortBy, sortOrder } = this.state;

		// Preserve existing col params (managed by app.ts via columns-changed events)
		const existing = location.hash.startsWith("#?") ? new URLSearchParams(location.hash.slice(2)) : new URLSearchParams();
		const colValues = existing.getAll("col");

		const params = new URLSearchParams();
		if (label) params.set("label", label);
		if (this.accessLevel !== "private") params.set("access", this.accessLevel);
		if (textQuery) params.set("q", textQuery);
		if (sortBy) params.set("sort", sortBy);
		if (sortOrder) params.set("order", sortOrder);
		params.set("offset", String(this.offset));

		for (const c of this.conditions) {
			if (c.property && c.value) {
				const parts = [c.property, c.operator, c.value];
				if (c.operator === "between" && c.value2) parts.push(c.value2);
				params.append("f", parts.join("|"));
			}
		}

		for (const col of colValues) {
			params.append("col", col);
		}

		const newHash = `#?${params.toString()}`;
		if (location.hash !== newHash) {
			history.replaceState(null, "", newHash);
		}
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
		const client = SseClient.for("");
		try {
			await getAvailableSteps();
			const [meta, domains] = await Promise.all([
				client.rpc<import("./rels-cache.js").SiteMetadata>(requireStep("getSiteMetadata")),
				getAvailableDomains(),
			]);
			setSiteMetadata(meta);
			// Prefer domain-driven labels (from step.list getConcerns), fall back to getSiteMetadata
			const vlk = getVertexLabelDomainKey();
			const domainLabels = vlk ? domains[vlk]?.values : undefined;
			this.labels = domainLabels ?? meta.types ?? this.labels;
			if (meta.idFields) setIdFields(meta.idFields);
			this.render();
		} catch {
			/* use defaults */
		}
	}

	async executeQuery(): Promise<void> {
		await getAvailableSteps();
		const { label, textQuery, sortBy, sortOrder } = this.state;

		const validConditions = this.conditions
			.filter((c) => c.property && c.value)
			.map((c) => ({
				property: c.property,
				operator: c.operator,
				value: c.value,
				...(c.operator === "between" && c.value2 ? { value2: c.value2 } : {}),
			}));

		const queryKey = JSON.stringify({ label, textQuery, conditions: validConditions });
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
			const data = await client.rpc<{ vertices: VertexRow[]; total: number; cypher: string }>(requireStep("graphQuery"), {
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
			const msg = errMsg(err);
			console.error("[shu] query failed:", msg);
			this.error = msg;
		}
		this.pushHash();
		this.renderResults();
		if (resultsChanged) {
			this.selectedIds.clear();
			this.dispatchEvent(new CustomEvent("results-changed", { bubbles: true, composed: true }));
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
			table.addEventListener("sort-change", ((e: CustomEvent) => {
				const { field, order } = e.detail;
				this.state = { ...this.state, sortBy: field, sortOrder: order };
				this.offset = 0;
				void this.executeQuery();
			}) as EventListener);

			table.addEventListener("page-change", ((e: CustomEvent) => {
				this.offset = e.detail.offset;
				void this.executeQuery();
			}) as EventListener);

			table.addEventListener("row-click", ((e: CustomEvent) => {
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
						new CustomEvent("column-open", {
							detail: { subject: vid, label: this.state.label || defaultLabel() },
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
		table.updateState({ sortBy, sortOrder, selectable: true, paginated: this.total > this.limit });
		table.setResults(this.results);
		table.setPagination(this.total, this.limit, this.offset);
	}
}

const QUERY_STYLES = `
	:host { display: block; font-family: inherit; color: #222; }
`;
