/**
 * <shu-filter-column> — Query results column. Uses lit-html for the stable
 * structure (spinner, error banner, result table) and reactive `state` for
 * loading/error transitions. The contained `<shu-result-table>` keeps its
 * identity across updates via the `data-key` attribute so its inner DOM
 * survives.
 */
import { html, css, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { ref, createRef } from "lit/directives/ref.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { SHU_EVENT } from "../consts.js";
import { FilterColumnSchema } from "../schemas.js";
import { queryGraph, incomingEdges } from "../quads-snapshot.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { appAccessLevel, defaultLabel } from "../util.js";
import { getIdField, getQueryableFields } from "../rels-cache.js";
import type { ShuResultTable } from "./shu-result-table.js";
import { arrayWindowedSource, lazyWindowedSource, type WindowedSource } from "../windowed-source.js";

type VertexData = Record<string, unknown>;

export class ShuFilterColumn extends ShuElement<typeof FilterColumnSchema> {
	/** The query results, summarized by the embedded result table. */
	summarizeForKihan(): TLinkedData | null {
		return this.tableRef.value?.summarizeForKihan() ?? null;
	}

	static styles = [
		shuBaseStyles,
		css`
			:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
			.error-banner {
				padding: var(--shu-space-3) var(--shu-space-4);
				margin: var(--shu-space-2);
				background: var(--shu-bg-error-soft);
				border: var(--shu-border-w) solid var(--shu-error);
				color: var(--shu-error);
				border-radius: var(--shu-radius);
			}
		`,
	];

	@property({ attribute: false }) accessor results: VertexData[] = [];
	@property({ attribute: false }) accessor spinnerStatus = "Waiting...";
	#total = 0;
	#source: WindowedSource<VertexData> = arrayWindowedSource<VertexData>([]);
	#installedSource: WindowedSource<VertexData> | null = null;

	private tableRef = createRef<ShuResultTable>();

	constructor() {
		super(FilterColumnSchema, { loading: true });
	}

	async openFiltered(property: string, value: string, label: string = defaultLabel()): Promise<void> {
		// The idField is never a query filter (queryIndividuals rejects predicates not
		// in sortColumns). A filter request keyed on it is really an open-by-id, so
		// redirect to the entity column instead of issuing a doomed graphQuery.
		if (property === getIdField(label)) {
			this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_OPEN, { detail: { subject: value, label }, bubbles: true, composed: true }));
			return;
		}
		this.setState({ property, value, persistedAs: label, loading: true, error: undefined });
		this.spinnerStatus = "Fetching...";
		await this.fetchResults({
			label,
			filters: [{ predicate: property, operator: "eq", value }],
			sortBy: "",
			sortOrder: "desc",
			limit: 50,
			offset: 0,
			accessLevel: appAccessLevel(),
		});
	}

	async openProperty(property: string, label: string = defaultLabel()): Promise<void> {
		this.setState({ property, persistedAs: label, loading: true, error: undefined });
		this.spinnerStatus = "Fetching...";
		// Sort by the clicked property only when the topology declares it sortable; otherwise (the idField, or any field
		// not in sortColumns — e.g. a SeqPath's id) fall back to the default sort so browsing all of this type still works
		// instead of the store rejecting an undeclared sortBy.
		const sortBy = getQueryableFields(label).includes(property) ? property : "";
		await this.fetchResults({ label, filters: [], sortBy, sortOrder: "asc", limit: 50, offset: 0, accessLevel: appAccessLevel() });
	}

	async openIncoming(targetId: string, targetLabel: string): Promise<void> {
		this.setState({ persistedAs: targetLabel, property: "linksTo", value: targetId, loading: true, error: undefined });
		this.spinnerStatus = "Fetching...";
		await this.fetchIncoming(targetLabel, targetId, 50, 0);
	}

	private async fetchIncoming(label: string, id: string, limit: number, offset: number): Promise<void> {
		const res = await incomingEdges(label, id, { limit, offset }).catch((err) => {
			this.setState({ loading: false, error: errorDetail(err) });
			return undefined;
		});
		if (!res) return;
		const targets = res.edges.map((e) => e.target as VertexData);
		this.results = targets;
		this.#total = res.total ?? targets.length;
		const src = lazyWindowedSource<VertexData>({
			count: () => this.#total,
			fetch: async (start, end) => (await incomingEdges(label, id, { limit: end - start, offset: start })).edges.map((e) => e.target as VertexData),
			pageSize: limit,
		});
		src.prime(offset, targets);
		this.#source = src;
		this.setState({ loading: false });
	}

	private async fetchResults(query: Record<string, unknown>): Promise<void> {
		const res = await queryGraph(query).catch((err) => {
			this.setState({ loading: false, error: errorDetail(err) });
			return undefined;
		});
		if (!res) return;
		const vertices = (res.vertices ?? []) as VertexData[];
		this.results = vertices;
		this.#total = res.total ?? vertices.length;
		const pageSize = (query.limit as number) || 50;
		const src = lazyWindowedSource<VertexData>({
			count: () => this.#total,
			fetch: async (start, end) => ((await queryGraph({ ...query, limit: end - start, offset: start })).vertices ?? []) as VertexData[],
			pageSize,
		});
		src.prime((query.offset as number) || 0, vertices);
		this.#source = src;
		this.setState({ loading: false });
	}

	private onRowClick = (e: Event): void => {
		const { individualId: vid, label: rowLabel, ctrlKey } = (e as CustomEvent).detail;
		if (!vid) return;
		this.dispatchEvent(
			new CustomEvent(SHU_EVENT.COLUMN_OPEN, {
				detail: { subject: vid, label: rowLabel || this.state.persistedAs || defaultLabel(), addToSelection: ctrlKey },
				bubbles: true,
				composed: true,
			}),
		);
	};

	private onSortChange = (e: Event): void => {
		const { field, order } = (e as CustomEvent).detail;
		this.tableRef.value?.updateState({ sortBy: field, sortOrder: order });
	};

	protected updated(): void {
		const table = this.tableRef.value;
		if (!table || this.state.loading || this.state.error) return;
		table.updateState({ displayMode: "full", fixedProperty: this.state.property });
		if (this.state.persistedAs) table.persistedAs = this.state.persistedAs;
		if (this.#source !== this.#installedSource) {
			table.setSource(this.#source);
			this.#installedSource = this.#source;
		}
	}

	render(): TemplateResult {
		const { loading, error } = this.state;
		return html`
			${loading ? html`<shu-spinner .status=${this.spinnerStatus} .visible=${true}></shu-spinner>` : ""}
			${error ? html`<div class="error-banner">${error}</div>` : ""}
			<shu-result-table ${ref(this.tableRef)} style=${loading || error ? "display:none" : "flex:1"} @row-click=${this.onRowClick} @sort-change=${this.onSortChange}></shu-result-table>
		`;
	}
}
