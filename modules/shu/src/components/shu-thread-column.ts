/**
 * <shu-thread-column> — Displays a conversation thread for any individual type with inReplyTo edges.
 * Fetches thread via getRelated RPC, renders flat (chronological) or tree (indented reply structure).
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { shuBaseStyles } from "./styles.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { idOf, persistedTypeOf } from "../util.js";
import { ellipsize } from "@haibun/core/lib/util/index.js";
import { callStep } from "../pane-fetch.js";
import { getUiPresenting } from "../rels-cache.js";
import { ensureUiComponentLoaded } from "../external-components.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

/** What this column needs of a graph presenter: take a snapshot of quads and paint it. The site declares WHICH
 *  component that is (`ui.presents: "graph"`), so the column names no particular view. */
type GraphPresenter = HTMLElement & { setQuads(quads: TQuad[]): void };
import { COMMENT_LABEL, LinkRelations, isReplyEdge } from "@haibun/core/lib/resources.js";

const ThreadColumnSchema = z.object({
	label: z.string().default(""),
	individualId: z.string().default(""),
	mode: z.enum(["tree", "graph"]).default("tree"),
	depth: z.number().default(2),
	loading: z.boolean().default(false),
	error: z.string().optional(),
});

type ThreadEdge = { type: string; targetId: string };
type ThreadVertex = Record<string, unknown> & { _edges?: ThreadEdge[] };

/** Fold a product item's `_links` affordances into `_edges` so the tree/graph render reply structure. */
function normalizeItem(item: Record<string, unknown>): ThreadVertex {
	const existingEdges = (item._edges ?? []) as ThreadEdge[];
	const links = item._links as Record<string, { params?: Record<string, unknown> }> | undefined;
	const linkEdges: ThreadEdge[] = [];
	if (links)
		for (const [rel, link] of Object.entries(links)) {
			if (link.params) {
				const targetId = String(Object.values(link.params)[0] ?? "");
				if (targetId) linkEdges.push({ type: rel, targetId });
			}
		}
	const _edges = [...existingEdges, ...linkEdges];
	return { ...item, ...(_edges.length ? { _edges } : {}) };
}

