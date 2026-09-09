/**
 * <shu-document-column> — the run as an academic-paper document: execution events rendered as headings, step lines,
 * prose, and embedded artifacts. It reads the run the way every event view does (event-source): one source per level,
 * spanning the whole run by index, paged in as the reader reaches for a region, bounded in what it caches, live events
 * taking their place at the edge. One row per event. An event's blocks (document-blocks) are generated a page at a time
 * from the cached events of that page and given to the events they came from, so only what is cached is rendered and an
 * arbitrarily long run stays reachable from its first heading to its live edge, with nothing requested twice. Time-cursor
 * dimming, click-to-scrub, jump-to-row from another view, and failed-step glyphs on the rail all operate on the rows.
 * Product views are embedded inside their row (once per element, so the virtualizer recycling a row does not re-open it).
 */
import { html, css, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { z } from "zod";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { ShuElement, TIME_SYNC_CLASS, type TLinkedData } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { shuBaseStyles } from "./styles.js";
import { buildArtifactIndex, generateDocumentMarkdown } from "@haibun/core/lib/document-content.js";
import "./shu-artifact-frame.js";
import type { ShuArtifactFrame } from "./shu-artifact-frame.js";
import type { ShuVirtualColumn } from "./shu-virtual-column.js";
import "./shu-virtual-column.js";
import { virtualColumnCss } from "./shu-virtual-column.js";
import { atLiveEdge, graphRunSource, type RunSource, type TEventRecord } from "../client-cache/index.js";
import type { WindowedSource } from "../windowed-source.js";
import { splitDocumentBlocks, finalizeBlocks, blocksByEvent, withHeadingAnchors, type TDocBlock } from "../document-blocks.js";
import { currentRowIndex, cursorMark, rowTimeClass } from "../virtual-column-model.js";
import type { TScrollMarker } from "../scrollbar-model.js";
import type { THaibunEvent, TArtifactEvent, THaibunLogLevel } from "@haibun/core/schema/protocol.js";
import { SEQ_PATH_STATUS } from "@haibun/core/lib/resources.js";
import { eventMarkerStyle } from "../event-marker.js";
import { HAIBUN_LOG_LEVELS } from "@haibun/core/schema/protocol.js";
import { esc } from "../util.js";
import { getRels } from "../rels-cache.js";
import { artifactUrl } from "../artifact-url.js";
import { refLinksPlugin } from "../markdown-refs.js";

const DocumentColumnSchema = z.object({
	level: z.enum(HAIBUN_LOG_LEVELS).default("log"),
});

const mdRenderer = new MarkdownIt({ html: true, linkify: true, typographer: true });
withHeadingAnchors(mdRenderer);
// A `#Type` / `#Type:id` link in prose opens the type or individual in a column (shu-ref), never navigating the page.
refLinksPlugin(mdRenderer, (name) => getRels(name) !== undefined);

const SANITIZE_OPTS = {
	// `kind`/`linktarget`/`text` carry the shu-ref reference (a `#Type` link the refLinksPlugin rewrote); DOMPurify
	// lowercases attribute names, so `linkTarget` is allowlisted as `linktarget`.
	ADD_ATTR: [
		"style",
		"data-depth",
		"data-nested",
		"data-instigator",
		"data-show-symbol",
		"data-id",
		"data-time",
		"data-raw-time",
		"data-heading",
		"data-testid",
		"data-action",
		"data-has-artifacts",
		"data-ids",
		"kind",
		"linktarget",
		"text",
	],
	ADD_TAGS: ["div", "shu-ref"],
};

/** One row of the document: an event of the run at its index, and the blocks it produced. */
export type TDocRow = { index: number; event: TEventRecord; blocks: TDocBlock[] };
/** The rows of one page of the run, with what they were built from: how many events of the page were cached, and the first
 *  and last of them, so a page that grew (the live edge) or changed (another run's, fetched again) is built again and an
 *  unchanged one never is, distinguished in constant time. */
type TPageRows = { cached: number; first: TEventRecord; last: TEventRecord; rows: TDocRow[] };

/** How many pages of rows are cached built: the cached pages are bounded the same way, so the rows of what is cached are
 *  available and the rows of what was paged out go with it. */
const BUILT_PAGES = 24;
/** How far ←/→ from a thumbnail walks through pages without one before giving up: a bound, not a hang. */
const MAX_FRAME_HOPS = 50;
const FRAME_ORDINAL = /data-frame-ordinal="(\d+):(\d+)"/g;

export class ShuDocumentColumn extends ShuElement<typeof DocumentColumnSchema> {
	// The run this view reads is the run at its level, spanning the whole run by index (event-source): the rail is the
	// run's extent, any region of it pages in on demand, the cached pages are bounded, and live events take their place
	// as they arrive. One source per level, shared across views, swapped when the level changes.
	#run: RunSource = graphRunSource(this.state.level);
	#unsubscribeRun?: () => void;
	#source: WindowedSource<TDocRow> = this.#rowsOver(this.#run);
	#pages = new Map<number, TPageRows>();
	#windowRows: Array<{ index: number; event: TEventRecord }> = []; // the rows of the window a reader is looking at, read once per update
	#marks: TScrollMarker[] = []; // the rail's marks, derived when the window changes rather than when the rail draws
	#currentIdx = -1;
	#cursorMark = -1;

	static styles = [
		shuBaseStyles,
		virtualColumnCss,
		css`
			:host { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; font-family: "Source Serif 4", Georgia, serif; font-size: 15px; line-height: 1.7; color: var(--shu-fg); }
			/* Each block centres itself in a reading column (the old .document-body 80%-centred layout, per row now). */
			.doc-block { max-width: 760px; margin: 0 auto; padding: 0 1.5rem; }
			/* An event that rendered nothing at this level takes no room; a page not yet cached caches a line's worth. */
			.doc-block.doc-empty { padding: 0; }
			.doc-block.doc-skeleton { min-height: 1.7em; }
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
			/* A run of per-step screenshots flows as a grid of TILE-SIZED thumbnails across the column width: fixed ~160px
			   minimum tracks (auto-fill caches the unused tracks, so a lone screenshot stays a tile instead of blowing up to
			   the whole column), each frame stretching only to its track, wrapping to new rows. The strip spans the column;
			   the tiles stay thumbnails — expanding is what the fullscreen click is for. */
			.thumb-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(160px, 100%), 1fr)); gap: var(--shu-space-2); margin-left: 32px; }
			.thumb-row > * { margin: 0; }
			shu-artifact-frame { margin: var(--shu-space-3) 0; }
			.empty { padding: var(--shu-space-4); color: var(--shu-fg-faded); font-size: var(--shu-font-sm); }
			.doc-controls { padding: var(--shu-space-2) var(--shu-space-4); font-size: var(--shu-font-sm); color: var(--shu-fg-muted); flex-shrink: 0; }
			:host(:not([data-show-controls])) .doc-controls { display: none; }
		`,
	];

	constructor() {
		super(DocumentColumnSchema, { level: "log" });
	}

	/** When the run began, as the run source knows it: the epoch every row's raw time is measured from. */
	get #first(): number {
		return this.#run.extent().first ?? 0;
	}

	/** The run document as an as:Document, with what is cached rendered to markdown (mirrors what the column shows). */
	summarizeForKihan(): TLinkedData | null {
		const events = this.#windowRows.map((r) => r.event) as unknown as THaibunEvent[];
		if (events.length === 0) return null;
		const { md } = generateDocumentMarkdown(events, buildArtifactIndex(events).artifactsByStep, this.state.level as THaibunLogLevel, this.#first);
		return { "@id": "view:document-log", "@type": "as:Document", name: "the run document shown in this column, as markdown", content: md };
	}

	protected override onConnected(): void {
		this.#readRun();
		this.autoTeardown(() => this.#unsubscribeRun?.());
		// A framed row a reader clicked in another view requests the document to scroll to that instant and reveal the row.
		this.autoListen(this, SHU_EVENT.CURSOR_TO_ROW, (e) => this.jumpToRow((e as CustomEvent<{ row: Element }>).detail.row));
		// ←/→ from an expanded thumbnail: only this column can navigate the whole run — the off-screen frames are not in the DOM.
		this.autoListen(this, SHU_EVENT.FRAME_NAV, (e) => void this.#frameNav((e as CustomEvent<{ dir: number; from: HTMLElement }>).detail));
	}

	protected override onTimeSync(): void {
		this.requestUpdate(); // renderRow recomputes each row's past/current/future class
	}

	/** Read the run at the level now shown: one source per level, shared across views, swapped when the level changes. */
	#readRun(): void {
		this.#unsubscribeRun?.();
		this.#run = graphRunSource(this.state.level);
		this.#pages.clear();
		this.#source = this.#rowsOver(this.#run);
		this.#unsubscribeRun = this.#run.subscribe(() => this.requestUpdate());
		void this.#run.ready().then(() => this.requestUpdate());
	}

	/** A WindowedSource of rows over the run source: the run's extent, each cached event as a row, the rest undefined
	 *  until their page lands. The rail marks come from the cached rows. */
	#rowsOver(run: RunSource): WindowedSource<TDocRow> {
		return {
			count: () => run.count(),
			rowAt: (i) => this.#rowAt(i),
			ensureRange: (a, b) => run.ensureRange(a, b),
			subscribe: (cb) => run.subscribe(cb),
			markers: () => this.#marks,
			// A row of no height, taken from what the row renders rather than from the record behind it: a row with no
			// blocks draws nothing, and every other row is measured when it renders. A virtualizer told which rows are
			// empty estimates the rest steadily, which is what keeps the rail thumb from resizing as a reader scrolls.
			// A page that is not built answers nothing, so no page is built to answer a question about a row's height.
			rowSize: (i) => {
				const size = this.#run.pageSize;
				const p = Math.floor(i / size);
				const row = this.#pages.get(p)?.rows[i - p * size];
				return row !== undefined && row.blocks.length === 0 ? 0 : undefined;
			},
		};
	}

	#rowAt(i: number): TDocRow | undefined {
		const p = Math.floor(i / this.#run.pageSize);
		return this.#pageRows(p)?.rows[i - p * this.#run.pageSize];
	}

	/** The rows of page `p`, built from the events of it cached contiguously from its start, and cached until the page caches
	 *  more (the live edge growing) or other events (a new run); nothing when none of it is cached. */
	#pageRows(p: number): TPageRows | undefined {
		const size = this.#run.pageSize;
		const start = p * size;
		const end = Math.min(start + size, this.#run.count());
		const cached = this.#pages.get(p);
		// Still the page that was built: the same first and last events are cached, and nothing more of the page is (three
		// reads, not a walk of the page, for every row the virtualizer requests).
		if (
			cached &&
			this.#run.rowAt(start) === cached.first &&
			this.#run.rowAt(start + cached.cached - 1) === cached.last &&
			(start + cached.cached >= end || this.#run.rowAt(start + cached.cached) === undefined)
		)
			return cached;
		const events: TEventRecord[] = [];
		for (let i = start; i < end; i++) {
			const e = this.#run.rowAt(i);
			if (!e) break;
			events.push(e);
		}
		if (events.length === 0) {
			this.#pages.delete(p);
			return undefined;
		}
		const built = { cached: events.length, first: events[0], last: events[events.length - 1], rows: this.#buildRows(p, start, events) };
		this.#pages.set(p, built);
		if (this.#pages.size > BUILT_PAGES)
			for (const q of [...this.#pages.keys()].sort((a, b) => Math.abs(b - p) - Math.abs(a - p)).slice(0, this.#pages.size - BUILT_PAGES)) this.#pages.delete(q);
		return built;
	}

	/** One page of events as rows: the document markdown of those events (headings, step lines, prose, artifact holders),
	 *  rendered, sanitized, split into blocks, finalized (artifacts filled, reader classes, thumbnail strips stamped with
	 *  this page's name), and each block given to its own event. Raw times are from the run's start, so rows of
	 *  every page share one epoch. */
	#buildRows(p: number, start: number, events: TEventRecord[]): TDocRow[] {
		const typed = events as unknown as THaibunEvent[];
		const { artifactsByStep } = buildArtifactIndex(typed);
		const html = DOMPurify.sanitize(mdRenderer.render(generateDocumentMarkdown(typed, artifactsByStep, this.state.level as THaibunLogLevel, this.#first).md), SANITIZE_OPTS);
		// Every artifact the index knows, by id: the ones recorded as events and the ones embedded in a step's products.
		const artifactsById = new Map<string, TArtifactEvent>();
		for (const list of artifactsByStep.values()) for (const a of list) artifactsById.set(a.id, a);
		const blocks = finalizeBlocks(
			splitDocumentBlocks(html),
			(id) => {
				const artifact = artifactsById.get(id);
				return artifact ? this.renderArtifact(artifact) : "";
			},
			`${p}:`,
		);
		const per = blocksByEvent(events, blocks);
		return events.map((event, i) => ({ index: start + i, event, blocks: per[i] }));
	}

	/**
	 * The rows of the window a reader is looking at, in index order: what the rail marks, the cursor and the summary
	 * read. A row here is the record and where it sits, which is all any of those ask of it. What a row LOOKS like is
	 * built a page at a time, when a page is rendered, so a window of any length costs one read rather than the whole
	 * document being written out on every update.
	 */
	#window(): Array<{ index: number; event: TEventRecord }> {
		const out: Array<{ index: number; event: TEventRecord }> = [];
		for (const { from, to } of this.#run.cachedRanges())
			for (let i = from; i < to; i++) {
				const event = this.#run.rowAt(i);
				if (event) out.push({ index: i, event });
			}
		return out;
	}

	/** The rows already built, which is what a reader can see: what a jump or a heading link searches. */
	#builtRows(): TDocRow[] {
		return [...this.#pages.values()].flatMap((page) => page.rows);
	}

	/** A mark on the rail for every step that failed, so a reader jumps to it in a long run without scrolling for it.
	 *  The mark sits on the step's own row (its start, which carries its blocks), found from the end that failed. Its
	 *  glyph comes from the shared marker vocabulary, so a speculative try and a handed-out call are marked as what
	 *  they are rather than as the run failing. */
	#markers(): TScrollMarker[] {
		const markers: TScrollMarker[] = [];
		for (const { index, event } of this.#windowRows) {
			// A step is one row, so a failed step marks the rail where that row is.
			if (event.kind !== "lifecycle" || event.status !== SEQ_PATH_STATUS.failed) continue;
			const { icon, color } = eventMarkerStyle(event);
			markers.push({ index, id: String(event.id ?? ""), icon, color, label: `${String(event.in ?? "")} failed` });
		}
		return markers;
	}

	protected willUpdate(): void {
		// The window, its marks and the cursor's row, derived when the run changes rather than when the rail draws: the
		// rail asks for its marks on every frame a reader scrolls, and a cursor at the live edge sits on no row at all.
		this.#windowRows = this.#window();
		this.#marks = this.#markers();
		const cursor = this.timeCursor;
		this.#currentIdx =
			cursor === null
				? -1
				: currentRowIndex(
						this.#windowRows.map(({ index, event }) => ({ index, timestamp: Number(event.timestamp) || 0 })),
						cursor,
					);
		this.#cursorMark = cursorMark(this.#currentIdx, this.#run.count(), cursor);
	}

	/** Scrub the global time cursor to a row's instant and highlight it here; never scrolls (a click lands on a row in
	 *  view). The newest instant is the live edge — the cursor there is null, every view following, like the slider at its end. */
	private cursorToRow(rawTime: number): void {
		const absTime = this.#first + rawTime;
		this.timeCursor = atLiveEdge(absTime) ? null : absTime; // the setter fires onTimeSync → requestUpdate
		this.requestUpdate(); // refresh even when the value is unchanged (the setter no-ops an equal value)
	}

	/** A click in a row scrubs to that row. A click on a link to a heading of this document goes to that heading
	 *  instead: the reader requested somewhere else in the run, not for the moment they clicked in. A link naming
	 *  anything else is left alone, so a link out of the document still leads out of it. */
	private onBlockClick(e: Event, rawTime: number): void {
		const href = (e.composedPath().find((n) => n instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined)?.getAttribute("href") ?? "";
		if (href.startsWith("#") && this.#goToHeading(href.slice(1))) return e.preventDefault();
		this.cursorToRow(rawTime);
	}

	/** Go to the heading a link names, and say whether the cached part of this document has one. The heading's own name is
	 *  the handle, stamped on its block when the page was built (headingAnchor), so a feature can link to its own scenarios. */
	#goToHeading(anchor: string): boolean {
		if (anchor === "") return false;
		const stamp = `data-heading="${anchor}"`;
		const row = this.#builtRows().find((r) => r.blocks.some((b) => b.html.includes(stamp)));
		if (!row) return false;
		this.#revealRow(row, "start");
		return true;
	}

	#rawTimeOf = (row: TDocRow): number => (Number(row.event.timestamp) || 0) - this.#first;

	/** Scrub to a row and scroll it into view: the one deliberate scroll. */
	#revealRow(row: TDocRow, position: "start" | "center"): void {
		this.cursorToRow(this.#rawTimeOf(row));
		this.#virtualColumn()?.scrollToIndex(row.index, position);
	}

	#virtualColumn(): ShuVirtualColumn | null {
		return this.shadowRoot?.querySelector("shu-virtual-column") ?? null;
	}

	/** A jump-to from another view: the row is either a block element carrying `data-id`, or an artifact frame carrying its
	 *  build-time-stamped `data-step-id`; the cached row that rendered that id is scrubbed to and scrolled into view. */
	private jumpToRow(row: Element): void {
		const id = row.getAttribute("data-step-id") ?? row.getAttribute("data-id") ?? "";
		const hit = id === "" ? undefined : this.#builtRows().find((r) => r.blocks.length > 0 && String(r.event.id ?? "") === id);
		if (hit) this.#revealRow(hit, "center");
	}

	/** The thumbnail frames a page of rows caches, in order, each with the row it is in: stamped `page:ordinal` when the page was built. */
	#framesOf(p: number): Array<{ row: TDocRow; stamp: string }> {
		const rows = this.#pageRows(p)?.rows ?? [];
		return rows.flatMap((row) => row.blocks.flatMap((b) => [...b.html.matchAll(FRAME_ORDINAL)].map((m) => ({ row, stamp: `data-frame-ordinal="${m[1]}:${m[2]}"` }))));
	}

	/** ←/→ from an expanded thumbnail: move to the previous/next thumbnail in the WHOLE run, not just the rendered window.
	 *  Each frame carries its page and ordinal in it, stamped at build; the neighbour is found in the same page, or the
	 *  next page with a thumbnail in that direction is delivered in and its nearest end taken; the row is scrolled into the
	 *  virtualizer's window and its rendered frame expanded once it exists. */
	async #frameNav({ dir, from }: { dir: number; from: HTMLElement }): Promise<void> {
		const [pStr, nStr] = (from.getAttribute("data-frame-ordinal") ?? "").split(":");
		let p = Number(pStr);
		let n = Number(nStr) + dir;
		if (!Number.isInteger(p) || !Number.isInteger(n) || dir === 0) return;
		const size = this.#run.pageSize;
		let frames = this.#framesOf(p);
		for (let hops = 0; (n < 0 || n >= frames.length) && hops < MAX_FRAME_HOPS; hops++) {
			p += dir;
			if (p < 0 || p * size >= this.#run.count()) return; // at the run's first/last thumbnail — nothing to move to
			await this.#run.ensureRange(p * size, Math.min((p + 1) * size, this.#run.count()));
			frames = this.#framesOf(p);
			n = dir < 0 ? frames.length - 1 : 0;
		}
		const target = frames[n];
		if (!target) return;
		(from as ShuArtifactFrame).setFullscreen(false);
		this.#virtualColumn()?.scrollToIndex(target.row.index, "center");
		// The virtualizer renders the scrolled-to row asynchronously; wait for the target frame to exist, bounded.
		for (let tries = 0; tries < 60; tries++) {
			const frame = this.shadowRoot?.querySelector(`shu-artifact-frame[${target.stamp}]`) as ShuArtifactFrame | null;
			if (frame) return frame.setFullscreen(true);
			await new Promise((r) => requestAnimationFrame(r));
		}
	}

	render(): TemplateResult {
		return html`
			<div class="doc-controls">
				<label>level <select @change=${this.onLevelChange}>
					${HAIBUN_LOG_LEVELS.map((l) => html`<option value=${l} ?selected=${l === this.state.level}>${l}</option>`)}
				</select></label>
			</div>
			${this.#run.unavailable ? html`<div class="empty unavailable">${this.#run.unavailable}</div>` : ""}
			<shu-virtual-column data-testid=${SHU_TEST_IDS.DOCUMENT.ROOT} .cursor=${this.#cursorMark} .source=${this.#source} .renderRow=${(i: number, r: unknown) => this.#renderRow(i, r)} ?follow=${true}></shu-virtual-column>
		`;
	}

	/** One event's row: its blocks as rendered; a skeleton while its page is not cached; an event that produced nothing at
	 *  this level (a step's end, a trace) is an empty row, so the run's index space is the column's. */
	#renderRow = (i: number, row: unknown): TemplateResult => {
		const r = row as TDocRow | undefined;
		if (!r) return html`<div class="doc-block doc-skeleton" aria-hidden="true"></div>`;
		const id = String(r.event.id ?? "");
		if (r.blocks.length === 0) return html`<div class="doc-block doc-empty" data-id=${id}></div>`;
		const ts = Number(r.event.timestamp) || 0;
		const t = rowTimeClass(ts, i, this.timeCursor, this.#currentIdx);
		const cls = `doc-block${t === "future" ? ` ${TIME_SYNC_CLASS.FUTURE}` : t === "current" ? ` ${TIME_SYNC_CLASS.CURRENT}` : ""}`;
		const rawTime = ts - this.#first;
		return html`<div class=${cls} data-id=${id} @click=${(e: Event) => this.onBlockClick(e, rawTime)}>
			${unsafeHTML(r.blocks.map((b) => b.html).join(""))}
		</div>`;
	};

	private renderArtifact(artifact: TArtifactEvent): string {
		const type = artifact.artifactType;
		const a = artifact as Record<string, unknown>;
		const artifactPath = artifactUrl(a);
		if (type === "image") {
			// Decoded off the thread that draws the page: a strip holds many tiles, and each is a screenshot of a whole page.
			return `<shu-artifact-frame class="thumb"><img src="${esc(String(artifactPath))}" loading="lazy" decoding="async" /></shu-artifact-frame>`;
		}
		if (type === "html")
			return `<shu-artifact-frame><iframe src="${esc(String(artifactPath))}" loading="lazy" sandbox="allow-scripts allow-same-origin" style="width:100%;min-height:80vh;border:none;"></iframe></shu-artifact-frame>`;
		if (type === "json") return `<shu-artifact-frame><pre class="json-block">${esc(JSON.stringify(a.json, null, 2))}</pre></shu-artifact-frame>`;
		if (type === "file") return `<shu-artifact-frame caption="${esc(String(a.path))}"><a href="${esc(String(a.path))}">${esc(String(a.path))}</a></shu-artifact-frame>`;
		return "";
	}

	private onLevelChange(e: Event): void {
		this.setState({ level: (e.target as HTMLSelectElement).value as THaibunLogLevel });
		this.#readRun(); // another level is another run source: the run at that level
	}
}
