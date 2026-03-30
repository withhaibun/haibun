/**
 * <shu-entity-column> — Displays a single vertex with edges.
 * Fetches vertex+edges via RPC on open. Renders once per navigation.
 * HATEOAS rel-based clickable values. Fully type-agnostic — driven by schema metadata.
 *
 * Events: column-open (entity nav), column-open-filter (filter nav)
 */
import { defaultLabel } from "./util.js";
import { SHARED_STYLES } from "./styles.js";
import { ShuElement } from "./shu-element.js";
import { EntityColumnSchema } from "./schemas.js";
import { esc, escAttr, truncate, errMsg, vertexId, HIDDEN_PROPS, renderContentHtml, utf8ToBase64 } from "./util.js";
import { renderValue } from "./value-renderers.js";
import { SseClient } from "./sse-client.js";
import { getAvailableSteps, requireStep } from "./rpc-registry.js";
import { getRelSync, getEdgeTargetLabel, getEdgeTypesForLabel, getSummaryFields, getContentFields } from "./rels-cache.js";

type VertexData = Record<string, unknown>;
type EdgeData = { type: string; target: VertexData; direction?: "out" | "in" };

export class ShuEntityColumn extends ShuElement<typeof EntityColumnSchema> {
	private vertex: VertexData | null = null;
	private edges: EdgeData[] = [];
	private incomingCount = 0;
	private predicateLinkCount = 0;
	private edgeTargetCount = 0;

	constructor() {
		super(EntityColumnSchema, { vertexId: "", vertexLabel: "Email", loading: false });
	}

	/** Open a vertex by ID. Fetches data and renders. */
	async open(id: string, label: string = defaultLabel()): Promise<void> {
		this.setState({ vertexId: id, vertexLabel: label, loading: true, error: undefined });
		try {
			await getAvailableSteps();
			const client = SseClient.for("");
			const data = await client.rpc<{ vertex: VertexData; edges: EdgeData[]; incomingCount: number }>(
				requireStep("getVertexWithEdges"),
				{ label, id },
			);
			this.vertex = data.vertex;
			this.edges = data.edges ?? [];
			this.incomingCount = data.incomingCount ?? 0;
			this.setState({ loading: false });
		} catch (err) {
			console.error(`[entity-column] open ${id} failed:`, err);
			this.setState({ loading: false, error: errMsg(err) });
		}
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		const { loading, error, vertexLabel } = this.state;
		this.predicateLinkCount = 0;
		this.edgeTargetCount = 0;

		if (loading) {
			const { vertexId: vid, vertexLabel: lbl } = this.state;
			this.shadowRoot.innerHTML = `<style>${STYLES}</style><shu-spinner status="Fetching ${lbl} ${vid.slice(0, 30)}..." visible></shu-spinner>`;
			return;
		}
		if (error) {
			this.shadowRoot.innerHTML = `<style>${STYLES}</style><div class="error-banner">${esc(error)}</div>`;
			return;
		}
		if (!this.vertex) {
			// Before open() is called: show spinner. After open() completes with no vertex: show error.
			const msg = this.state.vertexId ? `Vertex not found: ${esc(this.state.vertexId)}` : "";
			this.shadowRoot.innerHTML = msg
				? `<style>${STYLES}</style><div class="error-banner">${msg}</div>`
				: `<style>${STYLES}</style><shu-spinner status="Waiting..." visible></shu-spinner>`;
			return;
		}

		// Content fields (e.g. body, bodyHtml, markdown) are rendered in an iframe — exclude from field table
		const contentFieldSet = new Set(Object.keys(getContentFields(vertexLabel)));
		const fields: Record<string, string | string[]> = {};
		for (const [k, v] of Object.entries(this.vertex)) {
			if (k.startsWith("_") || contentFieldSet.has(k) || HIDDEN_PROPS.has(k)) continue;
			fields[k] = Array.isArray(v) ? (v as string[]).map(String) : String(v ?? "");
		}

		// Stub detection: vertex has ≤1 meaningful properties (just the ID field)
		const isStub = Object.values(fields).filter((v) => (Array.isArray(v) ? v.length > 0 : v)).length <= 1;

		let contentHtml: string;
		if (isStub) {
			const id = vertexId(this.vertex);
			contentHtml = `
				<div class="entity-header" data-testid="entity-stub">
					<span class="entity-type">${esc(vertexLabel)}</span>
					<span class="entity-id">${esc(id)}</span>
				</div>
				${this.renderReferences()}
			`;
		} else {
			const summaryFields = getSummaryFields(vertexLabel);
			const detailRows = Object.entries(fields)
				.filter(([k]) => !getEdgeTargetLabel(k) && !summaryFields.has(k))
				.map(([k, v]) => {
					const valueHtml = Array.isArray(v)
						? v.map((item) => this.clickableValue(item, "filter", k)).join(", ")
						: this.clickableValue(v, "filter", k);
					return `<tr>
					<td class="field-name">${this.clickableValue(k, "describedby")}</td>
					<td data-testid="entity-field-${escAttr(k)}">${valueHtml}</td>
				</tr>`;
				})
				.join("");
			const detailsHtml = detailRows
				? `<details class="entity-detail" data-testid="entity-details">
					<summary class="detail-toggle">Details</summary>
					<table class="detail-table">${detailRows}</table>
				</details>`
				: "";

			const summaryHtml =
				summaryFields.size > 0
					? `<div class="entity-summary" data-testid="entity-summary">
					${Array.from(summaryFields)
						.filter((k) => fields[k] && (Array.isArray(fields[k]) ? (fields[k] as string[]).length > 0 : true))
						.map((k) => {
							const v = fields[k];
							const valueHtml = Array.isArray(v)
								? v.map((item) => this.clickableValue(item, "filter", k)).join(", ")
								: this.clickableValue(v, "filter", k);
							return `<span class="summary-field" data-testid="entity-field-${escAttr(k)}">${this.clickableValue(k, "describedby")} ${valueHtml}</span>`;
						})
						.join(" ")}
				</div>`
					: "";

			const contentIframe = this.renderContentIframe(vertexLabel);

			contentHtml = `
				${detailsHtml}
				${summaryHtml}
				${this.renderReferences()}
				${contentIframe}
			`;
		}

		this.shadowRoot.innerHTML = `
			<style>${STYLES}</style>
			<div class="entity-content">
				${contentHtml}
			</div>
		`;
		this.bindEvents();
	}

