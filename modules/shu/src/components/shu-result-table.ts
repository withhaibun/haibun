/**
 * <shu-result-table> — Shared sortable, clickable, paginated vertex table.
 * Used by both the main query pane and filter columns.
 * Owns: table HTML, sort indicators, row selection, scrollbar, wheel/touch paging.
 * Parent owns: RPC fetch, hash state, metadata.
 *
 * Events dispatched:
 *   row-click: { vertexId, label, ctrlKey }
 *   sort-change: { field, order }
 *   page-change: { offset }
 */
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { z } from "zod";
import { ResultTableSchema } from "../schemas.js";
import { esc, escAttr, truncate, formatDate, isDateValue, vertexId, vertexLabel, HIDDEN_PROPS, } from "../util.js";
import { getRelSync, getPropertyOrder } from "../rels-cache.js";

type VertexRow = Record<string, unknown>;

export class ShuResultTable extends ShuElement<typeof ResultTableSchema> {
	private results: VertexRow[] = [];
	private allProperties: string[] = [];
	vertexLabel = "UNSET_VERTEX_LABEL";
	private selectedIds = new Set<string>();
	private resizeObserver: ResizeObserver | null = null;
	private rafPending = false;

	constructor() {
		super(ResultTableSchema, {
			sortOrder: "desc",
			selectable: true,
			displayMode: "full",
			total: 0,
			limit: 100,
			offset: 0,
			paginated: false,
		});
	}

	/** Public state update — allows parent components to configure sort, display mode, etc. */
	updateState(partial: Partial<z.infer<typeof ResultTableSchema>>): void {
		this.setState(partial);
	}

	/** Set results and derive visible properties. Called by parent after RPC fetch. */
	setResults(rows: VertexRow[]): void {
		this.results = rows;
		const propSet = new Set<string>();
		for (const v of rows) {
			for (const k of Object.keys(v)) {
				if (!HIDDEN_PROPS.has(k)) propSet.add(k);
			}
		}
		// Order by rel priority from concern metadata, then remaining alphabetically
		const relOrder = getPropertyOrder(this.vertexLabel).filter((p) => propSet.has(p));
		const rest = Array.from(propSet).filter((p) => !relOrder.includes(p)).sort();
		this.allProperties = [...relOrder, ...rest];
		this.render();
	}

	/** Set pagination info. */
	setPagination(total: number, limit: number, offset: number): void {
		this.state = {
			...this.state,
			total,
			limit,
			offset,
			paginated: total > limit,
		};
		this.updateScrollbar();
	}

	getSelectedIds(): Set<string> {
		return this.selectedIds;
	}

	deselectAll(): void {
		if (this.selectedIds.size === 0) return;
		this.selectedIds.clear();
		this.shadowRoot
			?.querySelectorAll(".clickable-row")
			.forEach((r) => r.classList.remove("selected"));
	}

	connectedCallback(): void {
		super.connectedCallback();
		this.resizeObserver = new ResizeObserver(() => {
			if (this.rafPending) return;
			this.rafPending = true;
			requestAnimationFrame(() => {
				this.rafPending = false;
				this.updateScrollbar();
			});
		});
		this.resizeObserver.observe(this);
	}

	disconnectedCallback(): void {
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		const { sortBy, sortOrder, displayMode, fixedProperty } = this.state;
		const props = this.getVisibleProperties(displayMode, fixedProperty);

		this.shadowRoot.innerHTML = `
			<style>${STYLES}</style>
			<div class="results-wrapper" data-testid="query-results">
				<div class="results-area">
					<table data-testid="query-table">
						<thead><tr>
							${props
				.map((p) => {
					const isSorted = sortBy === p;
					const indicator = isSorted
						? sortOrder === "asc"
							? " &#9650;"
							: " &#9660;"
						: "";
					const cls = isSorted ? ' class="sorted"' : "";
					return `<th${cls} data-field="${escAttr(p)}">${esc(p)}${indicator}</th>`;
				})
				.join("")}
						</tr></thead>
						<tbody>
						${(() => {
				const firstLabel = this.results[0]?._label;
				const isMultiType = this.results.some(
					(v) => v._label && v._label !== firstLabel,
				);
				let lastLabel: string | undefined;
				return this.results
					.map((v, i) => {
						const vid = vertexId(v);
						const vlabel = vertexLabel(v);
						const labelAttr = vlabel
							? ` data-vertex-label="${escAttr(vlabel)}"`
							: "";
						const header =
							isMultiType && v._label !== lastLabel
								? `<tr class="group-header"><th colspan="${props.length}">${esc(String(v._label ?? ""))}</th></tr>`
								: "";
						lastLabel = v._label as string | undefined;
						return `${header}<tr class="clickable-row" data-vertex-id="${escAttr(vid)}"${labelAttr} data-testid="${i === 0 ? "query-row-first" : "query-row"}">
								${props
								.map((p) => {
									const raw = String(v[p] ?? "");
									const display = isDateValue(raw)
										? formatDate(raw)
										: truncate(raw);
									return `<td title="${esc(raw)}">${esc(display)}</td>`;
								})
								.join("")}
								</tr>`;
					})
					.join("");
			})()}
						</tbody>
					</table>
				</div>
			</div>
			${this.state.total > 0 ? `<span class="result-total" data-testid="query-total">${this.state.total}</span>` : ""}
		`;

		this.bindEvents();
		requestAnimationFrame(() => this.updateScrollbar());
	}

