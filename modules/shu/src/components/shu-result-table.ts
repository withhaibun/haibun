/**
 * <shu-result-table> — the shared sortable, clickable individual table for the main query pane and filter columns. It
 * renders a fixed header row plus a virtualized body: the rows live in a WindowedSource and are painted through
 * <shu-virtual-column>, so a result set of millions renders only the rows in view (with the custom glyph scrollbar for
 * position and jump), never a full DOM table. The parent owns the RPC and the source; this element owns the header,
 * sort indicators, row selection, group headers, and time dimming, all derived declaratively from the source and state
 * (no imperative DOM mutation, so a re-render never accumulates listeners or drops classes).
 *
 * Callers give it data one of two ways: `setResults(rows)` for an already-resident set (a text search's match page), or
 * `setSource(source)` for a paged/lazy set fetched a window at a time. Both drive the same render.
 *
 * Events dispatched:
 *   row-click: { individualId, label, ctrlKey } — or { individualId: null, deselect: true } on an empty-area click
 *   sort-change: { field, order }
 */
import { html, css, type TemplateResult } from "lit";
import { shuBaseStyles } from "./styles.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { z } from "zod";
import { ResultTableSchema } from "../schemas.js";
import { truncate, formatDate, isDateValue, idOf, persistedTypeOf, isVisibleKey } from "../util.js";
import { getRelSync, getPropertyOrder } from "../rels-cache.js";
import { TIME_SYNC_CLASS } from "./shu-element.js";
import "./shu-virtual-column.js";
import { virtualColumnCss } from "./shu-virtual-column.js";
import { arrayWindowedSource, type WindowedSource } from "../windowed-source.js";

type VertexRow = Record<string, unknown>;

export class ShuResultTable extends ShuElement<typeof ResultTableSchema> {
	static styles = [
		shuBaseStyles,
		virtualColumnCss,
		css`
			:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; position: relative; }
			.results-wrapper { display: flex; flex: 1; min-height: 0; }
			.results-area { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
			/* Header and every row share one grid template (one track per visible column) so columns line up; the header
			   reserves the scrollbar's width on the right so its tracks match the virtualized rows' width. */
			.grid-header, .clickable-row { display: grid; grid-template-columns: var(--result-cols, 1fr); align-items: center; }
			.grid-header { margin-right: var(--shu-scrollbar-w); background: var(--shu-bg-soft); flex-shrink: 0; }
			.grid-header > .th {
				padding: 3px var(--shu-space-3); font-weight: 500; color: var(--shu-fg-muted); font-size: 0.85em; letter-spacing: 0.3px;
				cursor: default; user-select: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
			}
			.grid-header > .th.sortable { cursor: pointer; }
			.grid-header > .th.sortable:hover { color: var(--shu-fg); background: var(--shu-bg-input); }
			.grid-header > .th.sorted { font-weight: 700; color: var(--shu-fg); }
			.clickable-row { cursor: pointer; }
			.clickable-row > .td { padding: 1px var(--shu-space-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
			.clickable-row:hover { background: var(--shu-bg-hover); }
			.clickable-row.selected { background: var(--shu-bg-info-soft); }
			.group-header {
				grid-column: 1 / -1; background: var(--shu-bg-input); color: var(--shu-fg-muted); font-size: 0.75em; font-weight: 600;
				letter-spacing: 0.5px; padding: var(--shu-space-2) var(--shu-space-3);
			}
			.result-total {
				position: absolute; bottom: var(--shu-space-1); right: var(--shu-space-2);
				font-size: var(--shu-font-md); color: var(--shu-fg-muted); pointer-events: none; font-weight: 500;
			}
		`,
	];

	/** The rows this table shows, as an `as:Collection` (best-effort: the resident window when the set is paged). Usually reached through the query view's summary; standalone tables answer for themselves. */
	summarizeForKihan(): TLinkedData | null {
		const n = this.#source.count();
		if (n === 0) return null;
		return {
			"@id": "view:result-table",
			"@type": "as:Collection",
			...(this.persistedAs ? { queryType: this.persistedAs } : {}),
			totalItems: n,
			items: this.#residentSample(500),
		};
	}

	private allProperties: string[] = [];
	private sortableFields: ReadonlySet<string> = new Set();
	persistedAs = "";
	private selectedIds = new Set<string>();
	#multiType = false;
	#residentSource = arrayWindowedSource<VertexRow>([]);
	#source: WindowedSource<VertexRow> = this.#residentSource;
	#unsub: (() => void) | null = null;