	/** Render a clickable edge target with label from HATEOAS edge range. */
	private renderEdgeTarget(target: VertexData, edgeType: string): string {
		const id = vertexId(target);
		const label = getEdgeTargetLabel(edgeType) ?? (target._label as string) ?? defaultLabel();
		const display = String(target.name ?? target.email ?? target.filename ?? target.subject ?? id);
		const testId = this.edgeTargetCount === 0 ? ' data-testid="edge-target-first"' : "";
		this.edgeTargetCount++;
		return `<a class="col-link" rel="item" href="#" data-value="${escAttr(id)}" data-label="${escAttr(label)}"${testId}>${esc(truncate(display, 60))}</a>`;
	}

	private renderReferences(): string {
		// Separate address edges (shown in summary) from graph edges (shown here)
		const addressEdgeTypes = getEdgeTypesForLabel("Contact");
		const outgoing = this.edges.filter((e) => !addressEdgeTypes.has(e.type));

		if (outgoing.length === 0 && this.incomingCount === 0) return "";

		// Deduplicate targets for display — inReplyTo takes priority over references
		const seen = new Set<string>();
		const grouped = new Map<string, Array<{ target: VertexData; edgeType: string }>>();
		const sorted = [...outgoing].sort((a) => (a.type === "inReplyTo" ? -1 : 1));
		for (const e of sorted) {
			const tid = vertexId(e.target);
			if (seen.has(tid)) continue;
			seen.add(tid);
			const group = grouped.get(e.type) || [];
			group.push({ target: e.target, edgeType: e.type });
			grouped.set(e.type, group);
		}
		const outHtml = Array.from(grouped.entries())
			.map(
				([type, items]) => `
				<div class="ref-group">
					<span class="ref-type">${esc(type)}</span>
					${items.map((i) => this.renderEdgeTarget(i.target, i.edgeType)).join(", ")}
				</div>`,
			)
			.join("");

		const inHtml =
			this.incomingCount > 0
				? `<a class="section-label links-here-link" href="#">What links here <span class="ref-count">(${this.incomingCount})</span></a>`
				: "";

		return `<div class="references" data-testid="ref-section">${outHtml}${inHtml}</div>`;
	}