	private getVisibleProperties(
		displayMode: string,
		fixedProperty?: string,
	): string[] {
		if (displayMode === "objects") {
			// Show only the vertex identity — all rows share the fixed property value
			return this.allProperties.filter((p) => p !== fixedProperty).slice(0, 1);
		}
		if (displayMode === "pairs") {
			const label = vertexLabel(this.results[0]);
			const idProp = label
				? this.allProperties.find((p) => getRelSync(label, p) === "item")
				: undefined;
			if (!idProp)
				return fixedProperty ? [fixedProperty] : this.allProperties.slice(0, 2);
			return fixedProperty
				? [idProp, fixedProperty]
				: this.allProperties.slice(0, 2);
		}
		// Full mode — show all properties, hide the fixed one (redundant in filtered results)
		return fixedProperty
			? this.allProperties.filter((p) => p !== fixedProperty)
			: this.allProperties;
	}

	private updateScrollbar(): void {
		const wrapper = this.shadowRoot?.querySelector(
			".results-wrapper",
		) as HTMLElement | null;
		const area = this.shadowRoot?.querySelector(
			".results-area",
		) as HTMLElement | null;
		if (!wrapper || !area) return;

		const existing = wrapper.querySelector(
			".scroll-track",
		) as HTMLElement | null;
		if (existing) existing.style.display = "none";
		const overflows = area.scrollHeight > area.clientHeight;
		if (existing) existing.style.display = "";
		const { total, offset } = this.state;
		const hasMore = total > this.results.length;
		const needsScrollbar = overflows || hasMore;

		if (!needsScrollbar) {
			if (existing) {
				existing.remove();
				const paneTotal = this.shadowRoot?.querySelector(
					".result-total",
				) as HTMLElement | null;
				if (paneTotal) paneTotal.style.display = "";
			}
			return;
		}

		const visibleRows = Math.max(1, Math.floor(area.clientHeight / 22));

		if (existing) {
			existing.dataset.total = String(total);
			existing.dataset.visible = String(visibleRows);
			existing.dataset.offset = String(offset);
			this.positionScrollThumb(existing, visibleRows);
			return;
		}

		const track = document.createElement("div");
		track.className = "scroll-track";
		track.dataset.total = String(total);
		track.dataset.visible = String(visibleRows);
		track.dataset.offset = String(offset);
		track.innerHTML = `<span class="scroll-pos scroll-pos-top">${offset + 1}</span><div class="scroll-rail"><div class="scroll-thumb"></div></div><span class="scroll-pos scroll-pos-bottom">${total}</span>`;
		wrapper.appendChild(track);

		const paneTotal = this.shadowRoot?.querySelector(
			".result-total",
		) as HTMLElement | null;
		if (paneTotal) paneTotal.style.display = "none";

		this.positionScrollThumb(track, visibleRows);
		this.bindScrollbarEvents(track, visibleRows);
	}

	private positionScrollThumb(track: HTMLElement, visibleRows?: number): void {
		const rail = track.querySelector(".scroll-rail") as HTMLElement;
		const thumb = track.querySelector(".scroll-thumb") as HTMLElement;
		if (!rail || !thumb) return;
		const total = parseInt(track.dataset.total || "0", 10);
		const visible = visibleRows ?? parseInt(track.dataset.visible || "1", 10);
		const offset = parseInt(track.dataset.offset || "0", 10);
		const railH = rail.clientHeight;
		const ratio = Math.min(1, visible / total);
		const thumbH = Math.max(16, Math.round(railH * ratio));
		const maxOffset = Math.max(0, total - visible);
		const scrollFrac = maxOffset > 0 ? offset / maxOffset : 0;
		const thumbTop = Math.round(scrollFrac * (railH - thumbH));
		thumb.style.height = `${thumbH}px`;
		thumb.style.top = `${thumbTop}px`;
		const topLabel = track.querySelector(".scroll-pos-top");
		if (topLabel) topLabel.textContent = String(offset + 1);
	}