export class ShuThreadColumn extends ShuElement<typeof ThreadColumnSchema> {
	/** A conversation thread as an ordered collection: each item's public fields plus the reply it answers. */
	summarizeForKihan(): TLinkedData | null {
		if (this.thread.length === 0) return null;
		const items = this.thread.map((v) => {
			const inReplyTo = (v._edges ?? []).find((e) => isReplyEdge(e.type))?.targetId;
			const fields = Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith("_")));
			return inReplyTo ? { ...fields, inReplyTo } : fields;
		});
		return { "@id": "view:thread", "@type": "as:OrderedCollection", name: `a conversation thread of ${items.length} items`, totalItems: items.length, items };
	}

	static styles = [
		shuBaseStyles,
		css`
			:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; font-family: var(--shu-font-family); font-size: var(--shu-font-md); }
			.toolbar { display: flex; gap: var(--shu-space-3); align-items: center; padding: var(--shu-space-2) var(--shu-space-4); flex: 0 0 auto; font-size: var(--shu-font-md);
				background: var(--shu-bg-soft); border-bottom: var(--shu-border-w) solid var(--shu-border); }
			.toolbar button { padding: 1px var(--shu-space-3); border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); cursor: pointer;
				font-size: var(--shu-font-sm); background: var(--shu-bg); }
			:host(:not([data-show-controls])) .toolbar { display: none; }
			.toolbar button.active { background: var(--shu-accent); border-color: var(--shu-accent); color: var(--shu-accent-fg); }
			.toolbar .count { margin-left: auto; color: var(--shu-fg-muted); }
			.thread-list { flex: 1; overflow: auto; padding: var(--shu-space-2); }
			.thread-card { padding: var(--shu-space-3) var(--shu-space-4); margin: var(--shu-space-1) 0; border-radius: var(--shu-radius); cursor: pointer;
				border: var(--shu-border-w) solid var(--shu-border); }
			.thread-card:hover { background: var(--shu-bg-hover); border-color: var(--shu-border-strong); }
			.thread-card.current { background: var(--shu-accent-soft); border-color: var(--shu-accent); }
			/* The item's @type, so a mixed thread (a Comment replying to a File, etc.) reads its kinds at a glance. */
			/* The badge's background is a THEME surface, not a type-colour swatch, so its text is the ordinary foreground —
			   the swatch colour is dark in both themes and would be dark-on-dark here. */
			.thread-card .type-badge { display: inline-block; font-size: var(--shu-font-sm); color: var(--shu-fg); background: var(--shu-bg-soft); border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); padding: 0 var(--shu-space-2); margin-bottom: var(--shu-space-1); }
			.thread-card .meta { display: flex; gap: var(--shu-space-4); font-size: var(--shu-font-sm); color: var(--shu-fg-muted); }
			.thread-card .sender { color: var(--shu-fg); font-weight: 500; }
			.thread-card .subject { color: var(--shu-fg-muted); margin-top: var(--shu-space-1); }
			.thread-card .preview { color: var(--shu-fg-muted); margin-top: var(--shu-space-1); font-size: var(--shu-font-md); overflow: hidden; text-overflow: ellipsis;
				white-space: nowrap; }
			.indent { margin-left: 20px; border-left: 2px solid var(--shu-border); padding-left: var(--shu-space-2); }
			.extra-fields { display: flex; flex-wrap: wrap; gap: var(--shu-space-2) var(--shu-space-5); margin-top: var(--shu-space-1); font-size: var(--shu-font-sm); }
			.extra-field { color: var(--shu-fg-muted); }
			.field-label { color: var(--shu-fg-faded); }
			.field-label::after { content: ":"; }
			.empty { padding: var(--shu-space-6); color: var(--shu-fg-muted); text-align: center; }
			.content-area { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
			.graph-container { flex: 1; overflow: auto; padding: var(--shu-space-4); min-height: 0; }
			.error { padding: var(--shu-space-4); color: var(--shu-error); background: var(--shu-bg-error-soft); border-radius: var(--shu-radius); margin: var(--shu-space-4); }
		`,
	];

	private thread: ThreadVertex[] = [];
	private graphViewEl: GraphPresenter | null = null;

	constructor() {
		super(ThreadColumnSchema, { label: "", individualId: "", mode: "tree", depth: 2, loading: false });
	}

	override refresh(): void {
		if (this.graphViewEl) {
			if (this.showControls) this.graphViewEl.setAttribute("data-show-controls", "");
			else this.graphViewEl.removeAttribute("data-show-controls");
		}
	}

	/** Render items directly without RPC fetch. Items are JSON-LD nodes (`@id`/`@type`), optionally with `_edges`. */
	openItems(items: ThreadVertex[], label = "Result"): void {
		this.thread = items;
		this.setState({ label, individualId: "", loading: false });
	}

	/** Render a collection product: its `items` become thread vertices (links folded into edges), no RPC fetch. */
	openProducts(products: Record<string, unknown>): void {
		const items = Array.isArray(products.items) ? (products.items as Record<string, unknown>[]) : [];
		this.openItems(items.map(normalizeItem), String(products._type || "Result"));
	}

	async open(label: string, id: string, depth?: number): Promise<void> {
		if (depth !== undefined) this.state = { ...this.state, depth };
		this.setState({ label, individualId: id, loading: true, error: undefined });
		const res = await callStep<{ items: ThreadVertex[]; contextRoot: string }>("getRelated", { label, id, depth: this.state.depth }, `thread-column: open ${label}:${id}`);
		if (!res.ok) {
			this.setState({ loading: false, error: res.error });
			return;
		}
		this.thread = res.value.items ?? [];
		this.setState({ loading: false });
	}

	private onModeClick = (mode: "tree" | "graph") => (): void => {
		this.setState({ mode });
	};

	private onDepthChange = (e: Event): void => {
		const newDepth = parseInt((e.target as HTMLInputElement).value, 10);
		if (newDepth > 0 && this.state.individualId) void this.open(this.state.label, this.state.individualId, newDepth);
	};

	private onCardClick =
		(id: string, cardLabel: string) =>
		(e: Event): void => {
			const me = e as MouseEvent;
			this.dispatchEvent(
				new CustomEvent(SHU_EVENT.COLUMN_OPEN, {
					detail: { subject: id, label: cardLabel, addToSelection: me.ctrlKey || me.shiftKey || me.metaKey },
					bubbles: true,
					composed: true,
				}),
			);
		};

	protected updated(): void {
		if (this.state.mode !== "graph" || this.state.loading || this.state.error || this.thread.length === 0) {
			this.graphViewEl = null;
			return;
		}
		const container = this.shadowRoot?.querySelector(".graph-container") as HTMLElement | null;
		if (!container) return;
		const tag = ShuThreadColumn.graphPresenter();
		if (!tag) return;
		if (!container.firstElementChild) void this.mountPresenter(container, tag);
		this.graphViewEl?.setQuads(this.threadToQuads());
	}

	/** The component the site declares as its graph, or undefined where a deployment declares none. */
	private static graphPresenter(): string | undefined {
		const component = getUiPresenting("graph")?.ui.component;
		return typeof component === "string" ? component : undefined;
	}

	/** Mount the declared presenter in external-data mode: this column feeds it the thread, and it wires nothing of
	 *  its own. Its module is fetched through the shared loader, exactly as a pane mounts a site component. */
	private async mountPresenter(container: HTMLElement, tag: string): Promise<void> {
		if (!customElements.get(tag)) await ensureUiComponentLoaded(tag);
		if (container.firstElementChild) return; // a second update mounted it while the module loaded
		const view = document.createElement(tag) as GraphPresenter;
		view.setAttribute("data-external", "");
		view.setAttribute("data-classifier", "thread");
		if (this.showControls) view.setAttribute("data-show-controls", "");
		view.style.height = "100%";
		container.appendChild(view);
		this.graphViewEl = view;
		view.setQuads(this.threadToQuads());
	}

	render(): TemplateResult {
		const { mode, loading, error, depth } = this.state;
		if (loading) return html`<div class="empty">Loading thread...</div>`;
		if (error) return html`<div class="error">${error}</div>`;
		if (this.thread.length === 0) return html`<div class="empty">No thread found.</div>`;
		return html`
			<div class="toolbar">
				<button class=${`mode-btn${mode === "tree" ? " active" : ""}`} @click=${this.onModeClick("tree")}>Tree</button>
				${ShuThreadColumn.graphPresenter() ? html`<button class=${`mode-btn${mode === "graph" ? " active" : ""}`} @click=${this.onModeClick("graph")}>Graph</button>` : ""}
				<label>depth <input type="number" .value=${String(depth)} min="1" max="99" style="width:40px" @change=${this.onDepthChange}></label>
				<span class="count">${this.thread.length} items</span>
			</div>
			<div class="content-area">${mode === "graph" ? html`<div class="graph-container"></div>` : html`<div class="thread-list">${this.renderTreeTemplate()}</div>`}</div>
		`;
	}

	private renderTreeTemplate(): TemplateResult {
		const childMap = new Map<string, ThreadVertex[]>();
		const roots: ThreadVertex[] = [];
		const idSet = new Set(this.thread.map((t) => idOf(t)));
		for (const v of this.thread) {
			const parentId = (v._edges ?? []).find((e) => isReplyEdge(e.type))?.targetId ?? "";
			if (parentId && idSet.has(parentId)) {
				const children = childMap.get(parentId) ?? [];
				children.push(v);
				childMap.set(parentId, children);
			} else roots.push(v);
		}
		const renderBranch = (vertices: ThreadVertex[]): TemplateResult =>
			html`${vertices.map((v) => {
				const children = childMap.get(idOf(v)) ?? [];
				return html`${this.renderCardTemplate(v)}${children.length > 0 ? html`<div class="indent">${renderBranch(children)}</div>` : ""}`;
			})}`;
		return renderBranch(roots);
	}

	private renderCardTemplate(v: ThreadVertex): TemplateResult {
		const id = idOf(v);
		const isCurrent = id === this.state.individualId;
		const label = persistedTypeOf(v) || this.state.label;
		const sender = String(v.from ?? v.author ?? v.attributedTo ?? "");
		const subject = String(v.subject ?? v.name ?? v.topic ?? "");
		const date = String(v.dateSent ?? v.generatedAtTime ?? v.published ?? "");
		const preview = String(v.body ?? v.text ?? v.content ?? "");
		const knownFields = new Set(["from", "author", "attributedTo", "subject", "name", "topic", "dateSent", "generatedAtTime", "published", "body", "text", "content"]);
		const hasKnownContent = !!(sender || subject || date || preview);
		const isComment = label === COMMENT_LABEL;
		const extraFields = Object.entries(v).filter(([k, val]) => !k.startsWith("_") && !k.startsWith("@") && !knownFields.has(k) && val !== undefined && val !== null && val !== "");
		return html`<div class=${`thread-card${isCurrent ? " current" : ""}`} data-id=${id} data-label=${label} @click=${this.onCardClick(id, label)}>
			${label ? html`<span class="type-badge" data-testid="thread-item-type">${label}</span>` : ""}
			${hasKnownContent ? html`<div class="meta"><span class="sender">${sender || (isComment ? COMMENT_LABEL : "")}</span><span>${date}</span></div>` : ""}
			${subject ? html`<div class="subject">${subject}</div>` : ""}
			${preview ? html`<div class="preview">${ellipsize(preview, 120)}</div>` : ""}
			${
				extraFields.length > 0
					? html`<div class="extra-fields">${extraFields.map(
							([k, val]) => html`<span class="extra-field"><span class="field-label">${k}</span> ${ellipsize(String(val), 80)}</span>`,
						)}</div>`
					: ""
			}
		</div>`;
	}

	/** Build quads from thread items. */
	private threadToQuads(): { subject: string; predicate: string; object: string; namedGraph: string; objectType?: string; timestamp: number }[] {
		const quads: { subject: string; predicate: string; object: string; namedGraph: string; objectType?: string; timestamp: number }[] = [];
		const now = Date.now();
		const labelById = new Map(this.thread.map((v) => [idOf(v), persistedTypeOf(v) || this.state.label]));
		for (const v of this.thread) {
			const id = idOf(v);
			const vlabel = persistedTypeOf(v) || this.state.label;
			const name = String(v.subject ?? v.name ?? v.text ?? id);
			quads.push({ subject: id, predicate: LinkRelations.NAME.rel, object: name, namedGraph: vlabel, timestamp: now });
			for (const edge of v._edges ?? []) {
				// Only emit edges where both endpoints exist in the thread
				if (labelById.has(edge.targetId)) {
					quads.push({ subject: id, predicate: edge.type, object: edge.targetId, namedGraph: vlabel, objectType: labelById.get(edge.targetId), timestamp: now });
				}
			}
		}
		return quads;
	}
}