	/** Render content iframe for the first available contentField, with a switcher if multiple exist. */
	private renderContentIframe(vertexLabel: string): string {
		const vertex = this.vertex;
		if (!vertex) return "";
		const fieldFormats = getContentFields(vertexLabel);
		const available = Object.entries(fieldFormats).filter(([f]) => vertex[f]);
		if (available.length === 0) return "";

		const switcherHtml =
			available.length > 1
				? `<div class="content-switcher">${available
						.map(
							([f], i) =>
								`<button class="content-switch-btn${i === 0 ? " active" : ""}" data-field="${escAttr(f)}">${esc(f)}</button>`,
						)
						.join("")}</div>`
				: "";

		const iframesHtml = available
			.map(([f, format], i) => {
				const raw = String(vertex[f] ?? "");
				const content = renderContentHtml(raw, format);
				const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;font-size:14px;margin:8px;color:#111;}</style></head><body>${content}</body></html>`;
				const encoded = utf8ToBase64(doc);
				return `<iframe class="body-iframe${i === 0 ? "" : " hidden"}" data-field="${escAttr(f)}" sandbox="allow-same-origin" src="data:text/html;base64,${encoded}" data-testid="email-body-iframe"></iframe>`;
			})
			.join("");

		return `<div class="body-container">${switcherHtml}${iframesHtml}</div>`;
	}

	private clickableValue(value: string, rel: string, propertyName?: string): string {
		if (rel === "filter" || rel === "item") {
			const custom = renderValue(value);
			if (custom) return custom;
		}
		// Use HATEOAS rels + edge ranges to determine navigation semantics
		let labelAttr = "";
		let resolvedValue = value;
		if (rel === "filter" && propertyName) {
			const serverRel = getRelSync(this.state.vertexLabel, propertyName);
			if (serverRel === "item") {
				rel = "item";
				const targetLabel = getEdgeTargetLabel(propertyName);
				if (targetLabel) {
					labelAttr = ` data-label="${escAttr(targetLabel)}"`;
					// Resolve entity ID from edge target data — the graph edge
					// carries the actual target vertex with its ID field, regardless of type
					const edge = this.edges.find((e) => e.type === propertyName && e.direction === "out");
					if (edge?.target) resolvedValue = vertexId(edge.target);
				}
			}
		}
		const isPredicate = rel === "describedby";
		let testId = "";
		if (isPredicate) {
			testId = this.predicateLinkCount === 0 ? ' data-testid="predicate-link-first"' : ' data-testid="predicate-link"';
			this.predicateLinkCount++;
		}
		const propAttr = propertyName ? ` data-property="${escAttr(propertyName)}"` : "";
		const linkClass = isPredicate ? "pred-link" : "col-link";
		return `<a class="${linkClass}" rel="${rel}" href="#" data-value="${escAttr(resolvedValue)}"${labelAttr}${propAttr}${testId}>${esc(truncate(value, 80))}</a>`;
	}

