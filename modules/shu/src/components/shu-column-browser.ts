/**
 * <shu-column-browser> — Miller column browser for exploring graph vertices.
 * Clicking any property name or value opens a new column to the right.
 * Each column shows either a single vertex (entity) or a list of query results.
 */
import { SHARED_STYLES } from "./styles.js";
import { SHU_EVENT } from "../consts.js";
import { esc, escAttr, truncate, errMsg, vertexId, vertexLabel, HIDDEN_PROPS, renderContentHtml, utf8ToBase64 } from "../util.js";
import { bindCopyButtons, copyButtonHtml } from "../copy-util.js";
import { renderValue } from "./value-renderers.js";
import { queryUriToPayload } from "../query-uri.js";
import { SseClient, inAction } from "../sse-client.js";
import { getAvailableSteps, requireStep, findStep } from "../rpc-registry.js";
import { getRels, getRelSync, getSummaryFields } from "../rels-cache.js";
import { defaultLabel } from "../util.js";
import { Access } from "@haibun/core/lib/resources.js";

type VertexData = Record<string, unknown>;
type EdgeData = { type: string; target: VertexData };

/** The query that produced this column's data. */
interface ColumnQuery {
	vertexId?: string;
	label?: string;
	property?: string;
	value?: string;
}

interface Column {
	label: string;
	vertexLabel?: string;
	vertex?: VertexData;
	edges?: EdgeData[];
	results?: VertexData[];
	error?: string;
	loading?: boolean;
	query?: ColumnQuery;
}

function styleTag(css: string): string {
	return `<style>${css}</style>`;
}

export class ShuColumnBrowser extends HTMLElement {
	private columns: Column[] = [];
	private currentIndex = -1;
	private predicateLinkCount = 0;

	constructor() {
		super();
		this.attachShadow({ mode: "open" });
	}

	connectedCallback(): void {
		this.render();
	}

	/** Open a vertex entity column by ID. Fetches vertex + edges. */
	/** Open a vertex entity column by ID. The caller must ensure id is a valid vertex identity. */
	async openColumn(id: string, afterIndex?: number, label?: string): Promise<void> {
		const vertexLabel = label || defaultLabel();
		const query: ColumnQuery = { vertexId: id, label: vertexLabel };
		this.pushColumn(id, afterIndex, query, true);
		const colIndex = this.columns.length - 1;
		try {
			await getAvailableSteps();
			// Pre-fetch rels so rendering uses correct link relations
			getRels(vertexLabel);
			const client = SseClient.for("");
			const stepDesc = findStep(`get${vertexLabel}WithEdges`);
			if (!stepDesc?.method) {
				this.columns[colIndex] = {
					label: id,
					vertexLabel,
					error: `No step for ${vertexLabel}`,
					query,
				};
				this.render();
				return;
			}
			const data = await inAction((scope) => client.rpc<{ vertex: VertexData; edges: EdgeData[] }>(scope, stepDesc.method, { id }));
			this.columns[colIndex] = {
				label: id,
				vertexLabel,
				vertex: data.vertex,
				edges: data.edges ?? [],
				query,
			};
			this.render();
		} catch (err) {
			this.columns[colIndex] = {
				label: id,
				vertexLabel,
				error: errMsg(err),
				query,
			};
			this.render();
		}
	}

	/** Open a query results column — shows vertices matching filters. */
	async openQueryColumn(uri: string, afterIndex?: number): Promise<void> {
		await getAvailableSteps();
		const payload = queryUriToPayload(uri);

		// Vertex-only URI → open as entity
		if (payload.vertexId && !payload.label && !payload.textQuery && !(payload.conditions as unknown[])?.length) {
			void this.openColumn(payload.vertexId as string, afterIndex);
			return;
		}

		const label = uri;
		const query: ColumnQuery = {
			vertexId: payload.vertexId as string | undefined,
			label: payload.label as string | undefined,
		};
		this.pushColumn(label, afterIndex, query, true);
		const colIndex = this.columns.length - 1;
		try {
			const client = SseClient.for("");
			const data = await inAction((scope) => client.rpc<{ vertices: VertexData[]; total: number }>(scope, requireStep("graphQuery"), { query: payload }));
			this.columns[colIndex] = { label, results: data.vertices, query };
			this.render();
		} catch (err) {
			this.columns[colIndex] = { label, error: errMsg(err), query };
			this.render();
		}
	}

