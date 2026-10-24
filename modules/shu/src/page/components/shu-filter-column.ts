/**
 * <shu-filter-column>: Query results column. Uses lit-html for the stable
 * structure (spinner, error banner, result table) and reactive `state` for
 * loading/error transitions. The contained `<shu-result-table>` keeps its
 * identity across updates via the `data-key` attribute so its inner DOM
 * survives.
 */
import { SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { html, css, nothing, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { ref, createRef } from "lit/directives/ref.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { openRef, paneHref } from "./ref-navigation.js";
import type { DesiredPane } from "../derivations/pane-kinds.js";
import { REF_DENOTES } from "@haibun/core/lib/domains/typed-links.js";
import { FilterColumnSchema } from "../../domains/schemas.js";
import { aType, type TContextPattern } from "@haibun/core/lib/conversation/domains/conversation.js";
import { getIdField, getQueryableFields, firstDeclaredType } from "../controllers/catalog-controller.js";
import type { ShuResultTable } from "./shu-result-table.js";
import { readWindowedSource, unmarked, type WindowedSource } from "../derivations/windowed-source.js";
import { CountedSchema } from "@haibun/core/lib/domains/hypermedia.js";
import { appAccessLevel } from "../controllers/view-query-controller.js";
import { queryGraph, queryRead, incomingEdges, incomingRead } from "../controllers/read-controller.js";
import { LoadController } from "../controllers/load-controller.js";
import type { TCallOutcome } from "../pipelines/call-step.js";
import { refusalTpl } from "./load-renders.js";
import "./shu-spinner.js";
import "./shu-result-table.js";

/** A graph query a filter column reads: its window is stated, so each later window reads from it. */
type TFilterQuery = Record<string, unknown> & { limit: number; offset: number };

type VertexData = Record<string, unknown>;

export class ShuFilterColumn extends ShuElement<typeof FilterColumnSchema> {
	/** The query results, summarized by the embedded result table. */
	summarizeForContext(): TLinkedData | null {
		return this.tableRef.value?.summarizeForContext() ?? null;
	}

	static styles = [
		shuBaseStyles,
		css`
			:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
		`,
	];

	@property({ attribute: false }) accessor spinnerStatus = "Waiting...";
	/** The read the column opened at: its rows, as a windowed source that reads each later window. */
	#readPage: () => Promise<TCallOutcome<WindowedSource<VertexData>>> = () => Promise.resolve({ ok: false, refusal: { error: "the column isn't opened at a filter" } });
	readonly #page = new LoadController<WindowedSource<VertexData>>(this, () => this.#readPage());
	/** The table and the source the column last gave it: the table draws again at each read, so a new table takes the source too. */
	#installed: { table: ShuResultTable; source: WindowedSource<VertexData> } | undefined = undefined;

	private tableRef = createRef<ShuResultTable>();

	constructor() {
		super(FilterColumnSchema, {});
	}

	async openFiltered(property: string, value: string, label: string = firstDeclaredType()): Promise<void> {
		// A read refuses a filter on the id field, which isn't in the type's filter surface. A filter on the id names one
		// record, so the column opens that record in the entity column and doesn't run a graph query.
		if (property === getIdField(label)) {
			openRef(this, REF_DENOTES.individual, { persistedAs: label, id: value });
			return;
		}
		this.setState({ property, value, persistedAs: label, incoming: undefined });
		this.spinnerStatus = "Fetching...";
		await this.fetchResults({ label, filters: [{ predicate: property, operator: "eq", value }], sortOrder: "desc", limit: 50, offset: 0, accessLevel: appAccessLevel() });
	}

	async openProperty(property: string, label: string = firstDeclaredType()): Promise<void> {
		this.setState({ property, value: undefined, persistedAs: label, incoming: undefined });
		this.spinnerStatus = "Fetching...";
		// Sort by the clicked property only when the topology declares it sortable; otherwise (the idField, or any field
		// not in sortColumns, e.g. a SeqPath's id) fall back to the default sort so browsing all of this type still works
		// instead of the store rejecting an undeclared sortBy.
		const sorted = getQueryableFields(label).includes(property) ? { sortBy: property } : {};
		await this.fetchResults({ label, filters: [], ...sorted, sortOrder: "asc", limit: 50, offset: 0, accessLevel: appAccessLevel() });
	}

	async openIncoming(targetId: string, targetLabel: string): Promise<void> {
		this.setState({ persistedAs: targetLabel, property: undefined, value: undefined, incoming: targetId });
		this.spinnerStatus = "Fetching...";
		await this.fetchIncoming(targetLabel, targetId, 50, 0);
	}

	/** Reads the records whose edges reach `id`, a window of `limit` from `offset`, and each later window as the table reaches it. */
	private async fetchIncoming(label: string, id: string, limit: number, offset: number): Promise<void> {
		this.#readPage = async () => {
			const read = await incomingRead(label, id, { limit, offset });
			if (!read.ok) return read;
			const targets = read.value.edges.map((e) => e.target as VertexData);
			const source = readWindowedSource<VertexData>({
				size: limit,
				read: async (start, end) => {
					const page = await incomingEdges(label, id, { limit: end - start, offset: start });
					return { vertices: page.edges.map((e) => e.target), total: page.total, saturated: page.saturated };
				},
				held: { vertices: targets, ...CountedSchema.parse(read.value) },
				from: offset,
				markers: unmarked,
			});
			return { ok: true, value: source };
		};
		await this.#page.run();
	}

	/** Reads the rows `query` names, and each later window as the table reaches it. */
	private async fetchResults(query: TFilterQuery): Promise<void> {
		this.#readPage = async () => {
			const read = await queryRead(query);
			if (!read.ok) return read;
			const source = readWindowedSource<VertexData>({
				size: query.limit,
				read: (start, end) => queryGraph({ ...query, limit: end - start, offset: start }),
				held: { vertices: read.value.vertices, ...CountedSchema.parse(read.value) },
				from: query.offset,
				markers: unmarked,
			});
			return { ok: true, value: source };
		};
		await this.#page.run();
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
		const source = this.#page.page;
		if (!table || source === undefined) return;
		table.updateState({ displayMode: "full", fixedProperty: this.state.property });
		if (this.state.persistedAs) table.persistedAs = this.state.persistedAs;
		table.collection = paneHref(this.#listing());
		if (this.#installed?.table !== table || this.#installed.source !== source) {
			table.setSource(source);
			this.#installed = { table, source };
		}
	}

	/** The pane the column's listing is: the records whose edges reach a record, or whose property holds a value or is stated. */
	#listing(): DesiredPane {
		const { persistedAs, property, value, incoming } = this.state;
		if (persistedAs === undefined) throw new Error("<shu-filter-column> lists records before it is opened at a type");
		if (incoming !== undefined) return { paneType: "filter-incoming", persistedAs, subject: incoming };
		if (property === undefined) throw new Error(`<shu-filter-column> lists ${persistedAs} without a property or a record its edges reach`);
		return value === undefined ? { paneType: "filter-prop", persistedAs, predicate: property } : { paneType: "filter-eq", persistedAs, predicate: property, value };
	}

	/** A filtered list shows records of one type, so an ask or a graph from here is about that type. */
	override paneSubject(): TContextPattern[] | null {
		return this.state.persistedAs ? [aType(this.state.persistedAs, [])] : null;
	}

	render(): TemplateResult {
		const shown = this.#page.completed;
		const loading = html`<shu-spinner .status=${this.spinnerStatus} .visible=${true}></shu-spinner>`;
		return html`
			${this.#page.render<TemplateResult | typeof nothing>({
				pending: () => loading,
				running: () => loading,
				completed: () => nothing,
				failed: (refusal) => refusalTpl(refusal, this.#page),
			})}
			${shown ? html`<shu-result-table ${ref(this.tableRef)} style="flex:1" @row-click=${this.onRowClick} @sort-change=${this.onSortChange}></shu-result-table>` : nothing}
		`;
	}
}

defineElement(SHU_TAG.FILTER_COLUMN, ShuFilterColumn);
