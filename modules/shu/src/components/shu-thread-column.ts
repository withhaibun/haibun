/**
 * <shu-thread-column> — Displays a conversation thread for any vertex type with inReplyTo edges.
 * Fetches thread via getRelated RPC, renders flat (chronological) or tree (indented reply structure).
 */
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { SseClient } from "../sse-client.js";
import { esc, truncate } from "../util.js";
import { getAvailableSteps, requireStep } from "../rpc-registry.js";
import mermaid from "mermaid";

let mermaidInitialized = false;

const ThreadColumnSchema = z.object({ label: z.string().default(""), vertexId: z.string().default(""), mode: z.enum(["flat", "tree", "graph"]).default("flat"), loading: z.boolean().default(false), error: z.string().optional() });

type ThreadEdge = { type: string; targetId: string };
type ThreadVertex = Record<string, unknown> & { _id: string; _inReplyTo?: string; _edges?: ThreadEdge[] };

const STYLES = `
:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; }
.toolbar { display: flex; gap: 6px; align-items: center; padding: 4px 8px; background: #f5f5f5; border-bottom: 1px solid #ddd; flex: 0 0 auto; font-size: 12px; }
.toolbar button { padding: 1px 6px; border: 1px solid #ccc; border-radius: 3px; background: #fff; cursor: pointer; font-size: 11px; }
.toolbar button.active { background: #e8f5e9; border-color: #1a6b3c; color: #1a6b3c; }
.toolbar .count { margin-left: auto; color: #888; }
.thread-list { flex: 1; overflow: auto; padding: 4px; }
.thread-card { padding: 6px 8px; margin: 2px 0; border: 1px solid #eee; border-radius: 4px; cursor: pointer; }
.thread-card:hover { background: #f8f8f8; border-color: #ccc; }
.thread-card.current { background: #e8f5e9; border-color: #1a6b3c; }
.thread-card .meta { display: flex; gap: 8px; font-size: 11px; color: #888; }
.thread-card .sender { color: #333; font-weight: 500; }
.thread-card .subject { color: #555; margin-top: 2px; }
.thread-card .preview { color: #777; margin-top: 2px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.indent { margin-left: 20px; border-left: 2px solid #ddd; padding-left: 4px; }
.empty { padding: 16px; color: #888; text-align: center; }
.graph-container { flex: 1; overflow: auto; padding: 8px; }
.error { padding: 8px; color: #c62828; background: #ffebee; border-radius: 4px; margin: 8px; }
`;

export class ShuThreadColumn extends ShuElement<typeof ThreadColumnSchema> {
	private thread: ThreadVertex[] = [];

	constructor() {
		super(ThreadColumnSchema, { label: "", vertexId: "", mode: "flat", loading: false });
	}

