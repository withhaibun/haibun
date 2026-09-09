/**
 * <shu-monitor-column> — Live execution log stream in a miller column.
 * A ShuEventConsumer: the base owns the shared event log (one backfill + live merge + dedup); this view only derives
 * its rows from it. Clickable time values dispatch TIME_SYNC for cross-view synchronization.
 */
import { html, css, nothing, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { z } from "zod";
import { shuBaseStyles } from "./styles.js";
import { ShuElement, TIME_SYNC_CLASS, type TLinkedData } from "./shu-element.js";
import { eventMarkerStyle, markFor, type TEventMarkerStyle } from "../event-marker.js";
import { HAIBUN_LOG_LEVELS, ICON_DEFAULT, ICON_LOG_ERROR, ICON_LOG_INFO, ICON_LOG_WARN } from "@haibun/core/schema/protocol.js";
import "./shu-virtual-column.js";
import { virtualColumnCss } from "./shu-virtual-column.js";
import { atLiveEdge, graphRunSource, type RunSource } from "../client-cache/index.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { SCROLL_TO_INDEX, type TSeekBy } from "./shu-scrollbar.js";
import { SHU_EVENT } from "../consts.js";
import type { WindowedSource } from "../windowed-source.js";
import type { TScrollMarker } from "../scrollbar-model.js";
import { artifactUrl } from "../artifact-url.js";
import { unavailableOrEmpty } from "./empty-state.js";
import { PaneState } from "../pane-state.js";
import { parseSeqPath } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_STATUS } from "@haibun/core/lib/resources.js";
import { currentRowIndex, cursorMark } from "../virtual-column-model.js";

const MonitorColumnSchema = z.object({
	level: z.enum(HAIBUN_LOG_LEVELS).default("info"),
	tail: z.boolean().default(true),
	/** Whether the steps run to carry other steps out are shown. They report under the steps a reader wrote, so a
	 *  reader reading what a feature did is not shown them, and a reader asking how it was done is. */
	substeps: z.boolean().default(false),
});

export type TLogRow = {
	time: string;
	timestamp: number;
	level: string;
	step: string;
	message: string;
	/** The one glyph the row carries: how the step went, or the level a message reports at. */
	icon: string;
	seqPath?: number[];
	/** A step's outcome, how long it took, where it ran, and what it had to hold to run: what its own record says. */
	status?: string;
	durationMs?: number;
	ranVia?: string;
	ranOn?: string;
	capabilityAction?: string;
	allowedAction?: string;
	performedBy?: string;
	/** What this step produced, as the images a reader sees beside its words: a screenshot taken after a step belongs to
	 *  the step a reader was reading, so the row of that step shows it. */
	produced?: Array<{ url: string; what: string }>;
	/** On a substep, the step it was run to carry out: the step that established it, which a reader reads from its row. */
	partOf?: number[];
	/** How this row marks the rail, for the rows worth marking. Decided from the event when the row is built, by the
	 *  same two calls the timeline marks its track with, so the rail and the timeline never disagree about which
	 *  events matter or what they look like. */
	mark?: TEventMarkerStyle;
};

/** What a produced thing is called: what kind it is and where it is, as the run recorded it. */
/** Whether the row of the step that produced this carries it, which is where a reader is shown it. Such a row is read
 *  by the run's document, which places it by its own reading, and is given no room here. */
const carried = (e: Record<string, unknown> | undefined): boolean => e?.carriedBy !== undefined;

/** What a produced thing is called: what kind it is and where it is, as the run recorded it. */
const producedName = (e: Record<string, unknown>): string => `${String(e.artifactType ?? "")} ${String(e.featureRelativePath ?? e.path ?? "")}`.trim();

const LEVEL_ICONS: Record<string, string> = { error: ICON_LOG_ERROR, warn: ICON_LOG_WARN, info: ICON_LOG_INFO, debug: "💬", trace: "🔍" };
const LEVEL_ORDER: readonly string[] = HAIBUN_LOG_LEVELS;

// Tail retention while following the live edge: the shared log caches only events within this span of the newest one, so a
// long-running tab stays bounded instead of holding the whole history. It slides with the edge in quarter-span steps so
// eviction happens in chunks, not per event. Generous enough that following and a little scroll-back stay inside it; a
// reader who scrolls further (follow pauses) gets the full history back until they return to the edge. Tunable.

