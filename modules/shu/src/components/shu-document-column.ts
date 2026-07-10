/**
 * <shu-document-column> — Academic paper-style document view.
 * Renders test execution events as prose headings, technical details, and embedded artifacts.
 * Uses render-once + append strategy: initial backfill renders the full document,
 * SSE events append new rows incrementally. Embedded components are never destroyed.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import MarkdownIt from "markdown-it";
import { getWindowSize, windowTail } from "./shu-window-size.js";
import DOMPurify from "dompurify";
import { ShuElement, TIME_SYNC_CLASS } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { EventsController } from "../controllers/index.js";
import { FollowController } from "../timeline-follow.js";
import { shuBaseStyles } from "./styles.js";
import { groupThumbnailRows } from "../thumbnail-rows.js";
import { buildArtifactIndex, generateDocumentMarkdown } from "@haibun/core/lib/document-content.js";
import "./shu-artifact-frame.js";
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

/** The window-cut notice for a truncated document: a wavy rule, the count of earlier events not shown, and the
 * embedded window-size picker. Empty when the whole log fits. */
export function windowCutHtml(total: number, shown: number): string {
	const hidden = total - shown;
	if (hidden <= 0) return "";
	return `<div class="window-cut" data-testid="document-window-cut">${hidden === 1 ? "1 earlier event is" : `${hidden} earlier events are`} not shown. Show <shu-window-size></shu-window-size></div>`;
}

export class ShuDocumentColumn extends ShuElement<typeof DocumentColumnSchema> {
	#events = new EventsController(this, () => this.onEventsChanged());
	// :host is the scroll container (overflow: auto), so the shared live-edge follow uses the host itself.
	#follow = new FollowController(this, () => this);
	static styles = [
		shuBaseStyles,
		css`
		:host { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: auto; font-family: "Source Serif 4", Georgia, serif; font-size: 15px; line-height: 1.7; color: var(--shu-fg); }
		.document-body { width: 80%; margin: 0 auto; padding: 2rem 1.5rem; min-width: 0; }
		@media (max-width: 600px) { .document-body { width: 100%; } }
		h1 { font-size: 1.75rem; font-weight: 700; margin: 1.5rem 0 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid var(--shu-border); }
		h2 { font-size: 1.35rem; font-weight: 600; margin: 1.25rem 0 0.75rem; color: var(--shu-fg-muted); }
		h3 { font-size: 1.1rem; font-weight: 600; margin: 1rem 0 0.5rem; color: var(--shu-fg-muted); }
		p { margin: 0.5em 0; }
		a { color: var(--shu-link); text-decoration: none; }
		a:hover { text-decoration: underline; }
		/* The window cut: a wavy rule marking that the document picks up partway through the run, with the window-size
		   picker embedded so the reader can widen the window right there. */
		.window-cut { color: var(--shu-fg-muted); font-style: italic; text-align: center; margin: 0 0 1.25rem; }
		.window-cut::before { content: "〰〰〰〰〰〰"; display: block; color: var(--shu-border-strong); letter-spacing: 0.25em; line-height: 1.4; font-style: normal; }
		.window-cut shu-window-size { font-style: normal; vertical-align: middle; margin-left: var(--shu-space-1); }
		.doc-row { padding: var(--shu-space-2) var(--shu-space-4); border-radius: var(--shu-radius); cursor: pointer; transition: background 0.15s; }
		.doc-row:hover { background: var(--shu-bg-hover); }
		.log-row { font-family: "Source Code Pro", ui-monospace, monospace; font-size: 0.9rem; font-weight: 500; color: var(--shu-fg); line-height: 1.5; border-left: 2px solid transparent; padding: var(--shu-space-2) 0; margin-left: 32px; }
		/* Nesting is shown by the left rule, not extra indent, so a step and its screenshot keep a shared left edge. */
		.log-row.nested { border-left-color: var(--shu-border); margin-left: 32px; padding-left: var(--shu-space-3); }
		.log-row.show-connector { position: relative; }
		.log-row.show-connector::before { content: ""; position: absolute; left: -1px; top: 0; width: 8px; height: 1px; background: var(--shu-border); }
		.h-1 { height: 12px; }
		.prose-block { font-size: 15px; }
		.header-block { margin-top: 0.5rem; }
		.artifact { margin: var(--shu-space-4) 0 var(--shu-space-4) 32px; }
		.json-block { font-family: "Source Code Pro", monospace; font-size: var(--shu-font-sm); background: var(--shu-bg-soft); border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); padding: var(--shu-space-4) var(--shu-space-5); overflow-x: auto; white-space: pre-wrap; max-height: 300px; overflow-y: auto; }
		img { display: block; }
		/* Artifacts sit under their step at the same left edge (the step's 32px), reading as evidence for it. */
		.feature-artifacts, .standalone-artifact { margin-left: 32px; }
		/* Consecutive screenshots are grouped (in postProcess) into a horizontal, wrapping row; the run ends at the next non-thumbnail element. */
		.thumb-row { display: flex; flex-flow: row wrap; align-items: flex-start; gap: var(--shu-space-2); margin-left: 32px; }
		.thumb-row > * { margin: 0; }
		shu-artifact-frame { margin: var(--shu-space-3) 0; }
		.doc-controls { padding: var(--shu-space-2) var(--shu-space-4); font-size: var(--shu-font-sm); color: var(--shu-fg-muted); }
		/* The level selector is a settings surface: visible only when the column's controls toggle (the pane's ⚙, which sets data-show-controls) is on. */
		:host(:not([data-show-controls])) .doc-controls { display: none; }
	`,
	];
	/** The shared event log (ShuEventConsumer owns backfill + live merge + dedup). Read-only here; the document renders from it. */
	private get events(): THaibunEvent[] {
		return this.#events.all as unknown as THaibunEvent[];
	}
	private startTime = 0;
	private endTime = 0;
	private renderedEventCount = 0;