	private emitPageChange(offset: number): void {
		this.dispatchEvent(
			new CustomEvent(SHU_EVENT.PAGE_CHANGE, {
				detail: { offset },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private bindScrollbarEvents(track: HTMLElement, visibleRows: number): void {
		const rail = track.querySelector(".scroll-rail") as HTMLElement;
		const thumb = track.querySelector(".scroll-thumb") as HTMLElement;
		if (!rail || !thumb) return;

		let dragging = false;
		let startY = 0;
		let startOffset = 0;
		const total = () => this.state.total;
		const maxOff = () => Math.max(0, total() - visibleRows);

		// Shared move handler for mouse and touch
		const onPointerMove = (clientY: number) => {
			if (!dragging) return;
			const railH = rail.clientHeight;
			const ratio = Math.min(1, visibleRows / total());
			const thumbH = Math.max(16, Math.round(railH * ratio));
			const scrollRange = railH - thumbH;
			const dy = clientY - startY;
			const newOffset =
				scrollRange > 0
					? Math.round(
						Math.min(
							maxOff(),
							Math.max(0, startOffset + (dy / scrollRange) * maxOff()),
						),
					)
					: 0;
			track.dataset.offset = String(newOffset);
			this.positionScrollThumb(track, visibleRows);
		};

		const onPointerUp = () => {
			if (!dragging) return;
			dragging = false;
			document.removeEventListener("mousemove", mouseMove);
			document.removeEventListener("mouseup", mouseUp);
			document.removeEventListener("touchmove", touchMove);
			document.removeEventListener("touchend", onPointerUp);
			const newOffset = parseInt(track.dataset.offset || "0", 10);
			this.emitPageChange(newOffset);
		};

		const mouseMove = (e: MouseEvent) => onPointerMove(e.clientY);
		const mouseUp = () => onPointerUp();
		const touchMove = (e: TouchEvent) => {
			e.preventDefault();
			onPointerMove(e.touches[0].clientY);
		};

		// Mouse drag
		thumb.addEventListener("mousedown", (e) => {
			e.preventDefault();
			dragging = true;
			startY = e.clientY;
			startOffset = this.state.offset;
			document.addEventListener("mousemove", mouseMove);
			document.addEventListener("mouseup", mouseUp);
		});

		// Touch drag
		thumb.addEventListener(
			"touchstart",
			(e) => {
				e.preventDefault();
				dragging = true;
				startY = e.touches[0].clientY;
				startOffset = this.state.offset;
				document.addEventListener("touchmove", touchMove, { passive: false });
				document.addEventListener("touchend", onPointerUp);
			},
			{ passive: false },
		);

		// Click on rail to page
		rail.addEventListener("click", (e) => {
			if (e.target !== rail) return;
			const thumbRect = thumb.getBoundingClientRect();
			let newOffset = this.state.offset;
			if (e.clientY < thumbRect.top) {
				newOffset = Math.max(0, newOffset - visibleRows);
			} else if (e.clientY > thumbRect.bottom) {
				newOffset = Math.min(maxOff(), newOffset + visibleRows);
			}
			track.dataset.offset = String(newOffset);
			this.positionScrollThumb(track, visibleRows);
			this.emitPageChange(newOffset);
		});
	}

	private bindEvents(): void {
		// Wheel scrolling through dataset
		let wheelTimer: ReturnType<typeof setTimeout> | null = null;
		const wrapper = this.shadowRoot?.querySelector(
			".results-wrapper",
		) as HTMLElement | null;
		wrapper?.addEventListener(
			"wheel",
			(e) => {
				const track = wrapper.querySelector(
					".scroll-track",
				) as HTMLElement | null;
				if (!track) return;
				if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
				e.preventDefault();
				const visibleRows = parseInt(track.dataset.visible || "1", 10);
				const maxOff = Math.max(0, this.state.total - visibleRows);
				let newOffset = this.state.offset;
				if (e.deltaY > 0) {
					newOffset = Math.min(maxOff, newOffset + visibleRows);
				} else {
					newOffset = Math.max(0, newOffset - visibleRows);
				}
				track.dataset.offset = String(newOffset);
				this.positionScrollThumb(track, visibleRows);
				if (wheelTimer) clearTimeout(wheelTimer);
				wheelTimer = setTimeout(() => {
					wheelTimer = null;
					this.emitPageChange(newOffset);
				}, 150);
			},
			{ passive: false },
		);

		// Sort headers
		this.shadowRoot?.querySelectorAll("th[data-field]").forEach((th) => {
			th.addEventListener("click", () => {
				const field = (th as HTMLElement).dataset.field;
				if (!field) return;
				const { sortBy, sortOrder } = this.state;
				const newOrder =
					sortBy === field ? (sortOrder === "asc" ? "desc" : "asc") : "asc";
				this.dispatchEvent(
					new CustomEvent(SHU_EVENT.SORT_CHANGE, {
						detail: { field, order: newOrder },
						bubbles: true,
						composed: true,
					}),
				);
			});
		});

		// Row clicks
		if (this.state.selectable) {
			// Background click deselects
			this.shadowRoot
				?.querySelector(".results-wrapper")
				?.addEventListener("click", (e) => {
					if ((e.target as HTMLElement).closest(".clickable-row")) return;
					this.deselectAll();
					this.dispatchEvent(
						new CustomEvent(SHU_EVENT.ROW_CLICK, {
							detail: { vertexId: null, deselect: true },
							bubbles: true,
							composed: true,
						}),
					);
				});

			this.shadowRoot?.querySelectorAll(".clickable-row").forEach((row) => {
				row.addEventListener("click", (e) => {
					e.stopPropagation();
					const vid = (row as HTMLElement).dataset.vertexId;
					if (!vid) return;
					const vlabel = (row as HTMLElement).dataset.vertexLabel;
					const multi = (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey;

					if (multi) {
						if (this.selectedIds.has(vid)) {
							this.selectedIds.delete(vid);
							row.classList.remove("selected");
						} else {
							this.selectedIds.add(vid);
							row.classList.add("selected");
						}
					} else if (this.selectedIds.has(vid) && this.selectedIds.size === 1) {
						this.selectedIds.clear();
						row.classList.remove("selected");
					} else {
						this.selectedIds.clear();
						this.shadowRoot
							?.querySelectorAll(".clickable-row")
							.forEach((r) => r.classList.remove("selected"));
						this.selectedIds.add(vid);
						row.classList.add("selected");
					}

					this.dispatchEvent(
						new CustomEvent(SHU_EVENT.ROW_CLICK, {
							detail: { vertexId: vid, label: vlabel, ctrlKey: multi },
							bubbles: true,
							composed: true,
						}),
					);
				});
			});
		}
	}
}

const STYLES = `
	:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; position: relative; }
	.results-wrapper { display: flex; flex: 1; min-height: 0; overflow: hidden; }
	.results-area { flex: 1; min-width: 0; overflow-x: auto; overflow-y: hidden; }
	table { width: 100%; border-collapse: collapse; }
	th, td { text-align: left; padding: 1px 6px; white-space: nowrap; }
	th {
		position: sticky; top: 0; background: #fafafa; z-index: 1;
		font-weight: 500; color: #888; font-size: 0.85em;
		letter-spacing: 0.3px; cursor: pointer; user-select: none; padding: 3px 6px;
	}
	th:hover { color: #000; background: #f0f0f0; }
	th.sorted { font-weight: 700; color: #000; }
	td { max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
	.clickable-row { cursor: pointer; }
	.clickable-row:hover { background: #f5f5f5; }
	.clickable-row.selected { background: #e8f0fe; }
	.result-total {
		position: absolute; bottom: 2px; right: 4px;
		font-size: 13px; color: #777; pointer-events: none; font-weight: 500;
	}
	.scroll-track {
		display: flex; flex-direction: column; align-items: center;
		flex-shrink: 0; width: 32px; user-select: none;
	}
	.scroll-pos { font-size: 13px; color: #777; padding: 2px 0; line-height: 1; font-weight: 500; }
	.scroll-rail { position: relative; flex: 1; width: 14px; background: #f0f0f0; cursor: pointer; }
	.scroll-thumb { position: absolute; left: 0; right: 0; background: #999; min-height: 16px; cursor: grab; }
	.scroll-thumb:hover { background: #777; }
	.scroll-thumb:active { background: #555; cursor: grabbing; }
	.scroll-pos-bottom { margin-top: auto; }
	.group-header th {
		background: #f0f0f0; color: #555; font-size: 0.75em; font-weight: 600;
		text-transform: uppercase; letter-spacing: 0.5px; padding: 4px 6px;
		position: sticky; top: 22px; z-index: 1;
	}
`;