/**
 * The marks a filtered log puts on its rail: every row whose event earned one, at its place in that log.
 *
 * The rail carries what the timeline carries — the same events, in the same colours and glyphs, since both take their
 * mark from `markFor`. All this decides is WHERE each mark goes, which on a log is the row's index rather than a
 * moment in time. Indices are into the list passed in, so they address the rows the reader can actually scroll to.
 * Pure, so which rows mark the rail is tested without a virtualizer.
 */
/** What a row carries beside its words: what its record says of how the step went and where it ran. */
const ROW_FIELDS = ["status", "durationMs", "ranVia", "ranOn", "capabilityAction", "allowedAction", "performedBy"] as const;

export function railMarkers(rows: readonly TLogRow[], indices?: readonly number[]): TScrollMarker[] {
	const markers: TScrollMarker[] = [];
	rows.forEach((row, i) => {
		// A mark sits at the row's index in the RUN (`indices`, when the rows are the cached part of a longer run), so it
		// is placed on the rail where the run has it, not where the cached list does. Both halves of what the row reports:
		// what it is about and what happened to it. Either alone leaves marks a reader cannot tell apart — every feature
		// boundary reads "▸ feature" without the first, and a log line names no step without the second.
		const index = indices?.[i] ?? i;
		if (row.mark) markers.push({ ...row.mark, index, id: `${row.step}-${index}`, label: [row.step, row.message].filter(Boolean).join(" ") });
	});
	return markers;
}

export class ShuMonitorColumn extends ShuElement<typeof MonitorColumnSchema> {
	/** Collapsed, the log's rows have nowhere to go, but its scroll rail does: the rail is already a narrow vertical
	 *  strip carrying a mark per significant event and driving the log's position, so the strip IS the rail, left where
	 *  it is. Nothing is copied into a second control, so there is nothing to keep in step. */
	static override rendersOwnSpine = true;

	/** Set by the pane while this column is serving as its own strip. A plain reactive property, so the attribute the
	 *  pane writes re-renders this column the way any other attribute-bound property does. */
	@property({ type: Boolean }) accessor spine = false;

	/** The live execution log as an ordered collection of rows (time, level, step, message). */
	summarizeForKihan(): TLinkedData | null {
		if (this.rows.length === 0) return null;
		return {
			"@id": "view:monitor",
			"@type": "as:OrderedCollection",
			name: "the live execution log",
			totalItems: this.rows.length,
			items: this.rows.map((r) => ({ time: r.time, level: r.level, step: r.step, message: r.message })),
		};
	}

