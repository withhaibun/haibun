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
import { HAIBUN_LOG_LEVELS, ICON_LOG_ERROR, ICON_LOG_INFO, ICON_LOG_WARN } from "@haibun/core/schema/protocol.js";
import "./shu-virtual-column.js";
import { virtualColumnCss } from "./shu-virtual-column.js";
import { eventRunSource, type RunSource } from "../event-source.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { SCROLL_TO_INDEX, type TSeekBy } from "./shu-scrollbar.js";
import { SHU_EVENT } from "../consts.js";
import type { WindowedSource } from "../windowed-source.js";
import type { TScrollMarker } from "../scrollbar-model.js";
import { unavailableOrEmpty } from "./empty-state.js";
import { PaneState } from "../pane-state.js";
import { parseSeqPath } from "@haibun/core/lib/seq-path.js";
import type { TDispatchTrace } from "@haibun/core/schema/protocol.js";

const MonitorColumnSchema = z.object({
	level: z.enum(["debug", "trace", "info", "warn", "error"]).default("info"),
	tail: z.boolean().default(true),
	hideStart: z.boolean().default(true),
});

export type TLogRow = {
	time: string;
	timestamp: number;
	level: string;
	step: string;
	message: string;
	seqPath?: number[];
	isStart?: boolean;
	isAsync?: boolean;
	hasEnd?: boolean;
	dispatch?: TDispatchTrace;
	/** How this row marks the rail, for the rows worth marking. Decided from the event when the row is built, by the
	 *  same two calls the timeline marks its track with, so the rail and the timeline never disagree about which
	 *  events matter or what they look like. */
	mark?: TEventMarkerStyle;
};

const LEVEL_ICONS: Record<string, string> = { error: ICON_LOG_ERROR, warn: ICON_LOG_WARN, info: ICON_LOG_INFO, debug: "💬", trace: "🔍" };
const LEVEL_ORDER: readonly string[] = HAIBUN_LOG_LEVELS;

// Tail retention while following the live edge: the shared log keeps only events within this span of the newest one, so a
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
/** Where the rail marks the moment being shown. It is always somewhere on the run: with no upper bound it is the newest
 *  row, and it moves as newer ones arrive; before the run began it is the top. That is not the same question as which
 *  row is current — no row is current before the first one — so a run with rows always has a mark, and only an empty
 *  one has none. */
export function cursorMark(currentIdx: number, rows: number, cursor: number | null): number {
	if (rows === 0) return -1;
	if (currentIdx >= 0) return currentIdx;
	return cursor === null ? rows - 1 : 0;
}