	constructor() {
		super(ResultTableSchema, { sortOrder: "desc", selectable: true, displayMode: "full", total: 0, limit: 100, offset: 0, paginated: false });
		this.#subscribe();
	}

	protected override onTimeSync(): void {
		this.requestUpdate(); // renderRow recomputes each row's future-dimming class
	}

	protected override onDisconnected(): void {
		this.#unsub?.();
		this.#unsub = null;
	}

	/** Public state update — allows parent components to configure sort, display mode, etc. */
	updateState(partial: Partial<z.infer<typeof ResultTableSchema>>): void {
		this.setState(partial);
	}

	/** Set the server-advertised sortable surface for the current label. Only headers whose field is in this set render as clickable sort triggers — others render as plain text. Empty set means no sorting offered (a text search across mixed types where no single label's sort applies). */
	setSortableFields(fields: ReadonlyArray<string>): void {
		this.sortableFields = new Set(fields);
	}

	/** Set an already-resident result set (a text search's match page). Derives the visible columns immediately. */
	setResults(rows: VertexRow[]): void {
		this.#residentSource.set(rows);
		this.#activate(this.#residentSource);
		this.#deriveColumns(rows);
		this.requestUpdate();
	}

	/** Drive the table from a paged/lazy source (the parent fetches a window at a time). Columns derive from the first
	 *  resident window; total and position come from the source. */
	setSource(source: WindowedSource<VertexRow>): void {
		this.#activate(source);
		this.allProperties = [];
		this.#deriveFromResident();
		this.requestUpdate();
	}

	getSelectedIds(): Set<string> {
		return this.selectedIds;
	}

	deselectAll(): void {
		if (this.selectedIds.size === 0) return;
		this.selectedIds.clear();
		this.requestUpdate();
	}