	constructor() {
		super(DocumentColumnSchema, { level: "log" });
	}

	/** Re-derive the document from the shared log: render once when it first lands, then append only the live tail. The
	 *  static `.document-body` is preserved by lit across re-renders, so we never re-run renderFull on an update — that
	 *  blew away every embedded shu-product-view/shu-artifact-frame (the destroy-on-update bug). */
	private onEventsChanged(): void {
		const all = this.events;
		if (all.length < this.renderedEventCount) {
			this.renderedEventCount = 0;
			this.startTime = 0;
			this.endTime = 0;
		}
		for (let i = this.renderedEventCount; i < all.length; i++) {
			const ts = all[i].timestamp;
			if (ts) {
				if (!this.startTime || ts < this.startTime) this.startTime = ts;
				if (ts > this.endTime) this.endTime = ts;
			}
		}
		void this.renderDocument();
	}

	/** Render once the `.document-body` exists (await the first lit render): full when the log first lands, then append
	 *  only the live tail. Driven solely by an event change — never by a lit update — so embedded views are never destroyed. */
	private async renderDocument(): Promise<void> {
		await this.updateComplete;
		if (!this.shadowRoot?.querySelector(".document-body")) return;
		if (this.renderedEventCount === 0) this.renderFull();
		else this.appendNew();
	}

	protected override onConnected(): void {
		// A framed thumbnail (in another view) asks the document to jump to the step row it belongs to: it can't reach us
		// across the shadow boundary and owns no start-time → absolute-time mapping. A jump reveals the row here (jumpToRow);
		// a click on a row already in view does not (cursorToRow).
		this.autoListen(this, SHU_EVENT.CURSOR_TO_ROW, (e) => this.jumpToRow((e as CustomEvent<{ row: Element }>).detail.row));

		// Re-render when the window-size setting changes: the document body is imperative DOM (renderFull), so the
		// signal read inside windowTail never auto-subscribes the way a lit render() does — without this, a new
		// window size applies only after a reload.
		let firstWindow = true;
		this.updateEffect(() => {
			getWindowSize(); // subscribe to the window-size setting
			if (firstWindow) {
				firstWindow = false;
				return;
			}
			if (this.renderedEventCount > 0) this.renderFull();
		});
	}

	/** Set the global time cursor to a row's instant so every view scrubs to it, and highlight the row here. Never scrolls:
	 *  a click lands on a row already in view. The latest row is the live edge — a null cursor shows everything, exactly as
	 *  the timeline slider does at its end; any earlier row is a concrete cutoff that hides records newer than it. */
	private cursorToRow(row: Element): void {
		const rawTime = parseFloat(row.getAttribute("data-raw-time") || "0");
		const absTime = this.startTime + rawTime;
		this.timeCursor = absTime >= this.endTime ? null : absTime; // the setter fires onTimeSync → highlightCurrentRow
		this.highlightCurrentRow(); // refresh even when the value is unchanged (the setter no-ops an equal value)
	}