	/** Open a column showing vertices filtered by a specific property value. */
	async openFilteredColumn(property: string, value: string, label: string, afterIndex?: number): Promise<void> {
		const colLabel = `${property}=${truncate(value, 30)}`;
		const query: ColumnQuery = { property, value, label };
		this.pushColumn(colLabel, afterIndex, query, true);
		const colIndex = this.columns.length - 1;
		try {
			await getAvailableSteps();
			const client = SseClient.for("");
			const data = await inAction((scope) => client.rpc<{ vertices: VertexData[]; total: number }>(scope, requireStep("graphQuery"), {
				query: {
					label,
					filters: [{ property, operator: "eq", value }],
					sortBy: "",
					sortOrder: "desc",
					limit: 50,
					offset: 0,
					accessLevel: Access.private,
				},
			}));
			this.columns[colIndex] = {
				label: colLabel,
				vertexLabel: label,
				results: data.vertices,
				query,
			};
			this.render();
		} catch (err) {
			this.columns[colIndex] = { label: colLabel, error: errMsg(err), query };
			this.render();
		}
	}

	/** Open a column showing all vertices that have a given property, sorted by it. */
	async openPropertyColumn(property: string, label: string, afterIndex?: number): Promise<void> {
		const colLabel = property;
		const query: ColumnQuery = { property, label };
		this.pushColumn(colLabel, afterIndex, query, true);
		const colIndex = this.columns.length - 1;
		try {
			await getAvailableSteps();
			const client = SseClient.for("");
			const data = await inAction((scope) => client.rpc<{ vertices: VertexData[]; total: number }>(scope, requireStep("graphQuery"), {
				query: {
					label,
					filters: [],
					sortBy: property,
					sortOrder: "asc",
					limit: 50,
					offset: 0,
					accessLevel: Access.private,
				},
			}));
			this.columns[colIndex] = {
				label: colLabel,
				vertexLabel: label,
				results: data.vertices,
				query,
			};
			this.render();
		} catch (err) {
			this.columns[colIndex] = { label: colLabel, error: errMsg(err), query };
			this.render();
		}
	}

	getColumnLabels(): string[] {
		return this.columns.map((c) => c.label);
	}

	/** Serialize column queries for URL hash storage. Prefixed by type. */
	getColumnKeys(): string[] {
		return this.columns.map((col) => {
			const q = col.query;
			if (!q) return col.label;
			if (q.property && q.value) return `f:${q.label || defaultLabel()}:${q.property}=${q.value}`;
			if (q.property) return `p:${q.label || defaultLabel()}:${q.property}`;
			return q.vertexId || col.label;
		});
	}

	/** Restore a column from a serialized key. */
	async restoreColumn(key: string): Promise<void> {
		if (key.startsWith("f:")) {
			// f:Email:folder=INBOX
			const rest = key.slice(2);
			const colonIdx = rest.indexOf(":");
			const label = rest.slice(0, colonIdx);
			const eqPart = rest.slice(colonIdx + 1);
			const eqIdx = eqPart.indexOf("=");
			const property = eqPart.slice(0, eqIdx);
			const value = eqPart.slice(eqIdx + 1);
			await this.openFilteredColumn(property, value, label);
		} else if (key.startsWith("p:")) {
			// p:Email:subject
			const rest = key.slice(2);
			const colonIdx = rest.indexOf(":");
			const label = rest.slice(0, colonIdx);
			const property = rest.slice(colonIdx + 1);
			await this.openPropertyColumn(property, label);
		} else {
			// Plain vertex ID
			await this.openColumn(key);
		}
	}

	setActiveColumn(subject: string | null): boolean {
		if (subject === null) {
			this.currentIndex = -1;
			this.render();
			return true;
		}
		const idx = this.columns.findIndex((c) => c.label === subject);
		if (idx < 0 || idx === this.currentIndex) return idx >= 0;
		this.currentIndex = idx;
		this.render();
		this.emitColumnActivated();
		return true;
	}

	private emitColumnActivated(): void {
		const col = this.columns[this.currentIndex];
		this.dispatchEvent(
			new CustomEvent(SHU_EVENT.COLUMN_ACTIVATED, {
				detail: {
					index: this.currentIndex + 1,
					subject: col?.label,
					vertexLabel: col?.vertexLabel,
				},
				bubbles: true,
				composed: true,
			}),
		);
	}