	#subscribe(): void {
		this.#unsub?.();
		this.#unsub = this.#source.subscribe(() => {
			if (this.allProperties.length === 0) this.#deriveFromResident(); // first window arrived: derive columns once
			this.requestUpdate(); // total / newly-fetched rows changed
		});
	}

	#activate(source: WindowedSource<VertexRow>): void {
		if (source === this.#source) return;
		this.#source = source;
		this.#subscribe();
	}

	/** The rows currently held by the source, up to `cap` (all of a resident set, or the fetched windows of a lazy one). */
	#residentSample(cap: number): VertexRow[] {
		const n = Math.min(this.#source.count(), cap);
		const rows: VertexRow[] = [];
		for (let i = 0; i < n; i++) {
			const r = this.#source.rowAt(i);
			if (r) rows.push(r);
		}
		return rows;
	}

	#deriveFromResident(): void {
		const sample = this.#residentSample(200);
		if (sample.length > 0) this.#deriveColumns(sample);
	}

	#deriveColumns(rows: readonly VertexRow[]): void {
		const propSet = new Set<string>();
		for (const v of rows) for (const k of Object.keys(v)) if (isVisibleKey(k, this.persistedAs)) propSet.add(k);
		const relOrder = getPropertyOrder(this.persistedAs).filter((p) => propSet.has(p));
		const rest = Array.from(propSet)
			.filter((p) => !relOrder.includes(p))
			.sort();
		this.allProperties = [...relOrder, ...rest];
		const firstType = rows[0]?.["@type"];
		this.#multiType = rows.some((v) => v["@type"] && v["@type"] !== firstType);
	}

	private getVisibleProperties(displayMode: string, fixedProperty?: string): string[] {
		if (displayMode === "objects") {
			// Show only the individual identity — all rows share the fixed property value.
			return this.allProperties.filter((p) => p !== fixedProperty).slice(0, 1);
		}
		if (displayMode === "pairs") {
			const label = persistedTypeOf(this.#source.rowAt(0) ?? {});
			const idProp = label ? this.allProperties.find((p) => getRelSync(label, p) === "item") : undefined;
			if (!idProp) return fixedProperty ? [fixedProperty] : this.allProperties.slice(0, 2);
			return fixedProperty ? [idProp, fixedProperty] : this.allProperties.slice(0, 2);
		}
		// Full mode — show all properties, hide the fixed one (redundant in filtered results).
		return fixedProperty ? this.allProperties.filter((p) => p !== fixedProperty) : this.allProperties;
	}

	#props: string[] = [];

	render(): TemplateResult {
		const { sortBy, sortOrder, displayMode, fixedProperty } = this.state;
		const props = this.getVisibleProperties(displayMode, fixedProperty);
		this.#props = props;
		const total = this.#source.count();
		const cols = props.length > 0 ? `repeat(${props.length}, minmax(0, 1fr))` : "1fr";
		return html`
			<div class="results-wrapper" data-testid="query-results">
				<div class="results-area" data-testid="query-table" style=${`--result-cols:${cols}`} @click=${this.#onAreaClick}>
					<div class="grid-header">
						${props.map((p) => {
							const sortable = this.sortableFields.has(p);
							const isSorted = sortable && sortBy === p;
							const indicator = isSorted ? (sortOrder === "asc" ? " ▲" : " ▼") : "";
							return html`<span class=${["th", isSorted ? "sorted" : "", sortable ? "sortable" : ""].filter(Boolean).join(" ")} data-field=${sortable ? p : ""} @click=${sortable ? () => this.#onSort(p) : null}>${p}${indicator}</span>`;
						})}
					</div>
					<shu-virtual-column .source=${this.#source} .renderRow=${(i: number, r: unknown) => this.#renderRow(i, r)}></shu-virtual-column>
				</div>
			</div>
			${total > 0 ? html`<span class="result-total" data-testid="query-total">${total}</span>` : ""}
		`;
	}

	#renderRow = (index: number, row: unknown): TemplateResult => {
		const v = row as VertexRow | undefined;
		if (!v) return html`<div class="clickable-row" aria-hidden="true">${this.#props.map(() => html`<span class="td">&nbsp;</span>`)}</div>`;
		const vid = idOf(v);
		const vlabel = persistedTypeOf(v);
		const prev = this.#source.rowAt(index - 1);
		// Group header when the @type changes from the previous row — only in a multi-type set, and skipped at a not-yet-fetched
		// window boundary (prev undefined), where it self-corrects once that page loads.
		const groupHeader = this.#multiType && index > 0 && prev !== undefined && v["@type"] !== prev["@type"] ? html`<div class="group-header">${String(v["@type"] ?? "")}</div>` : "";
		const dim = this.#isFutureRow(v) ? TIME_SYNC_CLASS.FUTURE : "";
		const selected = vid && this.selectedIds.has(vid) ? "selected" : "";
		return html`${groupHeader}<div
				class=${["clickable-row", selected, dim].filter(Boolean).join(" ")}
				data-individual-id=${vid}
				data-persisted-as=${vlabel || ""}
				@click=${(e: Event) => this.#onRowClick(e, vid, vlabel)}
			>
			${this.#props.map((p, j) => {
				const raw = String(v[p] ?? "");
				const display = isDateValue(raw) ? formatDate(raw) : truncate(raw);
				return html`<span class="td" title=${raw} data-testid=${j === 0 ? (index === 0 ? "query-row-first" : "query-row") : ""}>${display}</span>`;
			})}
		</div>`;
	};

	#isFutureRow(v: VertexRow): boolean {
		const ts = this.extractTimestamp(v, this.persistedAs);
		return ts !== null && this.isFuture(ts);
	}

	#onSort(field: string): void {
		const { sortBy, sortOrder } = this.state;
		const order = sortBy === field ? (sortOrder === "asc" ? "desc" : "asc") : "asc";
		this.dispatchEvent(new CustomEvent(SHU_EVENT.SORT_CHANGE, { detail: { field, order }, bubbles: true, composed: true }));
	}

	#onRowClick(e: Event, vid: string, vlabel: string): void {
		e.stopPropagation(); // an empty-area click deselects; a row click must not also reach #onAreaClick
		if (!this.state.selectable || !vid) return;
		const multi = (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey;
		if (multi) {
			if (this.selectedIds.has(vid)) this.selectedIds.delete(vid);
			else this.selectedIds.add(vid);
		} else if (this.selectedIds.has(vid) && this.selectedIds.size === 1) {
			this.selectedIds.clear();
		} else {
			this.selectedIds.clear();
			this.selectedIds.add(vid);
		}
		this.requestUpdate();
		this.dispatchEvent(new CustomEvent(SHU_EVENT.ROW_CLICK, { detail: { individualId: vid, label: vlabel, ctrlKey: multi }, bubbles: true, composed: true }));
	}

	#onAreaClick = (e: Event): void => {
		if (!this.state.selectable) return;
		if ((e.target as HTMLElement).closest(".clickable-row")) return; // handled by #onRowClick
		this.deselectAll();
		this.dispatchEvent(new CustomEvent(SHU_EVENT.ROW_CLICK, { detail: { individualId: null, deselect: true }, bubbles: true, composed: true }));
	};
}

customElements.define("shu-result-table", ShuResultTable);