	/** A jump-to from another view (a framed thumbnail): scrub to the row AND scroll it into view — the one deliberate scroll. */
	private jumpToRow(row: Element): void {
		this.cursorToRow(row);
		if (typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "center", behavior: "smooth" });
	}

	protected override onTimeSync(): void {
		this.highlightCurrentRow();
	}

	/** Render the recent window of the backfill — called once on initial load. Bounded by the global window size so a long
	 *  run's reload doesn't render all history at once (the browser handles thousands of blocks; only a very long run is
	 *  capped); live appends past it grow the doc (appendNew), and renderedEventCount tracks the full log so they continue.
	 *  When the window cuts the log, the document opens with a wavy rule saying how many earlier events come before it —
	 *  otherwise a reader takes the first visible event for the start of the run. */
	private renderFull(): void {
		if (!this.shadowRoot) return;
		const body = this.shadowRoot.querySelector(".document-body");
		if (!body) return;
		const windowed = windowTail(this.events);
		body.innerHTML = windowCutHtml(this.events.length, windowed.length) + this.generateHtml(windowed);
		this.postProcessElements(body);
		groupThumbnailRows(body);
		this.renderedEventCount = this.events.length;
	}

	/** Append only new events since last render — never touches existing DOM. */
	private appendNew(): void {
		if (!this.shadowRoot) return;
		const body = this.shadowRoot.querySelector(".document-body");
		if (!body) return;
		if (this.renderedEventCount >= this.events.length) return;
		const newEvents = this.events.slice(this.renderedEventCount);
		const html = this.generateHtml(newEvents);
		if (!html.trim()) {
			this.renderedEventCount = this.events.length;
			return;
		}
		const fragment = document.createElement("div");
		fragment.innerHTML = html;
		this.postProcessElements(fragment);
		while (fragment.firstChild) body.appendChild(fragment.firstChild);
		groupThumbnailRows(body);
		this.renderedEventCount = this.events.length;
		this.#follow.stick(); // scroll to the live edge only if the reader is following it (the shared kit's rules)
	}

	/** Generate sanitized HTML from a set of events. */
	private generateHtml(events: THaibunEvent[]): string {
		const { artifactsByStep } = buildArtifactIndex(events);
		// Measure every row's data-raw-time from the column's stable global start, not this render's first event: windowing
		// renders only a tail slice, and cursorToRow/highlightCurrentRow add data-raw-time back to this.startTime, so a
		// per-slice base would place each row at the wrong absolute instant.
		const { md: rawMd } = generateDocumentMarkdown(events, artifactsByStep, this.state.level as THaibunLogLevel, this.startTime);
		const rawHtml = mdRenderer.render(rawMd);
		return DOMPurify.sanitize(rawHtml, SANITIZE_OPTS);
	}

	/** Classify each row as past/current/future for the current cursor. Pure — it never scrolls, so the reader's scroll
	 *  position is theirs alone (scrolling is confined to appendNew's live-edge stick and jumpToRow's deliberate reveal). */
	private highlightCurrentRow(): void {
		const body = this.shadowRoot?.querySelector(".document-body");
		if (!body) return;
		const rows = Array.from(body.querySelectorAll(".doc-row")) as HTMLElement[];
		const cursor = this.timeCursor;
		let currentRow: HTMLElement | null = null;
		let currentTime = Number.NEGATIVE_INFINITY;
		for (const row of rows) {
			row.classList.remove(TIME_SYNC_CLASS.FUTURE, TIME_SYNC_CLASS.CURRENT);
			if (cursor === null) continue;
			const rawTime = parseFloat(row.getAttribute("data-raw-time") || "0");
			const absTime = this.startTime + rawTime;
			if (absTime > cursor) {
				row.classList.add(TIME_SYNC_CLASS.FUTURE);
			} else if (absTime > currentTime) {
				// The current row is the one closest to the cursor (greatest time ≤ cursor), not the last in DOM order:
				// events can append out of timestamp order, so DOM order ≠ time order, and "last ≤ cursor" lands on a trailing row.
				currentTime = absTime;
				currentRow = row;
			}
		}
		if (currentRow) currentRow.classList.add(TIME_SYNC_CLASS.CURRENT);
	}

	/** Build a map of step ID → products from lifecycle end events, only for steps after show document. */
	private getProductsByStepId(events: THaibunEvent[]): Map<string, Record<string, unknown>> {
		// Find when "show document" was executed — only embed views from after that point
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
			// Don't embed the document view itself
			if (products._component === "shu-document-column") continue;
			const nid = e.id.replace(/^\[|\]$/g, "");
			map.set(nid, products);
		}
		return map;
	}

	private embedProductView(row: HTMLElement, products: Record<string, unknown>): void {
		const rawTime = parseFloat(row.getAttribute("data-raw-time") || "0");
		const snapshotTime = this.startTime + rawTime;
		const frame = document.createElement("shu-artifact-frame") as HTMLElement;
		frame.setAttribute("caption", String(products._summary ?? products._type ?? ""));
		const productView = document.createElement("shu-product-view") as HTMLElement & { openProducts: (p: Record<string, unknown>, t?: number) => void };
		if (this.showControls) productView.setAttribute("data-show-controls", "");
		productView.style.maxHeight = "400px";
		productView.style.overflow = "auto";
		frame.appendChild(productView);
		requestAnimationFrame(() => productView.openProducts(products, snapshotTime));
		row.after(frame);
	}

	/** Post-process a container's elements: add classes, click handlers, embed products. */
	private postProcessElements(container: Element): void {
		const els = (sel: string) => Array.from(container.querySelectorAll(sel)) as HTMLElement[];
		const productMap = this.getProductsByStepId(this.events);
		const addRowClick = (el: HTMLElement) => {
			el.addEventListener("click", () => this.cursorToRow(el));
		};
		els(".header-block").forEach((el) => {
			el.classList.add("doc-row");
			addRowClick(el);
		});
		els(".prose-block").forEach((el) => {
			el.classList.add("doc-row");
			addRowClick(el);
		});
		els(".log-row").forEach((el) => {
			el.classList.add("doc-row");
			if (el.getAttribute("data-nested") === "true") el.classList.add("nested");
			if (el.getAttribute("data-show-symbol") === "true") el.classList.add("show-connector");
			addRowClick(el);
		});
		els(".feature-artifacts").forEach((el) => {
			const ids = el.getAttribute("data-ids")?.split(",") || [];
			el.innerHTML = ids
				.map((id: string) => {
					const artifact = this.events.find((e) => e.id === id) as TArtifactEvent | undefined;
					return artifact ? this.renderArtifact(artifact) : "";
				})
				.join("");
		});
		els(".standalone-artifact").forEach((el) => {
			const id = el.getAttribute("data-id");
			const artifact = this.events.find((e) => e.id === id) as TArtifactEvent | undefined;
			if (artifact) el.innerHTML = this.renderArtifact(artifact);
		});
		els("[data-id]").forEach((el) => {
			const id = el.getAttribute("data-id");
			if (!id) return;
			const products = productMap.get(id);
			if (products) this.embedProductView(el, products);
		});
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
		const artifactPath = isStandaloneMode()
			? ((a.featureRelativePath as string | undefined) ?? url ?? featureRelativeFallback)
			: (url ?? (base ? `/artifacts/${base}` : undefined));
		if (type === "image") {
			// Thumbnail: per-step screenshots are auxiliary, so keep them small and let the step text lead; click or ⤢ to view full.
			return `<shu-artifact-frame class="thumb"><img src="${esc(String(artifactPath))}" loading="lazy" /></shu-artifact-frame>`;
		}
		if (type === "html")
			return `<shu-artifact-frame><iframe src="${esc(String(artifactPath))}" loading="lazy" sandbox="allow-scripts allow-same-origin" style="width:100%;min-height:80vh;border:none;"></iframe></shu-artifact-frame>`;
		if (type === "json") return `<shu-artifact-frame><pre class="json-block">${esc(JSON.stringify(a.json, null, 2))}</pre></shu-artifact-frame>`;
		if (type === "file") return `<shu-artifact-frame caption="${esc(String(a.path))}"><a href="${esc(String(a.path))}">${esc(String(a.path))}</a></shu-artifact-frame>`;
		return "";
	}

	override refresh(): void {
		const body = this.shadowRoot?.querySelector(".document-body");
		if (!body) return;
		// Product views are slotted inside shu-artifact-frame — querySelectorAll reaches light DOM children
		for (const v of Array.from(body.querySelectorAll("shu-artifact-frame shu-product-view")) as (HTMLElement & { refresh?: () => void })[]) {
			if (this.showControls) v.setAttribute("data-show-controls", "");
			else v.removeAttribute("data-show-controls");
			v.refresh?.();
		}
	}

	render(): TemplateResult {
		return html`
			<div class="doc-controls">
				<label>level <select @change=${this.onLevelChange}>
					${HAIBUN_LOG_LEVELS.map((l) => html`<option value=${l} ?selected=${l === this.state.level}>${l}</option>`)}
				</select></label>
			</div>
			<div class="document-body"></div>
		`;
	}

	private onLevelChange(e: Event): void {
		this.setState({ level: (e.target as HTMLSelectElement).value as THaibunLogLevel });
		this.renderFull(); // the visible event set changes with the level, so re-render the whole document at the new level
	}
}