	private emitColumnsChanged(): void {
		this.dispatchEvent(
			new CustomEvent(SHU_EVENT.COLUMNS_CHANGED, {
				detail: { columns: this.getColumnLabels() },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private pushColumn(label: string, afterIndex?: number, query?: ColumnQuery, loading?: boolean): void {
		const insertAt = afterIndex !== undefined && afterIndex >= 0 ? afterIndex + 1 : this.columns.length;
		this.columns = this.columns.slice(0, insertAt);
		this.columns.push({ label, query, loading });
		this.currentIndex = this.columns.length - 1;
		this.render();
		this.emitColumnsChanged();
		requestAnimationFrame(() => {
			const container = this.shadowRoot?.querySelector(".columns-container");
			if (container) container.scrollLeft = container.scrollWidth;
		});
	}

	private moveToFolder(_vid: string, destFolder: string, colIndex: number): void {
		try {
			// TODO: implement folder move via moveEmail step
			const col = this.columns[colIndex];
			if (col?.vertex) {
				col.vertex.folder = destFolder;
				this.render();
			} else {
				throw new Error("No vertex to move");
			}
		} catch (err) {
			const col = this.columns[colIndex];
			if (col) {
				col.error = `Move failed: ${errMsg(err)}`;
				this.render();
			}
		}
	}

	private render(): void {
		if (!this.shadowRoot) return;
		if (this.columns.length === 0) return;

		this.predicateLinkCount = 0;

		this.shadowRoot.innerHTML = `
			${styleTag(SHARED_STYLES)}
			${styleTag(COLUMN_STYLES)}
			<div class="columns-container" data-testid="column-browser">
				${this.columns.map((col, i) => this.renderColumn(col, i)).join("")}
			</div>
		`;

		this.bindEvents();

		// Dispatch context-change for the current column
		const currentCol = this.columns[this.currentIndex];
		if (currentCol) {
			this.dispatchEvent(
				new CustomEvent(SHU_EVENT.CONTEXT_CHANGE, {
					detail: {
						patterns: [{ s: currentCol.label }],
						accessLevel: Access.private,
					},
					bubbles: true,
					composed: true,
				}),
			);
		}
	}

	private renderColumn(col: Column, index: number): string {
		const isCurrent = index === this.currentIndex;
		const bodyHtml = col.error ? `<div class="error-banner">${esc(col.error)}</div>` : col.vertex ? this.renderEntityColumn(col, index) : this.renderResultsColumn(col, index);

		return `
			<div class="column${isCurrent ? " current" : ""}" data-col-index="${index}" data-testid="browser-column">
				<div class="column-header">
					<span class="column-label" title="${esc(col.label)}">${esc(truncate(col.label, 40))}</span>
					<button class="close-column" data-col-index="${index}">x</button>
				</div>
				<div class="column-body">
					${bodyHtml}
				</div>
			</div>
		`;
	}

	private renderEntityColumn(col: Column, index: number): string {
		if (!col.vertex) return '<div class="no-results">No data.</div>';
		const vertex = col.vertex;
		const lbl = col.vertexLabel ?? vertexLabel(vertex);
		const summaryFieldSet = getSummaryFields(lbl);

		const fields: Record<string, string> = {};
		for (const [k, v] of Object.entries(vertex)) {
			if (k.startsWith("_") || HIDDEN_PROPS.has(k)) continue;
			fields[k] = String(v ?? "");
		}

		const detailRows = Object.entries(fields)
			.filter(([k]) => !summaryFieldSet.has(k))
			.map(
				([k, v]) => `<tr>
				<td class="field-name">${this.clickableValue(k, index, "describedby")}</td>
				<td>${this.clickableValue(v, index, "filter", k)}</td>
			</tr>`,
			)
			.join("");

		const contentIframe = this.renderContentIframe(vertex, lbl);
		const hasBody = contentIframe.length > 0;
		const openAttr = hasBody ? "" : " open";

		const detailsHtml = detailRows
			? `<details class="entity-details"${openAttr} data-testid="entity-details">
				<summary class="detail-toggle">Details</summary>
				<table class="detail-table">${detailRows}</table>
			</details>`
			: "";

		const summaryHtml = Array.from(summaryFieldSet)
			.filter((k) => fields[k])
			.map((k) => `<span class="summary-field">${this.clickableValue(k, index, "describedby")} ${this.clickableValue(fields[k], index, "filter", k)}</span>`)
			.join(" ");

		const currentFolder = String(vertex.folder ?? "");
		const moveBar = currentFolder
			? `<div class="move-bar">
				<span class="move-label">Folder: ${this.clickableValue(currentFolder, index, "filter", "folder")}</span>
				<input type="text" class="move-input" placeholder="Move to..." data-vertex-id="${escAttr(col.label)}" data-col-index="${index}" />
				<button class="move-btn" data-col-index="${index}">Move</button>
			</div>`
			: "";

		return `
			${detailsHtml}
			${summaryHtml ? `<div class="entity-summary">${summaryHtml}</div>` : ""}
			${moveBar}
			${contentIframe}
		`;
	}

	private renderContentIframe(vertex: VertexData, _lbl: string): string {
		const bodies = (vertex._bodies as Array<{ id?: string; content?: string; mediaType?: string }> | undefined) ?? [];
		const available = bodies.filter((b) => typeof b.content === "string" && b.content.length > 0 && typeof b.mediaType === "string");
		if (available.length === 0) return "";

		const switcherHtml =
			available.length > 1
				? `<div class="content-switcher">${available
						.map((b, i) => `<button class="content-switch-btn${i === 0 ? " active" : ""}" data-body-id="${escAttr(String(b.id ?? ""))}">${esc(String(b.mediaType))}</button>`)
						.join("")}</div>`
				: "";

		const active = available[0];
		const raw = String(active.content ?? "");
		const content = renderContentHtml(raw, String(active.mediaType));
		const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;font-size:14px;margin:8px;color:#111;}</style></head><body>${content}</body></html>`;
		const encoded = utf8ToBase64(doc);
		const iframeHtml = `<iframe class="body-iframe" data-body-id="${escAttr(String(active.id ?? ""))}" sandbox="allow-same-origin" src="data:text/html;base64,${encoded}" data-testid="email-body-iframe"></iframe>`;

		const copyBtn = copyButtonHtml(raw);
		const toolbar = `<div class="content-toolbar">${switcherHtml}${copyBtn}</div>`;
		return `<div class="body-container">${toolbar}${iframeHtml}</div>`;
	}

	private renderResultsColumn(col: Column, index: number): string {
		if (!col.results || col.results.length === 0) {
			return col.loading ? '<shu-spinner status="Loading..." visible></shu-spinner>' : '<div class="no-results">No results found.</div>';
		}

		return col.results
			.map((v) => {
				const id = vertexId(v);
				const idField = id;
				const summary = Object.entries(v)
					.filter(([k, val]) => !k.startsWith("_") && !HIDDEN_PROPS.has(k) && String(val ?? "") !== idField)
					.slice(0, 3)
					.map(([k, val]) => `${this.clickableValue(k, index, "describedby")}: ${this.clickableValue(String(val ?? ""), index, "filter", k)}`)
					.join(", ");
				return `<div class="result-row">
				${this.clickableValue(id, index, "item")} <span class="result-summary">${summary}</span>
			</div>`;
			})
			.join("");
	}

	/**
	 * Render a clickable value span with semantic rel attribute.
	 * rel values follow IANA link relation semantics:
	 *   "item"    — entity reference (opens vertex detail)
	 *   "filter"  — property value (opens filtered query)
	 *   "describedby" — property name (opens filtered column)
	 */
	private clickableValue(value: string, colIndex: number, rel = "filter", propertyName?: string): string {
		// For value links, check server rels to determine correct rel
		if (rel === "filter" && propertyName) {
			const col = this.columns[colIndex];
			const serverRel = getRelSync(col?.vertexLabel || defaultLabel(), propertyName);
			if (serverRel === "item") rel = "item";
		}
		if (rel === "filter" || rel === "item") {
			const custom = renderValue(value);
			if (custom) return custom;
		}
		const isPredicate = rel === "describedby";
		let testId = "";
		if (isPredicate) {
			testId = this.predicateLinkCount === 0 ? ' data-testid="predicate-link-first"' : ' data-testid="predicate-link"';
			this.predicateLinkCount++;
		}
		const propAttr = propertyName ? ` data-property="${escAttr(propertyName)}"` : "";
		const linkClass = isPredicate ? "pred-link" : "col-link";
		return `<a class="${linkClass}" rel="${rel}" href="#" data-value="${escAttr(value)}" data-col-index="${colIndex}"${propAttr}${testId}>${esc(truncate(value, 80))}</a>`;
	}

	private bindEvents(): void {
		// Body switcher — re-renders the single iframe with the selected Body sub-resource.
		this.shadowRoot?.querySelectorAll(".content-switch-btn").forEach((btn) => {
			btn.addEventListener("click", () => {
				const bodyId = (btn as HTMLElement).dataset.bodyId;
				if (!bodyId) return;
				const container = (btn as HTMLElement).closest(".body-container");
				if (!container) return;
				container.querySelectorAll(".content-switch-btn").forEach((b) => b.classList.remove("active"));
				btn.classList.add("active");
				const colIdx = parseInt((btn.closest(".column") as HTMLElement)?.dataset.colIndex ?? "0", 10);
				const col = this.columns[colIdx];
				if (!col?.vertex) return;
				const bodies = (col.vertex._bodies as Array<{ id?: string; content?: string; mediaType?: string }> | undefined) ?? [];
				const body = bodies.find((b) => String(b.id ?? "") === bodyId);
				if (!body || typeof body.content !== "string" || typeof body.mediaType !== "string") return;
				const raw = body.content;
				const content = renderContentHtml(raw, body.mediaType);
				const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;font-size:14px;margin:8px;color:#111;}</style></head><body>${content}</body></html>`;
				const iframe = container.querySelector("iframe");
				if (iframe) {
					iframe.dataset.bodyId = bodyId;
					iframe.src = `data:text/html;base64,${utf8ToBase64(doc)}`;
				}
			});
		});

		// Click column to make it current
		this.shadowRoot?.querySelectorAll(".column").forEach((col) => {
			col.addEventListener("click", (e) => {
				if ((e.target as HTMLElement).closest("details")) return;
				const index = parseInt((col as HTMLElement).dataset.colIndex || "0", 10);
				if (this.currentIndex !== index) {
					this.currentIndex = index;
					this.render();
					this.emitColumnActivated();
				}
			});
		});

		// Click a query-link → run query and open results column
		this.shadowRoot?.querySelectorAll(".query-link").forEach((el) => {
			el.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				const uri = (el as HTMLElement).dataset.queryUri;
				if (!uri) return;
				const colIndex = parseInt((el.closest(".column") as HTMLElement | null)?.dataset.colIndex || "0", 10);
				void this.openQueryColumn(uri, colIndex);
			});
		});

		// Click a value link → typed navigation via rel attribute (HATEOAS)
		this.shadowRoot?.querySelectorAll(".col-link:not(.query-link), .pred-link").forEach((el) => {
			el.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				const target = el as HTMLElement;
				const value = target.dataset.value;
				const rel = target.getAttribute("rel");
				const propertyName = target.dataset.property;
				const colIndex = parseInt(target.dataset.colIndex || "0", 10);
				if (!value) return;

				const col = this.columns[colIndex];
				const currentLabel = col?.vertexLabel || defaultLabel();

				switch (rel) {
					case "item":
						// Entity reference — open as vertex
						void this.openColumn(value, colIndex, currentLabel);
						break;
					case "describedby":
						// Property name — show all vertices sorted by this property
						void this.openPropertyColumn(value, currentLabel, colIndex);
						break;
					case "filter":
					default:
						// Property value — open filtered query using the property context
						if (propertyName) {
							void this.openFilteredColumn(propertyName, value, currentLabel, colIndex);
						} else {
							console.warn(`[column-browser] filter click without property context: ${value}`);
							void this.openColumn(value, colIndex, currentLabel);
						}
						break;
				}
			});
		});

		// Move to folder
		this.shadowRoot?.querySelectorAll(".move-btn").forEach((el) => {
			el.addEventListener("click", (e) => {
				e.stopPropagation();
				const colIndex = parseInt((el as HTMLElement).dataset.colIndex || "0", 10);
				const input = this.shadowRoot?.querySelector(`.move-input[data-col-index="${colIndex}"]`) as HTMLInputElement | null;
				if (!input?.value) return;
				const vid = input.dataset.vertexId;
				if (!vid) return;
				void this.moveToFolder(vid, input.value, colIndex);
			});
		});

		this.shadowRoot?.querySelectorAll(".move-input").forEach((el) => {
			el.addEventListener("keydown", (e) => {
				if ((e as KeyboardEvent).key === "Enter") {
					e.preventDefault();
					const input = el as HTMLInputElement;
					const colIndex = parseInt(input.dataset.colIndex || "0", 10);
					const vid = input.dataset.vertexId;
					if (!vid || !input.value) return;
					void this.moveToFolder(vid, input.value, colIndex);
				}
			});
		});

		// Close column
		this.shadowRoot?.querySelectorAll(".close-column").forEach((el) => {
			el.addEventListener("click", (e) => {
				e.stopPropagation();
				const index = parseInt((el as HTMLElement).dataset.colIndex || "0", 10);
				this.columns.splice(index, 1);
				if (this.columns.length === 0) {
					this.emitColumnsChanged();
					this.remove();
				} else {
					if (this.currentIndex >= this.columns.length) {
						this.currentIndex = this.columns.length - 1;
					}
					this.render();
					this.emitColumnsChanged();
				}
			});
		});

		bindCopyButtons(this.shadowRoot as ShadowRoot);
	}
}

