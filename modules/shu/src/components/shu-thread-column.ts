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
import type { ShuGraphView } from "./shu-graph-view.js";

const ThreadColumnSchema = z.object({
	label: z.string().default(""),
	vertexId: z.string().default(""),
	mode: z.enum(["tree", "graph"]).default("tree"),
	depth: z.number().default(2),
	loading: z.boolean().default(false),
	error: z.string().optional(),
});

type ThreadEdge = { type: string; targetId: string };
type ThreadVertex = Record<string, unknown> & { _id: string; _inReplyTo?: string; _edges?: ThreadEdge[] };

const STYLES = `
:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; }
.toolbar { display: flex; gap: 6px; align-items: center; padding: 4px 8px; background: #f5f5f5; border-bottom: 1px solid #ddd; flex: 0 0 auto; font-size: 12px; }
.toolbar button { padding: 1px 6px; border: 1px solid #ccc; border-radius: 3px; background: #fff; cursor: pointer; font-size: 11px; }
:host(:not([data-show-controls])) .toolbar { display: none; }
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
.extra-fields { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 3px; font-size: 11px; }
.extra-field { color: #555; }
.field-label { color: #999; }
.field-label::after { content: ":"; }
.empty { padding: 16px; color: #888; text-align: center; }
.content-area { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.graph-container { flex: 1; overflow: auto; padding: 8px; min-height: 0; }
.error { padding: 8px; color: #c62828; background: #ffebee; border-radius: 4px; margin: 8px; }
`;

export class ShuThreadColumn extends ShuElement<typeof ThreadColumnSchema> {
	private thread: ThreadVertex[] = [];
	private relatedQuads: Record<string, unknown>[] = [];
	private graphViewEl: ShuGraphView | null = null;

	constructor() {
		super(ThreadColumnSchema, { label: "", vertexId: "", mode: "tree", depth: 2, loading: false });
	}

	override refresh(): void {
		if (this.graphViewEl) {
			if (this.showControls) this.graphViewEl.setAttribute("data-show-controls", "");
			else this.graphViewEl.removeAttribute("data-show-controls");
		}
	}

	/** Render items directly without RPC fetch. Items should have _id and optionally _inReplyTo, _edges. */
	openItems(items: ThreadVertex[], label = "Result"): void {
		this.thread = items;
		this.setState({ label, vertexId: "", loading: false });
	}

	async open(label: string, id: string, depth?: number): Promise<void> {
		if (depth !== undefined) this.state = { ...this.state, depth };
		this.setState({ label, vertexId: id, loading: true, error: undefined });
		try {
			await getAvailableSteps();
			const client = SseClient.for("");
			const data = await client.rpc<{ items: ThreadVertex[]; quads?: Record<string, unknown>[]; contextRoot: string }>(
				requireStep("getRelated"), { label, id, depth: this.state.depth },
			);
			this.thread = data.items ?? [];
			this.relatedQuads = data.quads ?? [];
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

		const { depth } = this.state;
		const depthOptions = [1, 2, 3, 5].map((d) => `<option value="${d}"${d === depth ? " selected" : ""}>${d}</option>`).join("");
		const toolbar = `<div class="toolbar">
			<button class="mode-btn${mode === "tree" ? " active" : ""}" data-mode="tree">Tree</button>
			<button class="mode-btn${mode === "graph" ? " active" : ""}" data-mode="graph">Graph</button>
			<label>depth <select data-action="depth">${depthOptions}</select></label>
			<span class="count">${this.thread.length} items</span>
		</div>`;
		this.shadowRoot.innerHTML = `${this.css(STYLES)}${toolbar}<div class="content-area"></div>`;
		const contentArea = this.shadowRoot.querySelector(".content-area") as HTMLElement;

		if (mode === "graph") {
			contentArea.innerHTML = '<div class="graph-container"></div>';
			const gv = document.createElement("shu-graph-view") as ShuGraphView;
			gv.setAttribute("data-source", "external");
			// Use real quads from getRelated (browser classifier), or synthesized quads from openItems (thread classifier)
			if (this.relatedQuads.length > 0) {
				// Real quads from the quad store — use browser classifier
			} else {
				gv.setAttribute("data-classifier", "thread");
			}
			if (this.showControls) gv.setAttribute("data-show-controls", "");
			gv.style.height = "100%";
			(contentArea.querySelector(".graph-container") as HTMLElement).appendChild(gv);
			const quads = this.relatedQuads.length > 0 ? this.relatedQuads : this.threadToQuads();
			requestAnimationFrame(() => gv.setQuads(quads as Parameters<ShuGraphView["setQuads"]>[0]));
			this.graphViewEl = gv;
		} else {
			this.graphViewEl = null;
			this.graphViewEl = null;
			contentArea.innerHTML = `<div class="thread-list">${this.renderTree()}</div>`;
			contentArea.querySelectorAll(".thread-card").forEach((card) => {
				card.addEventListener("click", () => {
					const id = (card as HTMLElement).dataset.id;
					const cardLabel = (card as HTMLElement).dataset.label || this.state.label;
					if (id) this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_OPEN, { detail: { subject: id, label: cardLabel }, bubbles: true, composed: true }));
				});
			});
			const current = contentArea.querySelector(".thread-card.current");
			if (current) current.scrollIntoView({ block: "center" });
		}