	// The log this view reads is the run at its level: a window of the records the run wrote, which the rail spans by
	// index. Rows are derived from those records as they are painted. One source per level, shared across views,
	// swapped when the level changes.
	#run: RunSource = graphRunSource(this.state.level, { substeps: this.state.substeps });
	#unsubscribeRun?: () => void;
	#rowCache = new WeakMap<object, TLogRow>();
	#source: WindowedSource<TLogRow> = this.#rowsOver(this.#run);
	#currentIdx = -1;
	#cursorMark = -1;
	#marks: TScrollMarker[] = []; // the rail's marks, derived when the window changes rather than when the rail draws
	static styles = [
		virtualColumnCss,
		shuBaseStyles,
		css`
		:host { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: auto; font-family: var(--shu-font-family); font-size: var(--shu-font-md); }
		.toolbar { display: flex; gap: var(--shu-space-3); align-items: center; padding: var(--shu-space-2) var(--shu-space-4); flex: 0 0 auto;
			background: var(--shu-bg-soft); border-bottom: var(--shu-border-w) solid var(--shu-border); }
		.toolbar select { font-size: var(--shu-font-sm); padding: 1px var(--shu-space-2); }
		.toolbar .count { margin-left: auto; color: var(--shu-fg-muted); font-size: var(--shu-font-sm); }
		.log-rows { flex: 1; overflow: auto; }
		.log-row { display: grid; grid-template-columns: 130px 1fr; border-bottom: var(--shu-border-w) solid var(--shu-border); font-size: var(--shu-font-sm); line-height: 1.4; }
		.log-row:hover { background: var(--shu-bg-hover); }
		/* The first column holds its own content: a long step path is shortened to the column's width rather than pushing
		   the duration out of the column and over the words beside it. */
		.log-row .time-group { display: flex; gap: var(--shu-space-2); padding: 1px var(--shu-space-2); cursor: pointer; border-right: var(--shu-border-w) solid var(--shu-border); overflow: hidden; }
		.log-row .time-group:hover { color: var(--shu-accent); }
		.log-row .row-content { padding: 1px var(--shu-space-2); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.log-row .time { color: var(--shu-fg-muted); margin-left: auto; flex: 0 0 auto; }
		.log-row .time-group:hover .time { color: var(--shu-accent); }
		.log-row .seqpath { color: var(--shu-fg-muted); font-size: var(--shu-font-xs); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.log-row .established-by { color: var(--shu-link, #0a58ca); cursor: pointer; }
		/* What a step produced, at the height of its own row: a reader reading the run's steps sees what each one made,
		   and follows the image itself to see it whole. */
		.carried { display: none; }
		.log-row .produced { display: inline-flex; gap: var(--shu-space-1); vertical-align: middle; margin-left: var(--shu-space-2); }
		.log-row .produced img { height: 1.4em; width: auto; border: var(--shu-border-w) solid var(--shu-border); border-radius: 2px; display: block; }
		.log-row .dispatch { color: var(--shu-fg-muted); font-size: var(--shu-font-xs); margin-left: var(--shu-space-2); }
		.log-row .capability { color: var(--shu-fg-muted); font-size: var(--shu-font-xs); margin-left: var(--shu-space-2); }
		.log-row .capability.refused { color: var(--shu-error); }
		.loader { display: inline-block; width: 10px; height: 10px; border: 2px solid var(--shu-border); border-top-color: var(--shu-accent);
			border-radius: 50%; animation: spin 1.2s linear infinite; vertical-align: middle; }
		@keyframes spin { to { transform: rotate(360deg); } }
		.log-row .step { color: var(--shu-fg); font-weight: 500; }
		.log-row .msg { color: var(--shu-fg-muted); }
		.log-row.error { background: var(--shu-bg-error-soft); }
		.log-row.warn { background: var(--shu-bg-warn-soft); }
		.log-row.speculative { opacity: 0.5; }
		.empty { padding: var(--shu-space-6); color: var(--shu-fg-muted); text-align: center; }
	`,
	];

	@property({ attribute: false }) accessor rows: TLogRow[] = [];


	/** The reader's own choice of what to show, remembered across reloads. */
	static persistFields = ["level", "substeps"] as const;

	constructor() {
		super(MonitorColumnSchema, { level: "info", tail: true, substeps: false });
	}

	protected override onConnected(): void {
		this.#readRun();
		this.autoTeardown(() => this.#unsubscribeRun?.());
		// A press or drag on the rail is the reader saying WHEN, not just where: the row it lands on carries a time, so
		// the cursor every other view reads moves with it. Wheeling does not, over the rail or over the rows — that is
		// reading, and a reader scrolling their own log should not drag every other view along. The rail reports which.
		this.autoListen(this, SCROLL_TO_INDEX, this.#onRailSeek as EventListener);
		// Asked from anywhere on the page — the playback control sits in the actions bar, not in this column.
		this.autoListen(document, SHU_EVENT.GO_LIVE, this.#onGoLive);
	}

	#onGoLive = (): void => {
		(this.shadowRoot?.querySelector("shu-virtual-column") as { goLive?: () => void } | null)?.goLive?.();
	};

	#onRailSeek = (e: Event): void => {
		const { index, by } = (e as CustomEvent<{ index: number; by: TSeekBy }>).detail ?? {};
		if (by !== "press") return; // a wheel over the rail is reading, the same as wheeling the rows
		const event = typeof index === "number" ? this.#run.rowAt(index) : undefined;
		if (event) this.#cursorTo((event.timestamp as number) || 0); // a cached row is a moment; a page not yet landed lands first
	};

	/** Read the run as it is now shown: one source per reading, shared across views, swapped when the reader changes
	 *  the level or asks for the steps run to carry other steps out. */
	#readRun(): void {
		this.#unsubscribeRun?.();
		this.#run = graphRunSource(this.state.level, { substeps: this.state.substeps });
		this.#source = this.#rowsOver(this.#run);
		this.#unsubscribeRun = this.#run.subscribe(() => this.requestUpdate());
		void this.#run.ready().then(() => this.requestUpdate());
	}