	async open(label: string, id: string): Promise<void> {
		this.setState({ label, vertexId: id, loading: true, error: undefined });
		try {
			await getAvailableSteps();
			const client = SseClient.for("");
			const data = await client.rpc<{ items: ThreadVertex[]; contextRoot: string }>(requireStep("getRelated"), { label, id });
			this.thread = data.items ?? [];
			this.setState({ loading: false });
		} catch (err) {
			this.setState({ loading: false, error: err instanceof Error ? err.message : String(err) });
		}
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		const { mode, loading, error } = this.state;

		if (loading) {
			this.shadowRoot.innerHTML = `${this.css(STYLES)}<div class="empty">Loading thread...</div>`;
			return;
		}
		if (error) {
			this.shadowRoot.innerHTML = `${this.css(STYLES)}<div class="error">${esc(error)}</div>`;
			return;
		}
		if (this.thread.length === 0) {
			this.shadowRoot.innerHTML = `${this.css(STYLES)}<div class="empty">No thread found.</div>`;
			return;
		}

		const contentHtml = mode === "graph" ? '<div class="graph-container"></div>' : `<div class="thread-list">${mode === "flat" ? this.renderFlat() : this.renderTree()}</div>`;
		this.shadowRoot.innerHTML = `${this.css(STYLES)}
			<div class="toolbar">
				<button class="mode-btn${mode === "flat" ? " active" : ""}" data-mode="flat">Flat</button>
				<button class="mode-btn${mode === "tree" ? " active" : ""}" data-mode="tree">Tree</button>
				<button class="mode-btn${mode === "graph" ? " active" : ""}" data-mode="graph">Graph</button>
				<span class="count">${this.thread.length} relations</span>
			</div>
			${contentHtml}`;
		if (mode === "graph") void this.renderGraph();

		this.shadowRoot.querySelectorAll(".mode-btn").forEach((btn) => {
			btn.addEventListener("click", () => this.setState({ mode: (btn as HTMLElement).dataset.mode as "flat" | "tree" | "graph" }));
		});
		this.shadowRoot.querySelectorAll(".thread-card").forEach((card) => {
			card.addEventListener("click", () => {
				const id = (card as HTMLElement).dataset.id;
				const cardLabel = (card as HTMLElement).dataset.label || this.state.label;
				if (id) this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_OPEN, { detail: { subject: id, label: cardLabel }, bubbles: true, composed: true }));
			});
		});

		const current = this.shadowRoot.querySelector(".thread-card.current");
		if (current) current.scrollIntoView({ block: "center" });
	}

	private renderFlat(): string {
		return this.thread.map((v) => this.renderCard(v, 0)).join("");
	}

	private renderTree(): string {
		const childMap = new Map<string, ThreadVertex[]>();
		const roots: ThreadVertex[] = [];
		const idSet = new Set(this.thread.map((t) => t._id));
		for (const v of this.thread) {
			const parentId = (v as Record<string, unknown>)._inReplyTo ? String((v as Record<string, unknown>)._inReplyTo) : "";
			if (parentId && idSet.has(parentId)) {
				const children = childMap.get(parentId) ?? [];
				children.push(v);
				childMap.set(parentId, children);
			} else {
				roots.push(v);
			}
		}
		const renderBranch = (vertices: ThreadVertex[], depth: number): string => {
			return vertices.map((v) => {
				const children = childMap.get(v._id) ?? [];
				const childHtml = children.length > 0 ? `<div class="indent">${renderBranch(children, depth + 1)}</div>` : "";
				return this.renderCard(v, depth) + childHtml;
			}).join("");
		};
		return renderBranch(roots, 0);
	}

	private renderCard(v: ThreadVertex, _depth: number): string {
		const id = v._id;
		const isCurrent = id === this.state.vertexId;
		const sender = String(v.from ?? v.author ?? v.attributedTo ?? "");
		const subject = String(v.subject ?? v.name ?? v.topic ?? "");
		const date = String(v.dateSent ?? v.timestamp ?? v.published ?? "");
		const preview = String(v.body ?? v.text ?? v.content ?? "");
		const label = String((v as Record<string, unknown>)._label ?? this.state.label);
		const isAnnotation = label === "Annotation";
		return `<div class="thread-card${isCurrent ? " current" : ""}" data-id="${esc(id)}" data-label="${esc(label)}">
			<div class="meta">
				<span class="sender">${esc(sender || (isAnnotation ? "Annotation" : ""))}</span>
				<span>${esc(date)}</span>
			</div>
			${subject ? `<div class="subject">${esc(subject)}</div>` : ""}
			${preview ? `<div class="preview">${esc(truncate(preview, 120))}</div>` : ""}
		</div>`;
	}

	private async renderGraph(): Promise<void> {
		if (!mermaidInitialized) {
			mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "loose", fontFamily: "ui-sans-serif, system-ui, sans-serif" });
			mermaidInitialized = true;
		}
		const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, "_").substring(0, 20) || "node";
		const escLabel = (s: string) => s.replace(/"/g, "").replace(/'/g, "").replace(/[[\]{}()<>|#;&]/g, "").replace(/\n/g, " ");
		const threadIds = new Set(this.thread.map((v) => v._id));
		let src = "graph TD\n";
		for (const v of this.thread) {
			const id = sanitize(v._id);
			const vlabel = String((v as Record<string, unknown>)._label ?? this.state.label);
			const name = String(v.subject ?? v.name ?? v.text ?? v._id);
			const nodeLabel = escLabel(`${vlabel}: ${truncate(name, 30)}`);
			const isCurrent = v._id === this.state.vertexId;
			src += `  ${id}["${nodeLabel}"]\n`;
			if (isCurrent) src += `  style ${id} fill:#e8f5e9,stroke:#1a6b3c\n`;
			for (const edge of (v._edges ?? [])) {
				if (threadIds.has(edge.targetId)) {
					src += `  ${id} -->|${escLabel(edge.type)}| ${sanitize(edge.targetId)}\n`;
				}
			}
		}
		const container = this.shadowRoot?.querySelector(".graph-container");
		if (!container) return;
		try {
			const { svg } = await mermaid.render(`thread-graph-${Date.now()}`, src);
			container.innerHTML = svg;
		} catch (err) {
			container.innerHTML = `<pre style="color:red">${err instanceof Error ? err.message : err}</pre>`;
		}
	}
}