const COLUMN_STYLES = `
	:host { display: block; height: 100%; overflow: hidden; font-family: inherit; color: #222; }
	.columns-container {
		display: flex; gap: 1px; overflow-x: auto; height: 100%; background: #e0e0e0;
	}
	.column {
		background: #fff; display: flex; flex-direction: column; overflow: hidden; min-height: 0; height: 100%;
		flex: 1; min-width: 15vw; max-width: 100%;
	}
	.column-header {
		display: flex; justify-content: space-between; align-items: center;
		padding: 3px 8px; border-bottom: 1px solid #ccc; background: #f8f8f8; flex-shrink: 0;
	}
	.current { border-top: 2px solid #1a6b3c; }
	.current .column-header { background: #e8f5e9; color: #1a6b3c; }
	.column-label {
		font-weight: 600; font-size: inherit; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.close-column {
		background: none; border: 1px solid #bbb; border-radius: 3px; cursor: pointer;
		font-size: 0.85em; padding: 0 4px; line-height: 1.4; color: #888;
	}
	.close-column:hover { background: #eee; color: #444; }
	.column-body {
		flex: 1; min-height: 0; min-width: 0; overflow-y: auto; padding: 4px 6px; display: flex; flex-direction: column;
	}
	.detail-table { width: 100%; border-collapse: collapse; font-size: inherit; }
	.detail-table td { padding: 2px 4px; vertical-align: top; }
	.field-name { font-weight: 600; white-space: nowrap; color: #666; width: 90px; font-size: 0.85em; }
	.entity-details { margin: 2px 0; font-size: 0.9em; flex-shrink: 0; }
	.detail-toggle { cursor: pointer; color: #aaa; font-size: 0.8em; padding: 2px 0; }
	.detail-toggle:hover { color: #555; }
	.entity-summary { display: flex; flex-wrap: wrap; gap: 2px 10px; padding: 2px 0 4px; color: #555; font-size: 0.9em; flex-shrink: 0; }
	.summary-field:first-child { font-weight: 500; }
	.content-toolbar { display: flex; gap: 4px; padding: 2px 4px; flex-shrink: 0; align-items: center; }
	.content-switcher { display: flex; gap: 4px; flex-shrink: 0; }
	.content-switch-btn { font-size: 0.75em; padding: 1px 6px; border: 1px solid #ccc; border-radius: 3px; cursor: pointer; background: #f5f5f5; color: #555; }
	.content-switch-btn.active { background: #e8f5e9; border-color: #1a6b3c; color: #1a6b3c; }
	.hidden { display: none; }
	.body-container { display: flex; flex-direction: column; flex: 1; min-height: 0; }
	.body-iframe { width: 100%; flex: 1; min-height: 150px; border: none; background: #fff; }
	.error-banner {
		padding: 6px 8px; margin: 4px; background: #fdd; border: 1px solid #c00;
		color: #900; font-size: inherit; white-space: pre-wrap; word-break: break-word; border-radius: 3px;
	}
	.no-results { padding: 16px; color: #999; text-align: center; font-size: inherit; }
	.result-row { padding: 2px 4px; font-size: inherit; }
	.result-summary { color: #888; font-size: 0.85em; }
	.move-bar {
		display: flex; gap: 3px; align-items: center; padding: 3px 4px;
		border-bottom: 1px solid #eee; font-size: inherit; flex-shrink: 0;
	}
	.move-label { color: #666; white-space: nowrap; }
	.move-input {
		flex: 1; padding: 2px 4px; border: 1px solid #bbb; border-radius: 3px;
		font: inherit; font-size: inherit; min-width: 60px;
	}
	.move-btn {
		padding: 2px 6px; background: #fff; border: 1px solid #bbb; border-radius: 3px;
		font: inherit; font-size: inherit; cursor: pointer;
	}
	.move-btn:hover { background: #eee; }
`;