	/** A WindowedSource of rows over the run source: the run's extent, each record it holds as a row (derived once per
	 *  record and held), the rest undefined until the window reaches them. The rail marks come from those rows. */
	#rowsOver(run: RunSource): WindowedSource<TLogRow> {
		return {
			count: () => run.count(),
			rowAt: (i) => {
				const e = run.rowAt(i);
				return e ? this.#rowOf(e as Record<string, unknown>) : undefined;
			},
			ensureRange: (a, b) => run.ensureRange(a, b),
			subscribe: (cb) => run.subscribe(cb),
			markers: () => this.#marks,
			// A shot drawn on the row of the step that took it is not a row of its own here, so it takes no room.
			rowSize: (i) => (carried(run.rowAt(i) as Record<string, unknown> | undefined) ? 0 : undefined),
		};
	}

	/** The row for one event, derived once: its time relative to the run's start, level, step, message and mark. */
	#rowOf(e: Record<string, unknown>): TLogRow {
		const cached = this.#rowCache.get(e);
		if (cached) return cached;
		const ts = (e.timestamp as number) || 0;
		const first = this.#run.extent().first ?? ts;
		const level = String(e.level || "info");
		// The step's own words. What was said during a step, or produced by one, has none: the path beside it says which
		// step it belongs to, and a raw id in its place says nothing a reader can read.
		const step = String(e.in ?? "");
		// What a row says beside the step it names: what was said, what was produced, or how the step it names turned out.
		const isOf = producedName(e);
		const said = e.kind === "artifact" ? isOf : String(e.called || e.type || "");
		const message = e.kind === "log" ? String((e as { message?: string }).message || "") : said;
		// One glyph per row, and the one that says something: how a step went, and the level a message reports at. Every
		// step of a run reports at the same level, so a level glyph on a step row separates nothing.
		const icon = e.kind === "log" ? (LEVEL_ICONS[level] ?? ICON_DEFAULT) : eventMarkerStyle(e).icon;
		let seqPath = Array.isArray(e.seqPath) ? (e.seqPath as number[]) : undefined;
		if (!seqPath && typeof e.id === "string") seqPath = parseSeqPath(e.id as string) ?? undefined;
		// What the step produced, as images a reader can see: a produced thing that is not an image is named by the run's
		// own document rather than drawn here.
		const made = Array.isArray(e.produced) ? (e.produced as Array<Record<string, unknown>>) : [];
		const produced = made
			.filter((one) => one.artifactType === "image")
			.map((one) => ({ url: artifactUrl(one) ?? "", what: producedName(one) }))
			.filter((one) => one.url !== "");
		const partOf = Array.isArray(e.partOf) ? (e.partOf as number[]) : undefined;
		const row: TLogRow = { time: `${((ts - first) / 1000).toFixed(1)}s`, timestamp: ts, level, step, message, icon, seqPath, mark: markFor(e), ...(produced.length ? { produced } : {}), ...(partOf === undefined ? {} : { partOf }) };
		for (const field of ROW_FIELDS) if (e[field] !== undefined) (row as Record<string, unknown>)[field] = e[field];
		this.#rowCache.set(e, row);
		return row;
	}

	/** The cached rows in index order, with their indices: what the rail marks, the cursor and the Kihan summary read.
	 *  Walked from the spans the source caches, never a scan of the run's extent. */
	#cached(): Array<{ index: number; row: TLogRow }> {
		const out: Array<{ index: number; row: TLogRow }> = [];
		for (const { from, to } of this.#run.cachedRanges()) for (let i = from; i < to; i++) {
			const e = this.#run.rowAt(i) as Record<string, unknown> | undefined;
			// A shot the step's own row carries is read there, so it marks the rail there rather than twice.
			if (e && !carried(e)) out.push({ index: i, row: this.#rowOf(e) });
		}
		return out;
	}

	protected override onTimeSync(): void {
		this.requestUpdate();
	}

	private onSubstepsChange = (e: Event): void => {
		this.setState({ substeps: (e.target as HTMLInputElement).checked });
		this.#readRun(); // another reading of the run: what it holds of the steps run to carry other steps out
	};

	private onLevelChange = (e: Event): void => {
		this.setState({ level: (e.target as HTMLSelectElement).value as z.infer<typeof MonitorColumnSchema>["level"] });
		this.#readRun(); // another level is another run source: the run at that level
	};

	/** Place the shared cursor at a row's instant; the newest row is the live edge, so the cursor there is null (every view follows again). */
	#cursorTo(instant: number): void {
		this.timeCursor = atLiveEdge(instant) ? null : instant;
	}

	private onTimeClick =
		(ts: number) =>
		(e: Event): void => {
			e.stopPropagation();
			this.#cursorTo(ts);
		};

	/** Read the step a substep was run to carry out, which is what pressing that step's own row does. */
	private onEstablishedByClick =
		(seqPath: number[]) =>
		(e: Event): void => {
			e.stopPropagation();
			PaneState.requestFrom(this, { paneType: "step-detail", seqPath }, Boolean((e as MouseEvent).ctrlKey || (e as MouseEvent).shiftKey || (e as MouseEvent).metaKey));
		};

	private onRowClick =
		(seqPath: number[] | undefined) =>
		(e: Event): void => {
			if (!seqPath) return;
			const addToSelection = Boolean((e as MouseEvent).ctrlKey || (e as MouseEvent).shiftKey || (e as MouseEvent).metaKey);
			PaneState.requestFrom(this, { paneType: "step-detail", seqPath }, addToSelection);
		};

	// Derive the window before each render: the rows it holds, the rail markers (every record
	// the shared vocabulary calls significant, so a failure, an artifact or a feature boundary is visible on the rail
	// across the whole log), and the time-cursor row. shu-virtual-column reads the source and virtualizes; its
	// notify-driven follow tails the live edge.
	protected willUpdate(): void {
		// Derived per update from the window: the rows (for the Kihan summary and the tests), the rail's marks, and the
		// current row — the last row at or before the time cursor, read ONCE (an accessor over an attribute check and a
		// signal read). The marks are derived here rather than when the rail asks for them, since the rail asks on every
		// frame a reader scrolls and the window changes only when the run does.
		const cached = this.#cached();
		this.rows = cached.map(({ row }) => row);
		this.#marks = railMarkers(this.rows, cached.map(({ index }) => index));
		const cursor = this.timeCursor;
		this.#currentIdx = cursor === null ? -1 : currentRowIndex(cached.map(({ index, row }) => ({ index, timestamp: row.timestamp })), cursor);
		this.#cursorMark = cursorMark(this.#currentIdx, this.#run.count(), cursor);
	}

	render(): TemplateResult {
		const { level } = this.state;
		const total = this.#source.count();
		// In the strip there is room for the rail and nothing else: no toolbar, no rows. It is the SAME virtual column in
		// both, in the same place in this template, so the element survives collapsing rather than being torn down and
		// built again — and with it the window it is showing, which is where the reader was.
		const spine = this.spine;
		return html`
			${
				spine
					? nothing
					: html`<div class="toolbar" data-testid="monitor-log-stream">
				<label>level <select data-action="level" @change=${this.onLevelChange}>${LEVEL_ORDER.map((l) => html`<option value=${l} ?selected=${l === level}>${l}</option>`)}</select></label>
				<label><input type="checkbox" data-testid=${SHU_TEST_IDS.MONITOR.SUBSTEPS} ?checked=${this.state.substeps} @change=${this.onSubstepsChange} /> substeps</label>
				<span class="count">${total} rows</span>
			</div>`
			}
			${
				total === 0 && !spine
					? html`<div class="log-rows">${unavailableOrEmpty(this.#run.loaded, this.#run.unavailable, "No events at this level.")}</div>`
					: html`<shu-virtual-column ?spine=${spine} .cursor=${this.#cursorMark} .source=${this.#source} .renderRow=${this.renderLogRow} ?follow=${this.state.tail}></shu-virtual-column>`
			}
		`;
	}

	/** One log row at its absolute index. The time-cursor and future classes read the derived state; `row` is always
	 *  cached (the source caches the whole filtered list), so the skeleton is only a defensive fallback. An arrow so its
	 *  identity is stable across renders, which lit-virtualizer relies on. */
	private renderLogRow = (index: number, row: unknown): TemplateResult => {
		const r = row as TLogRow | undefined;
		if (!r) return html`<div class="log-row" data-testid="monitor-log-row"></div>`; // its page has not landed yet: a skeleton row
		// Drawn on the row of the step that produced it, so this row renders nothing. It is still an element, because the
		// virtualizer positions and scrolls to one element per row.
		if (carried(this.#run.rowAt(index) as Record<string, unknown> | undefined)) return html`<div class="carried"></div>`;
		const testId = index === 0 ? SHU_TEST_IDS.MONITOR.FIRST_ROW : "monitor-log-row";
		let cls = r.level === "error" ? " error" : r.level === "warn" ? " warn" : "";
		if (this.timeCursor !== null) {
			if (this.isFuture(r.timestamp)) cls += ` ${TIME_SYNC_CLASS.FUTURE}`;
			if (index === this.#currentIdx) cls += ` ${TIME_SYNC_CLASS.CURRENT}`;
		}
		// Where the step ran, how long it took, and what it had to hold to run: its own record says all of it, so a row
		// states it rather than being paired with a separate account of the same act. A step requiring nothing states
		// nothing, so the rows mentioning a capability are exactly the acts that needed one.
		const dispatchText = r.ranVia ? `${r.ranVia}${r.ranOn ? ` ${r.ranOn}` : ""}${r.durationMs === undefined ? "" : ` ${r.durationMs}ms`}` : "";
		const capabilityRefused = r.capabilityAction !== undefined && r.allowedAction === undefined;
		const capabilityText = r.capabilityAction ? `${capabilityRefused ? "🔒" : "🔓"} ${r.capabilityAction}${r.performedBy ? ` ${r.performedBy}` : ""}` : "";
		// What the step produced, beside its words: the row of the step a reader sees is where a screenshot taken during it
		// is shown, and pressing one opens the image itself.
		const produced = r.produced?.length
			? html`<span class="produced" data-testid=${SHU_TEST_IDS.MONITOR.PRODUCED}>${r.produced.map((one) => html`<a href=${one.url} target="_blank" rel="noreferrer" title=${one.what}><img src=${one.url} alt=${one.what} loading="lazy" decoding="async" /></a>`)}</span>`
			: "";
		// A substep says which step it was run to carry out, and reading that step from here is the same act as reading
		// its own row: a reader shown a step of the machinery is one press from the step of the feature that ran it.
		const seqPath = r.partOf
			? html`<span class="seqpath">[<span class="established-by" data-testid=${SHU_TEST_IDS.MONITOR.ESTABLISHED_BY} title="the step this was run to carry out" @click=${this.onEstablishedByClick(r.partOf)}>${r.partOf.join(".")}</span>${(r.seqPath ?? []).slice(r.partOf.length).map((n) => `.${n}`)}] </span>`
			: r.seqPath
				? html`<span class="seqpath">[${r.seqPath.join(".")}] </span>`
				: "";
		return html`<div class="log-row${cls}" data-testid=${testId}>
			<span class="time-group" @click=${this.onTimeClick(r.timestamp)}>${seqPath}<span class="time">${r.time}</span></span>
			<span class="row-content" @click=${this.onRowClick(r.seqPath)}>${r.status === SEQ_PATH_STATUS.running ? html`<span class="loader"></span>` : html`<span class="icon">${r.icon}</span>`} <span class="step">${r.step}</span> <span class="msg">${r.message}</span>${dispatchText ? html` <span class="dispatch">${dispatchText}</span>` : ""}${capabilityText ? html` <span class="capability${capabilityRefused ? " refused" : ""}" title="capability required to run this step">${capabilityText}</span>` : ""}${produced}</span>
		</div>`;
	};
}