	private bindEvents(): void {
		this.shadowRoot?.querySelectorAll(".col-link:not(.query-link), .pred-link").forEach((el) => {
			el.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				const target = el as HTMLElement;
				const value = target.dataset.value;
				const rel = target.getAttribute("rel");
				const propertyName = target.dataset.property;
				if (!value) return;

				// Target label comes from data-label (set at render time by HATEOAS rels + edge ranges)
				const targetLabel = target.dataset.label || this.state.vertexLabel;

				switch (rel) {
					case "item":
						this.dispatchEvent(
							new CustomEvent("column-open", {
								detail: { subject: value, label: targetLabel },
								bubbles: true,
								composed: true,
							}),
						);
						break;
					case "describedby":
						this.dispatchEvent(
							new CustomEvent("column-open-filter", {
								detail: { property: value, label: this.state.vertexLabel, type: "property" },
								bubbles: true,
								composed: true,
							}),
						);
						break;
					case "filter":
					default:
						if (propertyName) {
							this.dispatchEvent(
								new CustomEvent("column-open-filter", {
									detail: { property: propertyName, value, label: this.state.vertexLabel, type: "filter" },
									bubbles: true,
									composed: true,
								}),
							);
						}
						break;
				}
			});
		});

		// Content field switcher buttons
		this.shadowRoot?.querySelectorAll(".content-switch-btn").forEach((btn) => {
			btn.addEventListener("click", () => {
				const field = (btn as HTMLElement).dataset.field;
				if (!field) return;
				this.shadowRoot?.querySelectorAll(".content-switch-btn").forEach((b) => b.classList.remove("active"));
				btn.classList.add("active");
				this.shadowRoot?.querySelectorAll(".body-iframe").forEach((iframe) => {
					const el = iframe as HTMLElement;
					el.classList.toggle("hidden", el.dataset.field !== field);
				});
			});
		});

		// "What links here" — clickable to open a filter column
		this.shadowRoot?.querySelector(".links-here-link")?.addEventListener("click", (e) => {
			e.preventDefault();
			this.dispatchEvent(
				new CustomEvent("column-open-filter", {
					detail: { property: "linksTo", value: this.state.vertexId, label: this.state.vertexLabel, type: "incoming" },
					bubbles: true,
					composed: true,
				}),
			);
		});
	}
}

const STYLES =
	SHARED_STYLES +
	`
	:host { display: flex; flex-direction: column; height: 100%; overflow: auto; padding: 6px 8px; font-family: inherit; color: #222; }
	.entity-content { display: flex; flex-direction: column; flex: 1; min-height: 0; }
	.entity-header { padding: 4px 0; }
	.entity-type { font-weight: 600; color: #1a6b3c; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.5px; margin-right: 8px; }
	.entity-id { color: #555; word-break: break-all; }
	.entity-summary { display: flex; flex-wrap: wrap; gap: 2px 10px; padding: 2px 0 4px; color: #555; font-size: 0.9em; }
	.summary-field:first-child { font-weight: 500; }
	.references { padding: 4px 0; margin: 2px 0; }
	.ref-group { padding: 1px 0; display: flex; flex-wrap: wrap; gap: 4px; align-items: baseline; }
	.ref-type { color: #888; font-size: 0.8em; min-width: 70px; }
	.ref-count { color: #aaa; }
	.entity-detail { margin: 2px 0; font-size: 0.9em; }
	.detail-toggle { cursor: pointer; color: #aaa; font-size: 0.8em; padding: 2px 0; }
	.detail-toggle:hover { color: #555; }
	.content-switcher { display: flex; gap: 4px; padding: 2px 0; }
	.content-switch-btn { font-size: 0.75em; padding: 1px 6px; border: 1px solid #ccc; border-radius: 3px; cursor: pointer; background: #f5f5f5; color: #555; }
	.content-switch-btn.active { background: #e8f5e9; border-color: #1a6b3c; color: #1a6b3c; }
	.hidden { display: none; }
	.detail-table { width: 100%; border-collapse: collapse; }
	.detail-table td { padding: 1px 4px; vertical-align: top; }
	.field-name { white-space: nowrap; color: #888; width: 80px; font-size: 0.85em; }
	.body-container { display: flex; flex-direction: column; flex: 1; min-height: 200px; }
	.body-iframe { width: 100%; height: 100%; min-height: 200px; border: none; background: #fff; }
	.error-banner { padding: 6px 8px; margin: 4px; background: #fdd; color: #900; border-radius: 3px; }
	.loading, .empty { color: #888; padding: 8px; }
`;
