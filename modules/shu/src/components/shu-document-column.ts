/**
 * <shu-document-column> — the run as an academic-paper document: execution events rendered as headings, step lines,
 * prose, and embedded artifacts. The events are split into self-contained blocks (see document-blocks.ts) and rendered
 * through <shu-virtual-column>, so only the visible window is in the DOM no matter how long the run — the old
 * windowTail(500) cut that hid every earlier event behind "N earlier events are not shown" is gone. Time-cursor dimming,
 * click-to-scrub, jump-to-row from another view, and failed-step glyphs on the rail are all preserved. Product views are
 * embedded inside their block (once per element, so the virtualizer recycling a row does not re-open it).
 */
import { html, css, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { ref } from "lit/directives/ref.js";
import { z } from "zod";
import MarkdownIt from "markdown-it";
import { getWindowSize } from "./shu-window-size.js";
import DOMPurify from "dompurify";
import { ShuElement, TIME_SYNC_CLASS, type TLinkedData } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { EventsController } from "../controllers/index.js";
import { shuBaseStyles } from "./styles.js";
import { buildArtifactIndex, generateDocumentMarkdown } from "@haibun/core/lib/document-content.js";
import "./shu-artifact-frame.js";
import "./shu-virtual-column.js";
import { virtualColumnCss } from "./shu-virtual-column.js";
import { arrayWindowedSource, type WindowedSource } from "../windowed-source.js";
import { splitDocumentBlocks, finalizeBlocks, currentBlockIndex, blockTimeClass, type TDocBlock } from "../document-blocks.js";
import type { TScrollMarker } from "../scrollbar-model.js";
import type { THaibunEvent, TArtifactEvent, THaibunLogLevel } from "@haibun/core/schema/protocol.js";
import { HAIBUN_LOG_LEVELS } from "@haibun/core/schema/protocol.js";
import { esc } from "../util.js";
import { getRels, getUiByType } from "../rels-cache.js";
import { isStandaloneMode } from "../rpc-registry.js";
import { refLinksPlugin } from "../markdown-refs.js";

const DocumentColumnSchema = z.object({
	level: z.enum(HAIBUN_LOG_LEVELS).default("log"),
});

const mdRenderer = new MarkdownIt({ html: true, linkify: true, typographer: true });
// A `#Type` / `#Type:id` link in prose opens the type or individual in a column (shu-ref), never navigating the page.
refLinksPlugin(mdRenderer, (name) => getRels(name) !== undefined);

const SANITIZE_OPTS = {
	// `kind`/`linktarget`/`text` carry the shu-ref reference (a `#Type` link the refLinksPlugin rewrote); DOMPurify
	// lowercases attribute names, so `linkTarget` is allowlisted as `linktarget`.
	ADD_ATTR: ["style", "data-depth", "data-nested", "data-instigator", "data-show-symbol", "data-id", "data-time", "data-raw-time", "data-action", "data-has-artifacts", "data-ids", "kind", "linktarget", "text"],
	ADD_TAGS: ["div", "shu-ref"],
};

const stripId = (id: string): string => id.replace(/^\[|\]$/g, "");

export class ShuDocumentColumn extends ShuElement<typeof DocumentColumnSchema> {
	#events = new EventsController(this, () => this.onEventsChanged());
	#source: WindowedSource<TDocBlock> & { set(items: readonly TDocBlock[], markers?: TScrollMarker[]): void } = arrayWindowedSource<TDocBlock>([]);
	#blocks: TDocBlock[] = [];
	#productsById = new Map<string, Record<string, unknown>>();
	#productViews = new WeakMap<Element, string>();
	private startTime = 0;
	private endTime = 0;
	#currentIdx = -1;

	static styles = [
		shuBaseStyles,
		virtualColumnCss,
		css`
			:host { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; font-family: "Source Serif 4", Georgia, serif; font-size: 15px; line-height: 1.7; color: var(--shu-fg); }
			/* Each block centres itself in a reading column (the old .document-body 80%-centred layout, per row now). */
			.doc-block { max-width: 760px; margin: 0 auto; padding: 0 1.5rem; }
			h1 { font-size: 1.75rem; font-weight: 700; margin: 1.5rem 0 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid var(--shu-border); }
			h2 { font-size: 1.35rem; font-weight: 600; margin: 1.25rem 0 0.75rem; color: var(--shu-fg-muted); }
			h3 { font-size: 1.1rem; font-weight: 600; margin: 1rem 0 0.5rem; color: var(--shu-fg-muted); }
			p { margin: 0.5em 0; }
			a { color: var(--shu-link); text-decoration: none; }
			a:hover { text-decoration: underline; }
			.doc-row { padding: var(--shu-space-2) var(--shu-space-4); border-radius: var(--shu-radius); cursor: pointer; transition: background 0.15s; }
			.doc-row:hover { background: var(--shu-bg-hover); }
			.log-row { font-family: "Source Code Pro", ui-monospace, monospace; font-size: 0.9rem; font-weight: 500; color: var(--shu-fg); line-height: 1.5; border-left: 2px solid transparent; padding: var(--shu-space-2) 0; margin-left: 32px; }
			.log-row.nested { border-left-color: var(--shu-border); margin-left: 32px; padding-left: var(--shu-space-3); }
			.log-row.show-connector { position: relative; }
			.log-row.show-connector::before { content: ""; position: absolute; left: -1px; top: 0; width: 8px; height: 1px; background: var(--shu-border); }
			.h-1 { height: 12px; }
			.prose-block { font-size: 15px; }
			.header-block { margin-top: 0.5rem; }
			.artifact { margin: var(--shu-space-4) 0 var(--shu-space-4) 32px; }
			.json-block { font-family: "Source Code Pro", monospace; font-size: var(--shu-font-sm); background: var(--shu-bg-soft); border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); padding: var(--shu-space-4) var(--shu-space-5); overflow-x: auto; white-space: pre-wrap; max-height: 300px; overflow-y: auto; }
			img { display: block; }
			.feature-artifacts, .standalone-artifact { margin-left: 32px; }
			.thumb-row { display: flex; flex-flow: row wrap; align-items: flex-start; gap: var(--shu-space-2); margin-left: 32px; }
			.thumb-row > * { margin: 0; }
			shu-artifact-frame { margin: var(--shu-space-3) 0; }
			.doc-controls { padding: var(--shu-space-2) var(--shu-space-4); font-size: var(--shu-font-sm); color: var(--shu-fg-muted); flex-shrink: 0; }
			:host(:not([data-show-controls])) .doc-controls { display: none; }
		`,
	];

	/** The shared event log (ShuEventConsumer owns backfill + live merge + dedup). Read-only here; the document renders from it. */
	private get events(): THaibunEvent[] {
		return this.#events.all as unknown as THaibunEvent[];
	}

	constructor() {
		super(DocumentColumnSchema, { level: "log" });
	}

	/** The run document as an as:Document, with the whole log rendered to markdown (mirrors what the column shows). */
	summarizeForKihan(): TLinkedData | null {
		if (this.events.length === 0) return null;
		const { md } = generateDocumentMarkdown(this.events, buildArtifactIndex(this.events).artifactsByStep, this.state.level as THaibunLogLevel, this.startTime);
		return { "@id": "view:document-log", "@type": "as:Document", name: "the run document shown in this column, as markdown", content: md };
	}

	private onEventsChanged(): void {
		this.#rebuild();
	}

	protected override onConnected(): void {
		// A framed row a reader clicked in another view asks the document to scrub to that instant and reveal the row.
		this.autoListen(this, SHU_EVENT.CURSOR_TO_ROW, (e) => this.jumpToRow((e as CustomEvent<{ row: Element }>).detail.row));
		// Re-render on a window-size change: the shared log re-windows, changing what `events` holds.
		let first = true;
		this.updateEffect(() => {
			getWindowSize();
			if (first) {
				first = false;
				return;
			}
			this.#rebuild();
		});
	}

	protected override onTimeSync(): void {
		this.requestUpdate(); // renderRow recomputes each block's past/current/future class
	}

	/** Re-derive the whole document from the current log: recompute the time span, split the generated HTML into blocks,
	 *  finalize them (fill artifacts, add classes, group thumbnails), index this run's product steps, and hand the blocks
	 *  and failed-step marks to the source. Rebuilding the block list (strings) is safe under virtualization — only the
	 *  visible rows re-render, so no embedded component is destroyed the way re-setting one big innerHTML used to. */
	#rebuild(): void {
		this.#recomputeTimes();
		this.#productsById = this.getProductsByStepId(this.events);
		const html = DOMPurify.sanitize(mdRenderer.render(generateDocumentMarkdown(this.events, buildArtifactIndex(this.events).artifactsByStep, this.state.level as THaibunLogLevel, this.startTime).md), SANITIZE_OPTS);
		this.#blocks = finalizeBlocks(splitDocumentBlocks(html), (id) => this.#resolveArtifact(id));
		this.#source.set(this.#blocks, this.#buildMarkers(this.#blocks));
		this.requestUpdate();
	}

	#recomputeTimes(): void {
		let start = 0;
		let end = 0;
		for (const e of this.events) {
			const ts = e.timestamp;
			if (!ts) continue;
			if (!start || ts < start) start = ts;
			if (ts > end) end = ts;
		}
		this.startTime = start;
		this.endTime = end;
	}

	#resolveArtifact(id: string): string {
		const artifact = this.events.find((e) => e.id === id) as TArtifactEvent | undefined;
		return artifact ? this.renderArtifact(artifact) : "";
	}

	/** A mark on the rail for every failed step, so a reader jumps to a failure in a long run without scrolling for it. */
	#buildMarkers(blocks: TDocBlock[]): TScrollMarker[] {
		const failed = new Set(
			this.events.filter((e) => e.kind === "lifecycle" && (e as Record<string, unknown>).stage === "end" && (e as Record<string, unknown>).status === "failed").map((e) => stripId(e.id)),
		);
		const markers: TScrollMarker[] = [];
		blocks.forEach((b, i) => {
			if (b.id && failed.has(stripId(b.id))) markers.push({ index: i, id: b.id, icon: "❌", color: "#ef4444", label: "failed step" });
		});
		return markers;
	}

	/** Scrub the global time cursor to a block's instant and highlight it here; never scrolls (a click lands on a row in
	 *  view). The latest instant is the live edge — a cursor at or past the end shows everything, like the slider at its end. */
	private cursorToRow(rawTime: number): void {
		const absTime = this.startTime + rawTime;
		this.timeCursor = absTime >= this.endTime ? null : absTime; // the setter fires onTimeSync → requestUpdate
		this.requestUpdate(); // refresh even when the value is unchanged (the setter no-ops an equal value)
	}

	/** A jump-to from another view: scrub to the row AND scroll it into view — the one deliberate scroll. */
	private jumpToRow(row: Element): void {
		const id = row.getAttribute("data-id") ?? "";
		const idx = this.#blocks.findIndex((b) => b.id !== "" && b.id === id);
		if (idx < 0) return;
		this.cursorToRow(this.#blocks[idx].rawTime);
		const vc = this.shadowRoot?.querySelector("shu-virtual-column") as (HTMLElement & { scrollToIndex?: (i: number, p?: string) => void }) | null;
		vc?.scrollToIndex?.(idx, "center");
	}

	render(): TemplateResult {
		this.#currentIdx = currentBlockIndex(this.#blocks, this.startTime, this.timeCursor);
		return html`
			<div class="doc-controls">
				<label>level <select @change=${this.onLevelChange}>
					${HAIBUN_LOG_LEVELS.map((l) => html`<option value=${l} ?selected=${l === this.state.level}>${l}</option>`)}
				</select></label>
			</div>
			<shu-virtual-column .source=${this.#source} .renderRow=${(i: number, b: unknown) => this.#renderRow(i, b)} ?follow=${true}></shu-virtual-column>
		`;
	}

	#renderRow = (i: number, block: unknown): TemplateResult => {
		const b = block as TDocBlock | undefined;
		if (!b) return html`<div class="doc-block" aria-hidden="true"></div>`;
		const t = blockTimeClass(b, i, this.startTime, this.timeCursor, this.#currentIdx);
		const cls = `doc-block${t === "future" ? ` ${TIME_SYNC_CLASS.FUTURE}` : t === "current" ? ` ${TIME_SYNC_CLASS.CURRENT}` : ""}`;
		const products = b.id ? this.#productsById.get(stripId(b.id)) : undefined;
		return html`<div class=${cls} data-id=${b.id} @click=${() => this.cursorToRow(b.rawTime)}>
			${unsafeHTML(b.html)}${products ? this.#productViewFor(products, b.rawTime) : ""}
		</div>`;
	};

	/** A product a step produced, embedded in its block. The ref opens it once per (element, product) so the virtualizer
	 *  recycling this row for another block does not re-open the previous product. */
	#productViewFor(products: Record<string, unknown>, rawTime: number): TemplateResult {
		const snapshotTime = this.startTime + rawTime;
		return html`<shu-artifact-frame caption=${String(products._summary ?? products._type ?? "")}
			><shu-product-view style="max-height:400px;overflow:auto" ${ref((el) => this.#openProductOnce(el as HTMLElement | undefined, products, snapshotTime))}></shu-product-view
		></shu-artifact-frame>`;
	}

	#openProductOnce(el: HTMLElement | undefined, products: Record<string, unknown>, snapshotTime: number): void {
		if (!el) return;
		const key = `${String(products._component ?? products._type ?? "")}:${snapshotTime}`;
		if (this.#productViews.get(el) === key) return;
		this.#productViews.set(el, key);
		if (this.showControls) el.setAttribute("data-show-controls", "");
		(el as HTMLElement & { openProducts?: (p: Record<string, unknown>, t?: number) => void }).openProducts?.(products, snapshotTime);
	}

	/** Refresh embedded product views' controls state (the pane gear). */
	override refresh(): void {
		for (const v of Array.from(this.shadowRoot?.querySelectorAll("shu-artifact-frame shu-product-view") ?? []) as (HTMLElement & { refresh?: () => void })[]) {
			if (this.showControls) v.setAttribute("data-show-controls", "");
			else v.removeAttribute("data-show-controls");
			v.refresh?.();
		}
	}

	/** Build a map of step ID → products from lifecycle end events, only for steps after show document. */
	private getProductsByStepId(events: THaibunEvent[]): Map<string, Record<string, unknown>> {
		let documentShowTime = 0;
		for (const e of events) {
			if (e.kind !== "lifecycle") continue;
			const products = (e as Record<string, unknown>).products as Record<string, unknown> | undefined;
			if (products?._component === "shu-document-column") {
				documentShowTime = e.timestamp;
				break;
			}
		}
		const map = new Map<string, Record<string, unknown>>();
		for (const e of events) {
			if (e.kind !== "lifecycle" || (e as Record<string, unknown>).stage !== "end") continue;
			if (documentShowTime && e.timestamp < documentShowTime) continue;
			const products = (e as Record<string, unknown>).products as Record<string, unknown> | undefined;
			if (!products || (!products._component && !products._type)) continue;
			const typeStr = products._type as string | undefined;
			if (typeStr) {
				const ui = getUiByType(typeStr);
				if (ui?.pinnedOnly) continue;
			}
			if (products._component === "shu-document-column") continue;
			map.set(stripId(e.id), products);
		}
		return map;
	}

	private renderArtifact(artifact: TArtifactEvent): string {
		const type = artifact.artifactType;
		const a = artifact as Record<string, unknown>;
		// Serialized (file://): shu.html sits in the feature dir, so reference artifacts by their feature-relative path
		// (e.g. ./image/x.png). The emitter supplies `featureRelativePath`; the fallback derives it by dropping the
		// leading `featn-N/` segment of the base-relative `path`. Live: the /artifacts route serves the base-relative `path`.
		const url = a.url as string | undefined;
		const base = a.path ? String(a.path).replace(/^\.?\//, "") : undefined;
		const featureRelativeFallback = base ? `./${base.split("/").slice(1).join("/")}` : undefined;
		const artifactPath = isStandaloneMode() ? ((a.featureRelativePath as string | undefined) ?? url ?? featureRelativeFallback) : (url ?? (base ? `/artifacts/${base}` : undefined));
		if (type === "image") {
			return `<shu-artifact-frame class="thumb"><img src="${esc(String(artifactPath))}" loading="lazy" /></shu-artifact-frame>`;
		}
		if (type === "html") return `<shu-artifact-frame><iframe src="${esc(String(artifactPath))}" loading="lazy" sandbox="allow-scripts allow-same-origin" style="width:100%;min-height:80vh;border:none;"></iframe></shu-artifact-frame>`;
		if (type === "json") return `<shu-artifact-frame><pre class="json-block">${esc(JSON.stringify(a.json, null, 2))}</pre></shu-artifact-frame>`;
		if (type === "file") return `<shu-artifact-frame caption="${esc(String(a.path))}"><a href="${esc(String(a.path))}">${esc(String(a.path))}</a></shu-artifact-frame>`;
		return "";
	}

	private onLevelChange(e: Event): void {
		this.setState({ level: (e.target as HTMLSelectElement).value as THaibunLogLevel });
		this.#rebuild(); // the visible event set changes with the level
	}
}