export function railMarkers(rows: readonly TLogRow[], indices?: readonly number[]): TScrollMarker[] {
	const markers: TScrollMarker[] = [];
	rows.forEach((row, i) => {
		// A mark sits at the row's index in the RUN (`indices`, when the rows are the resident part of a longer run), so it
		// is placed on the rail where the run has it, not where the resident list does. Both halves of what the row says:
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

	// The log this view reads is the run at its level, spanning the whole run by index (event-source): the rail is the
	// run's extent, any region of it pages in on demand, the resident pages are bounded, and live events take their place
	// as they arrive. Rows are derived from the resident events as they are painted; what is not resident paints as a
	// skeleton until its page lands. One source per level, shared across views, swapped when the level changes.
	#run: RunSource = eventRunSource(this.state.level);
	#unsubscribeRun?: () => void;
	#rowCache = new WeakMap<object, TLogRow>();
	#source: WindowedSource<TLogRow> = this.#rowsOver(this.#run);
	#currentIdx = -1;
	#cursorMark = -1;
	#endedStarts = new Set<string>(); // the steps whose end is resident, for the hide-start toggle
	#dispatchBySeq = new Map<string, TDispatchTrace>(); // the dispatch trace of each step whose trace is resident
	static styles = [
		virtualColumnCss,
		shuBaseStyles,
		css`
		:host { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: auto; font-family: var(--shu-font-family); font-size: var(--shu-font-md); }
		:host(:not([data-show-controls])) .toolbar { display: none; }
		.toolbar { display: flex; gap: var(--shu-space-3); align-items: center; padding: var(--shu-space-2) var(--shu-space-4); flex: 0 0 auto;
			background: var(--shu-bg-soft); border-bottom: var(--shu-border-w) solid var(--shu-border); }
		.toolbar select { font-size: var(--shu-font-sm); padding: 1px var(--shu-space-2); }
		.toolbar .count { margin-left: auto; color: var(--shu-fg-muted); font-size: var(--shu-font-sm); }
		.toolbar .hide-start { font-size: var(--shu-font-xs); color: var(--shu-fg-muted); cursor: pointer; display: flex; align-items: center; gap: var(--shu-space-1); }
		.log-rows { flex: 1; overflow: auto; }
		.log-row { display: grid; grid-template-columns: 130px 1fr; border-bottom: var(--shu-border-w) solid var(--shu-border); font-size: var(--shu-font-sm); line-height: 1.4; }
		.log-row:hover { background: var(--shu-bg-hover); }
		.log-row .time-group { display: flex; gap: var(--shu-space-2); padding: 1px var(--shu-space-2); cursor: pointer; border-right: var(--shu-border-w) solid var(--shu-border); }
		.log-row .time-group:hover { color: var(--shu-accent); }
		.log-row .row-content { padding: 1px var(--shu-space-2); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.log-row .time { color: var(--shu-fg-muted); margin-left: auto; }
		.log-row .time-group:hover .time { color: var(--shu-accent); }
		.log-row .seqpath { color: var(--shu-fg-muted); font-size: var(--shu-font-xs); }
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


	constructor() {
		super(MonitorColumnSchema, { level: "info", tail: true, hideStart: true });
	}

	protected override onConnected(): void {
		this.#readRun();
		this.autoTeardown(() => this.#unsubscribeRun?.());
		// A press or drag on the rail is the reader saying WHEN, not just where: the row it lands on carries a time, so
		// the cursor every other view reads moves with it. Wheeling does not, over the rail or over the rows — that is
		// reading, and a reader scrolling their own log should not drag every other view along. The rail says which.
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
		if (event) this.timeCursor = (event.timestamp as number) || 0; // a resident row is a moment; a page not yet landed lands first
	};

	/** Read the run at the level now shown: one source per level, shared across views, swapped when the level changes. */
	#readRun(): void {
		this.#unsubscribeRun?.();
		this.#run = eventRunSource(this.state.level);
		this.#source = this.#rowsOver(this.#run);
		this.#unsubscribeRun = this.#run.subscribe(() => this.requestUpdate());
		void this.#run.ready().then(() => this.requestUpdate());
	}

	/** A WindowedSource of rows over the run source: the run's extent, each resident event as a row (derived once per event
	 *  and cached), the rest undefined until their page lands. The rail marks come from the resident rows. */
	#rowsOver(run: RunSource): WindowedSource<TLogRow> {
		return {
			count: () => run.count(),
			rowAt: (i) => {
				const e = run.rowAt(i);
				return e ? this.#rowOf(e as Record<string, unknown>) : undefined;
			},
			ensureRange: (a, b) => run.ensureRange(a, b),
			subscribe: (cb) => run.subscribe(cb),
			markers: () => railMarkers(this.#resident().map(({ row }) => row), this.#resident().map(({ index }) => index)),
		};
	}

	/** The row for one event, derived once: its time relative to the run's start, level, step, message and mark. */
	#rowOf(e: Record<string, unknown>): TLogRow {
		const cached = this.#rowCache.get(e);
		if (cached) return cached;
		const ts = (e.timestamp as number) || 0;
		const first = this.#run.extent().first ?? ts;
		const level = String(e.level || "info");
		const step = String(e.in || e.id || "");
		const isStep = e.kind === "lifecycle" && e.type === "step";
		const isStart = isStep && e.stage === "start";
		let message = "";
		if (e.kind === "log") message = String((e as { message?: string }).message || "");
		else if (e.kind === "lifecycle" && e.stage === "end") message = `${eventMarkerStyle(e).icon} ${String(e.actionName || "")}`;
		else if (e.kind === "lifecycle" && e.stage === "start" && !isStart) message = `▸ ${String(e.type || "")}`;
		let seqPath = Array.isArray(e.seqPath) ? (e.seqPath as number[]) : undefined;
		if (!seqPath && typeof e.id === "string") seqPath = parseSeqPath(e.id as string) ?? undefined;
		const row: TLogRow = { time: `${((ts - first) / 1000).toFixed(1)}s`, timestamp: ts, level, step, message, seqPath, isStart, isAsync: isStart && e.isAsync === true, mark: markFor(e) };
		this.#rowCache.set(e, row);
		return row;
	}

	/** The resident rows in index order, with their indices: what the rail marks, the cursor and the Kihan summary read. */
	#resident(): Array<{ index: number; row: TLogRow; event: Record<string, unknown> }> {
		const out: Array<{ index: number; row: TLogRow; event: Record<string, unknown> }> = [];
		const n = this.#run.count();
		for (let i = 0; i < n; i++) {
			const e = this.#run.rowAt(i) as Record<string, unknown> | undefined;
			if (e) out.push({ index: i, row: this.#rowOf(e), event: e });
		}
		return out;
	}

	protected override onTimeSync(): void {
		this.requestUpdate();
	}

	private onLevelChange = (e: Event): void => {
		this.setState({ level: (e.target as HTMLSelectElement).value as z.infer<typeof MonitorColumnSchema>["level"] });
		this.#readRun(); // another level is another run source: the run at that level
	};

	private onHideStartChange = (e: Event): void => {
		this.setState({ hideStart: (e.target as HTMLInputElement).checked });
	};

	private onTimeClick =
		(ts: number) =>
		(e: Event): void => {
			e.stopPropagation();
			this.timeCursor = ts;
		};

	private onRowClick =
		(seqPath: number[] | undefined) =>
		(e: Event): void => {
			if (!seqPath) return;
			const addToSelection = Boolean((e as MouseEvent).ctrlKey || (e as MouseEvent).shiftKey || (e as MouseEvent).metaKey);
			PaneState.requestFrom(this, { paneType: "step-detail", seqPath }, addToSelection);
		};

	// Derive the resident window source before each render: the level/hide-start filter, the rail markers (every event
	// the shared vocabulary calls significant, so a failure, an artifact or a feature boundary is visible on the rail
	// across the whole log), and the time-cursor row. shu-virtual-column reads the source and virtualizes; its
	// notify-driven follow tails the live edge.
	protected willUpdate(): void {
		// Derived per update from what is resident: the rows (for the Kihan summary and the tests), which steps have their
		// end resident (for the hide-start toggle), and the current row — the last resident row at or before the time
		// cursor, read ONCE (an accessor over an attribute check and a signal read).
		const resident = this.#resident();
		this.rows = resident.map(({ row }) => row);
		this.#endedStarts = new Set(resident.filter(({ event }) => event.kind === "lifecycle" && event.type === "step" && event.stage === "end").map(({ row }) => row.seqPath?.join(".") ?? ""));
		this.#dispatchBySeq = new Map();
		for (const { event } of resident) {
			const trace = event.kind === "artifact" && event.artifactType === "dispatch-trace" ? (event.trace as TDispatchTrace | undefined) : undefined;
			if (trace?.seqPath) this.#dispatchBySeq.set(trace.seqPath.join("."), trace);
		}
		const cursor = this.timeCursor;
		this.#currentIdx = -1;
		if (cursor !== null) for (const { index, row } of resident) if (row.timestamp <= cursor) this.#currentIdx = index;
		this.#cursorMark = cursorMark(this.#currentIdx, this.#run.count(), cursor);
	}

	render(): TemplateResult {
		const { level, hideStart } = this.state;
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
				<select data-action="level" @change=${this.onLevelChange}>${LEVEL_ORDER.map((l) => html`<option value=${l} ?selected=${l === level}>${l}</option>`)}</select>
				<label class="hide-start"><input type="checkbox" data-action="hide-start" .checked=${hideStart} @change=${this.onHideStartChange}/> hide start</label>
				<span class="count">${total} events</span>
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
	 *  resident (the source holds the whole filtered list), so the skeleton is only a defensive fallback. An arrow so its
	 *  identity is stable across renders, which lit-virtualizer relies on. */
	private renderLogRow = (index: number, row: unknown): TemplateResult => {
		const r = row as TLogRow | undefined;
		if (!r) return html`<div class="log-row" data-testid="monitor-log-row"></div>`; // its page has not landed yet: a skeleton row
		// A start row hidden by the hide-start toggle keeps its index in the run and paints nothing: the run's extent is
		// the server's to count, not this toggle's to recount.
		if (this.state.hideStart && r.isStart && this.#endedStarts.has(r.seqPath?.join(".") ?? "")) return html`<div class="log-row hidden"></div>`;
		const testId = index === 0 ? SHU_TEST_IDS.MONITOR.FIRST_ROW : "monitor-log-row";
		let cls = r.level === "error" ? " error" : r.level === "warn" ? " warn" : "";
		if (this.timeCursor !== null) {
			if (this.isFuture(r.timestamp)) cls += ` ${TIME_SYNC_CLASS.FUTURE}`;
			if (index === this.#currentIdx) cls += ` ${TIME_SYNC_CLASS.CURRENT}`;
		}
		let dispatchText = "";
		// What a gated step required and whether the caller held it. A step that requires nothing says nothing, so the
		// rows that mention a capability are exactly the acts that were authorized.
		let capabilityText = "";
		let capabilityRefused = false;
		if (!r.isStart && r.seqPath) {
			const dispatch = this.#dispatchBySeq.get(r.seqPath.join("."));
			if (dispatch) {
				const dur = dispatch.durationMs !== undefined ? `${dispatch.durationMs}ms` : "";
				dispatchText = `${dispatch.transport}${dur ? ` ${dur}` : ""}`;
				if (dispatch.capabilityRequired) {
					capabilityRefused = !dispatch.authorized;
					const by = dispatch.invokedBy ? ` ${dispatch.invokedBy}` : "";
					capabilityText = `${dispatch.authorized ? "🔓" : "🔒"} ${dispatch.capabilityRequired}${by}`;
				}
			}
		}
		return html`<div class="log-row${cls}" data-testid=${testId}>
			<span class="time-group" @click=${this.onTimeClick(r.timestamp)}>${r.seqPath ? html`<span class="seqpath">[${r.seqPath.join(".")}]</span> ` : ""}<span class="time">${r.time}</span></span>
			<span class="row-content" @click=${this.onRowClick(r.seqPath)}>${r.isAsync && !r.hasEnd ? html`<span class="loader"></span>` : html`<span class="icon">${LEVEL_ICONS[r.level] ?? "❓"}</span>`} <span class="step">${r.step}</span> <span class="msg">${r.message}</span>${dispatchText ? html` <span class="dispatch">${dispatchText}</span>` : ""}${capabilityText ? html` <span class="capability${capabilityRefused ? " refused" : ""}" title="capability required to run this step">${capabilityText}</span>` : ""}</span>
		</div>`;
	};
}
