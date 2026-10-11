/**
 * <shu-filter-column>: Query results column. Uses lit-html for the stable
 * structure (spinner, error banner, result table) and reactive `state` for
 * loading/error transitions. The contained `<shu-result-table>` keeps its
 * identity across updates via the `data-key` attribute so its inner DOM
 * survives.
 */
import { SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { html, css, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { ref, createRef } from "lit/directives/ref.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { openRef } from "./ref-navigation.js";
import { REF_DENOTES } from "@haibun/core/lib/typed-links.js";
import { FilterColumnSchema, aType, type TContextPattern } from "../../schemas.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { getIdField, getQueryableFields, firstDeclaredType } from "../controllers/catalog-controller.js";
import type { ShuResultTable } from "./shu-result-table.js";
import { arrayWindowedSource, readWindowedSource, type WindowedSource } from "../../windowed-source.js";
import { CountedSchema, counted, type TCounted } from "@haibun/core/lib/hypermedia.js";
import { appAccessLevel } from "../../view-query.js";
import { queryGraph, incomingEdges } from "../controllers/read-controller.js";

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
	#counted: TCounted = counted(0);
	#source: WindowedSource<VertexData> = arrayWindowedSource<VertexData>([]);
	#installedSource: WindowedSource<VertexData> | null = null;

	private tableRef = createRef<ShuResultTable>();

	constructor() {
		super(FilterColumnSchema, { loading: true });
	}

	async openFiltered(property: string, value: string, label: string = firstDeclaredType()): Promise<void> {
		// A read refuses a filter on the id field, which isn't in the type's filter surface. A filter on the id names one
		// record, so the column opens that record in the entity column and doesn't run a graph query.
		if (property === getIdField(label)) {
			openRef(this, REF_DENOTES.individual, { persistedAs: label, id: value });
			return;
		}
		this.setState({ property, value, persistedAs: label, loading: true, error: undefined });
		this.spinnerStatus = "Fetching...";
		await this.fetchResults({ label, filters: [{ predicate: property, operator: "eq", value }], sortOrder: "desc", limit: 50, offset: 0, accessLevel: appAccessLevel() });
	}

	async openProperty(property: string, label: string = firstDeclaredType()): Promise<void> {
		this.setState({ property, persistedAs: label, loading: true, error: undefined });
		this.spinnerStatus = "Fetching...";
		// Sort by the clicked property only when the topology declares it sortable; otherwise (the idField, or any field
		// not in sortColumns, e.g. a SeqPath's id) fall back to the default sort so browsing all of this type still works
		// instead of the store rejecting an undeclared sortBy.
		const sorted = getQueryableFields(label).includes(property) ? { sortBy: property } : {};
		await this.fetchResults({ label, filters: [], ...sorted, sortOrder: "asc", limit: 50, offset: 0, accessLevel: appAccessLevel() });
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
		this.#counted = CountedSchema.parse(res);
		this.#source = readWindowedSource<VertexData>({
			size: limit,
			read: async (start, end) => {
				const page = await incomingEdges(label, id, { limit: end - start, offset: start });
				return { vertices: page.edges.map((e) => e.target), total: page.total, saturated: page.saturated };
			},
			held: { vertices: targets, ...this.#counted },
			from: offset,
		});
		this.setState({ loading: false });
	}

	private async fetchResults(query: Record<string, unknown>): Promise<void> {
		const res = await queryGraph(query).catch((err) => {
			this.setState({ loading: false, error: errorDetail(err) });
			return undefined;
		});
		if (!res) return;
		const vertices = res.vertices;
		this.results = vertices;
		this.#counted = CountedSchema.parse(res);
		this.#source = readWindowedSource<VertexData>({
			size: (query.limit as number) || 50,
			read: (start, end) => queryGraph({ ...query, limit: end - start, offset: start }),
			held: { vertices, ...this.#counted },
			from: (query.offset as number) || 0,
		});
		this.setState({ loading: false });
	}

	private onRowClick = (e: Event): void => {
		const { individualId: vid, label: rowLabel, ctrlKey } = (e as CustomEvent).detail;
		if (vid) openRef(e, REF_DENOTES.individual, { persistedAs: rowLabel || this.state.persistedAs || firstDeclaredType(), id: vid }, ctrlKey);
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

	/** A filtered list shows records of one type, so an ask or a graph from here is about that type. */
	override paneSubject(): TContextPattern[] | null {
		return this.state.persistedAs ? [aType(this.state.persistedAs)] : null;
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

defineElement(SHU_TAG.FILTER_COLUMN, ShuFilterColumn);
