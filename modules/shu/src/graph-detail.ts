/**
 * <shu-graph-detail> — Displays a single vertex with its edges.
 * Replaces shu-column-browser for entity detail view.
 */
import { esc, escAttr, truncate, formatDate } from "./util.js";
import { isDateValue } from "./util.js";
import { SseClient } from "./sse-client.js";
import { getAvailableSteps, requireStep } from "./rpc-registry.js";

const HIDDEN_PROPS = new Set(["accessLevel"]);

export class ShuGraphDetail extends HTMLElement {
	private vertexId = "";
	private label = "";
	private vertex: Record<string, unknown> | null = null;
	private edges: Array<{ type: string; target: unknown }> = [];
	private loading = false;

	constructor() {
		super();
		this.attachShadow({ mode: "open" });
	}

	/** Open a vertex by label and ID. Fetches data and renders. */
	async open(label: string, id: string): Promise<void> {
		this.label = label;
		this.vertexId = id;
		this.loading = true;
		this.render();

		try {
			await getAvailableSteps();
			const client = SseClient.for("");
			const stepName = requireStep(`get${label}WithEdges`);
			const data = await client.rpc<{ vertex: Record<string, unknown>; edges: Array<{ type: string; target: unknown }> }>(
				stepName,
				{
					id,
				},
			);
			this.vertex = data.vertex;
			this.edges = data.edges ?? [];
		} catch {
			this.vertex = null;
			this.edges = [];
		}
		this.loading = false;
		this.render();
	}

	private render(): void {
		if (!this.shadowRoot) return;

		if (this.loading) {
			this.shadowRoot.innerHTML = `<style>${STYLES}</style><div class="loading">Loading...</div>`;
			return;
		}

		if (!this.vertex) {
			this.shadowRoot.innerHTML = `<style>${STYLES}</style><div class="empty">No data</div>`;
			return;
		}

		const props = this.vertex.properties ? (this.vertex.properties as Record<string, unknown>) : this.vertex;

		const propRows = Object.entries(props)
			.filter(([k]) => !HIDDEN_PROPS.has(k))
			.map(([key, value]) => {
				const val = String(value ?? "");
				const isLong = val.length > 200;
				const display = isDateValue(val) ? formatDate(val) : isLong ? val : truncate(val, 100);
				return `<tr>
					<td class="prop-key">${esc(key)}</td>
					<td class="prop-val" title="${escAttr(val)}">${isLong ? `<details><summary>${esc(truncate(val, 80))}</summary><pre>${esc(val)}</pre></details>` : esc(display)}</td>
				</tr>`;
			})
			.join("");

		const edgeRows = this.edges
			.map((e) => {
				const targetProps = typeof e.target === "object" && e.target ? (e.target as Record<string, unknown>) : {};
				const targetId = String(targetProps.messageId ?? targetProps.id ?? targetProps.name ?? "?");
				return `<tr>
					<td class="edge-type">${esc(String(e.type).replace(/"/g, ""))}</td>
					<td class="edge-target" data-target-id="${escAttr(targetId)}">${esc(truncate(targetId, 60))}</td>
				</tr>`;
			})
			.join("");

		this.shadowRoot.innerHTML = `<style>${STYLES}</style>
			<div class="detail">
				<div class="header">
					<span class="label">${esc(this.label)}</span>
					<span class="id">${esc(truncate(this.vertexId, 50))}</span>
					<button class="close-btn">x</button>
				</div>
				<table class="props">${propRows}</table>
				${edgeRows ? `<div class="section-label">Edges</div><table class="edges">${edgeRows}</table>` : ""}
			</div>`;

		this.shadowRoot.querySelector(".close-btn")?.addEventListener("click", () => {
			this.dispatchEvent(new CustomEvent("detail-close", { bubbles: true, composed: true }));
		});

		this.shadowRoot.querySelectorAll(".edge-target[data-target-id]").forEach((el) => {
			el.addEventListener("click", () => {
				const targetId = (el as HTMLElement).dataset.targetId;
				if (targetId) {
					this.dispatchEvent(
						new CustomEvent("vertex-open", {
							detail: { id: targetId, label: this.label },
							bubbles: true,
							composed: true,
						}),
					);
				}
			});
		});
	}
}

const STYLES = `
:host { display: block; font-family: inherit; padding: 8px; }
.header { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid #ccc; margin-bottom: 8px; }
.label { font-weight: 600; color: #1a6b3c; }
.id { color: #666; font-size: 0.9em; flex: 1; overflow: hidden; text-overflow: ellipsis; }
.close-btn { background: none; border: 1px solid #bbb; border-radius: 3px; cursor: pointer; padding: 0 4px; color: #888; }
.props, .edges { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
.props td, .edges td { padding: 2px 6px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
.prop-key, .edge-type { font-weight: 600; color: #666; white-space: nowrap; width: 120px; font-size: 0.85em; }
.prop-val { word-break: break-word; }
.edge-target { cursor: pointer; color: #1a6b3c; }
.edge-target:hover { text-decoration: underline; }
.section-label { font-weight: 600; color: #888; font-size: 0.85em; margin: 8px 0 4px; letter-spacing: 0.3px; }
.loading, .empty { color: #888; padding: 8px; }
details summary { cursor: pointer; }
pre { white-space: pre-wrap; font-size: 0.85em; background: #f8f8f8; padding: 4px; border-radius: 3px; }
`;