		this.shadowRoot.querySelectorAll(".mode-btn").forEach((btn) => {
			btn.addEventListener("click", () => this.setState({ mode: (btn as HTMLElement).dataset.mode as "tree" | "graph" }));
		});
		this.shadowRoot.querySelector("[data-action=depth]")?.addEventListener("change", (e) => {
			const newDepth = parseInt((e.target as HTMLSelectElement).value, 10);
			if (this.state.vertexId) void this.open(this.state.label, this.state.vertexId, newDepth);
		});
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
			return vertices
				.map((v) => {
					const children = childMap.get(v._id) ?? [];
					const childHtml = children.length > 0 ? `<div class="indent">${renderBranch(children, depth + 1)}</div>` : "";
					return this.renderCard(v, depth) + childHtml;
				})
				.join("");
		};
		return renderBranch(roots, 0);
	}

	private renderCard(v: ThreadVertex, _depth: number): string {
		const id = v._id;
		const isCurrent = id === this.state.vertexId;
		const label = String((v as Record<string, unknown>)._label ?? this.state.label);

		// Known semantic fields for messaging/annotation card layout
		const sender = String(v.from ?? v.author ?? v.attributedTo ?? "");
		const subject = String(v.subject ?? v.name ?? v.topic ?? "");
		const date = String(v.dateSent ?? v.timestamp ?? v.published ?? "");
		const preview = String(v.body ?? v.text ?? v.content ?? "");
		const knownFields = new Set(["_id", "_inReplyTo", "_edges", "_label", "_type", "_links", "from", "author", "attributedTo", "subject", "name", "topic", "dateSent", "timestamp", "published", "body", "text", "content"]);
		const hasKnownContent = sender || subject || date || preview;

		// Extra fields not covered by the semantic slots
		const extraFields = Object.entries(v)
			.filter(([k, val]) => !k.startsWith("_") && !knownFields.has(k) && val !== undefined && val !== null && val !== "")
			.map(([k, val]) => `<span class="extra-field"><span class="field-label">${esc(k)}</span> ${esc(truncate(String(val), 80))}</span>`);

		const isAnnotation = label === "Annotation";
		const metaHtml = hasKnownContent ? `<div class="meta"><span class="sender">${esc(sender || (isAnnotation ? "Annotation" : ""))}</span><span>${esc(date)}</span></div>` : "";

		return `<div class="thread-card${isCurrent ? " current" : ""}" data-id="${esc(id)}" data-label="${esc(label)}">
			${metaHtml}
			${subject ? `<div class="subject">${esc(subject)}</div>` : ""}
			${preview ? `<div class="preview">${esc(truncate(preview, 120))}</div>` : ""}
			${extraFields.length > 0 ? `<div class="extra-fields">${extraFields.join("")}</div>` : ""}
		</div>`;
	}

	/** Build quads from thread items. */
	private threadToQuads(): { subject: string; predicate: string; object: string; namedGraph: string; timestamp: number }[] {
		const quads: { subject: string; predicate: string; object: string; namedGraph: string; timestamp: number }[] = [];
		const now = Date.now();
		const itemIds = new Set(this.thread.map((v) => v._id));
		for (const v of this.thread) {
			const vlabel = String((v as Record<string, unknown>).vertexLabel ?? (v as Record<string, unknown>)._label ?? this.state.label);
			const name = String(v.subject ?? v.name ?? v.text ?? v._id);
			quads.push({ subject: v._id, predicate: "name", object: name, namedGraph: vlabel, timestamp: now });
			for (const edge of v._edges ?? []) {
				// Only emit edges where both endpoints exist in the thread
				if (itemIds.has(edge.targetId)) {
					quads.push({ subject: v._id, predicate: edge.type, object: edge.targetId, namedGraph: vlabel, timestamp: now });
				}
			}
		}
		return quads;
	}

}
