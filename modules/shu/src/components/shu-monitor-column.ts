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
import { EventsController } from "../controllers/index.js";
import { eventMarkerStyle, markFor, type TEventMarkerStyle } from "../event-marker.js";
import { ICON_LOG_ERROR, ICON_LOG_INFO, ICON_LOG_WARN } from "@haibun/core/schema/protocol.js";
import "./shu-virtual-column.js";
import { virtualColumnCss, FOLLOW_CHANGED, type FollowChangedDetail } from "./shu-virtual-column.js";
import { SCROLL_TO_INDEX } from "./shu-scrollbar.js";
import { eventKey, FULL_WINDOW } from "../events-snapshot.js";
import type { Range } from "../ranges.js";
import { arrayWindowedSource } from "../windowed-source.js";
import type { TScrollMarker } from "../scrollbar-model.js";
import { emptyOrLoading } from "./empty-state.js";
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
const LEVEL_ORDER = ["debug", "trace", "log", "info", "warn", "error"];

// Tail retention while following the live edge: the shared log keeps only events within this span of the newest one, so a
// long-running tab stays bounded instead of holding the whole history. It slides with the edge in quarter-span steps so
// eviction happens in chunks, not per event. Generous enough that following and a little scroll-back stay inside it; a
// reader who scrolls further (follow pauses) gets the full history back until they return to the edge. Tunable.
const MONITOR_TAIL_MS = 10 * 60_000;
const MONITOR_SLIDE_STEP_MS = MONITOR_TAIL_MS / 4;

/**
 * The marks a filtered log puts on its rail: every row whose event earned one, at its place in that log.
 *
 * The rail carries what the timeline carries — the same events, in the same colours and glyphs, since both take their
 * mark from `markFor`. All this decides is WHERE each mark goes, which on a log is the row's index rather than a
 * moment in time. Indices are into the list passed in, so they address the rows the reader can actually scroll to.
 * Pure, so which rows mark the rail is tested without a virtualizer.
 */
export function railMarkers(rows: readonly TLogRow[]): TScrollMarker[] {
	const markers: TScrollMarker[] = [];
	rows.forEach((row, index) => {
		// Both halves of what the row says: what it is about and what happened to it. Either alone leaves marks a reader
		// cannot tell apart — every feature boundary reads "▸ feature" without the first, and a log line names no step
		// without the second.
		if (row.mark) markers.push({ ...row.mark, index, id: `${row.step}-${index}`, label: [row.step, row.message].filter(Boolean).join(" ") });
	});
	return markers;
}

/** The monitor's window: a bounded tail below the newest event while pinned to the live edge, else the full history so a
 *  scrolled-back reader can reach anything. `from` clamps at 0, so a run shorter than the tail is just the whole log (no
 *  eviction). Pure, so the tail-vs-full decision is unit-tested without a virtualizer. */
export function monitorTailWindow(following: boolean, newest: number, tailMs: number = MONITOR_TAIL_MS): Range[] {
	if (!following) return [FULL_WINDOW];
	return [{ from: Math.max(0, newest - tailMs), to: Number.POSITIVE_INFINITY }];
}

export class ShuMonitorColumn extends ShuElement<typeof MonitorColumnSchema> {
	/** Collapsed, the log's rows have nowhere to go, but its scroll rail does: the rail is already a narrow vertical
	 *  strip carrying a mark per significant event and driving the log's position, so the strip IS the rail, left where
	 *  it is. Nothing is copied into a second control, so there is nothing to keep in step. */
	static override rendersOwnSpine = true;

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

	// The window this view registers with the shared log: while pinned to the live edge, a bounded tail (memory stays flat on
	// a long run); when the reader scrolls back (follow pauses), the full history so nothing is out of reach. Slice-1 windowing.
	#events = new EventsController(
		this,
		() => this.onEventsChanged(),
		() => this.#windowRanges(),
	);
	#following = false; // whether the virtual column is pinned to the live edge (drives tail vs full window)
	#registeredFrom = 0; // the tail window's lower bound as last registered, so a slide re-registers only in coarse steps
	#firstKey = ""; // eventKey of the first held event, so a front eviction (not just a shrink) triggers a rebuild
	// The rows are virtualized: shu-virtual-column renders only the visible window over a resident source and owns the
	// live-edge follow (tail), so this view derives the filtered rows and their rail markers and hands them over.
	#source = arrayWindowedSource<TLogRow>([]);
	#currentIdx = -1;
	// Memoize the filtered list by its inputs so a time-cursor scrub (which changes only the current row) does not
	// re-filter the whole log and re-notify the virtual column. `this.rows` gets a fresh identity on every event batch.
	#filtered: TLogRow[] = [];
	#lastRows: TLogRow[] | null = null;
	#lastLevel = "";
	#lastHideStart = false;
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

	private startTime = 0;
	private endTime = 0;
	private startRowIndex = new Map<string, number>();
	private renderedCount = 0;

	constructor() {
		super(MonitorColumnSchema, { level: "info", tail: true, hideStart: true });
	}

	protected override onConnected(): void {
		// The child virtual column reports when it pins to / leaves the live edge; that flip switches the window tail↔full.
		this.autoListen(this, FOLLOW_CHANGED, this.#onFollowChanged as EventListener);
		// A rail click, drag or mark jump is the reader saying WHEN, not just where: the row it lands on carries a time,
		// so the cursor every other view reads moves with it. Wheeling through the rows does not — that is reading, and
		// a reader scrolling their own log should not drag every other view along.
		this.autoListen(this, SCROLL_TO_INDEX, this.#onRailSeek as EventListener);
	}

	#onRailSeek = (e: Event): void => {
		const index = (e as CustomEvent<{ index: number }>).detail?.index;
		const row = typeof index === "number" ? this.#filtered[index] : undefined;
		if (row) this.timeCursor = row.timestamp;
	};

	/** The span this view wants: while following the live edge, a bounded tail below the newest event; otherwise the full
	 *  history (a scrolled-back reader must reach anything). `from` clamps at 0, so a run shorter than the tail is the whole log. */
	#windowRanges(): Range[] {
		return monitorTailWindow(this.#following, this.endTime);
	}

	#onFollowChanged = (e: Event): void => {
		const { following } = (e as CustomEvent<FollowChangedDetail>).detail;
		if (following === this.#following) return;
		this.#following = following;
		this.#registeredFrom = following ? Math.max(0, this.endTime - MONITOR_TAIL_MS) : 0;
		void this.#events.updateWindow(); // narrow to the tail (evicts old) or widen to full (fetches history back)
	};

	/** While following, advance the tail's lower bound as the live edge moves — but only once it has moved a full step, so
	 *  eviction runs in coarse chunks (a reconcile per event would thrash). Re-registering evicts the events now below `from`. */
	#maybeSlide(): void {
		if (!this.#following) return;
		const from = Math.max(0, this.endTime - MONITOR_TAIL_MS);
		if (from - this.#registeredFrom < MONITOR_SLIDE_STEP_MS) return;
		this.#registeredFrom = from;
		void this.#events.updateWindow();
	}

	/** Re-derive rows from this view's window of the shared log (ShuEventConsumer owns backfill + live merge + dedup). The
	 *  fast path appends the events past the last render (the log grows at the tail). A shrink (forceRefresh) OR a front
	 *  eviction (the tail window slid its lower bound up, dropping old events) rebuilds instead — the incremental row and
	 *  cross-reference state is keyed by position, so a changed front must be rebuilt, not appended onto. */
	private onEventsChanged(): void {
		const all = this.#events.all;
		const firstKey = all.length > 0 ? eventKey(all[0]) : "";
		if (all.length < this.renderedCount || firstKey !== this.#firstKey) {
			this.rows = [];
			this.startRowIndex.clear();
			this.startTime = 0;
			this.endTime = 0;
			this.renderedCount = 0;
		}
		for (let i = this.renderedCount; i < all.length; i++) this.addEvent(all[i]);
		this.renderedCount = all.length;
		this.#firstKey = firstKey;
		this.rows = [...this.rows];
		this.#maybeSlide();
	}

	protected override onTimeSync(): void {
		this.requestUpdate();
	}

	private addEvent(e: Record<string, unknown>): void {
		if (e.kind === "artifact" && (e as Record<string, unknown>).artifactType === "dispatch-trace") {
			const trace = (e as Record<string, unknown>).trace as TDispatchTrace | undefined;
			if (trace?.seqPath) {
				const idx = this.startRowIndex.get(trace.seqPath.join("."));
				if (idx !== undefined) this.rows[idx].dispatch = trace;
			}
			return;
		}
		if (e.kind !== "lifecycle" && e.kind !== "log") return;
		const ts = (e.timestamp as number) || Date.now();
		if (!this.startTime) this.startTime = ts;
		if (ts > this.endTime) this.endTime = ts;
		const relTime = ((ts - this.startTime) / 1000).toFixed(1);
		const level = String(e.level || "info");
		const step = String(e.in || e.id || "");
		const isStep = e.kind === "lifecycle" && e.type === "step";
		const isStart = isStep && e.stage === "start";
		let message = "";
		if (e.kind === "log") message = String((e as { message?: string }).message || "");
		else if (e.kind === "lifecycle" && e.stage === "end") {
			const status = eventMarkerStyle(e).icon;
			message = `${status} ${String(e.actionName || "")}`;
		} else if (isStart) message = "";
		else if (e.kind === "lifecycle" && e.stage === "start") message = `▸ ${String(e.type || "")}`;
		let seqPath = Array.isArray(e.seqPath) ? (e.seqPath as number[]) : undefined;
		if (!seqPath && typeof e.id === "string") seqPath = parseSeqPath(e.id as string) ?? undefined;
		const isEnd = isStep && e.stage === "end";
		if (isEnd && seqPath) {
			const startIdx = this.startRowIndex.get(seqPath.join("."));
			if (startIdx !== undefined) this.rows[startIdx].hasEnd = true;
		}
		const rowIdx = this.rows.length;
		const isAsync = isStart && e.isAsync === true;
		this.rows.push({ time: `${relTime}s`, timestamp: ts, level, step, message, seqPath, isStart, isAsync, mark: markFor(e) });
		if (isStart && seqPath) this.startRowIndex.set(seqPath.join("."), rowIdx);
	}

	private onLevelChange = (e: Event): void => {
		this.setState({ level: (e.target as HTMLSelectElement).value as z.infer<typeof MonitorColumnSchema>["level"] });
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
		const { level, hideStart } = this.state;
		if (this.rows !== this.#lastRows || level !== this.#lastLevel || hideStart !== this.#lastHideStart) {
			this.#lastRows = this.rows;
			this.#lastLevel = level;
			this.#lastHideStart = hideStart;
			const minLevel = LEVEL_ORDER.indexOf(level);
			this.#filtered = this.rows.filter((r) => LEVEL_ORDER.indexOf(r.level) >= minLevel && !(hideStart && r.isStart && r.hasEnd));
			this.#source.set(this.#filtered, railMarkers(this.#filtered));
		}
		// The current-row highlight depends on the time cursor, so recompute it every update against the cached filter.
		this.#currentIdx = -1;
		if (this.timeCursor !== null)
			for (let i = this.#filtered.length - 1; i >= 0; i--)
				if (this.#filtered[i].timestamp <= this.timeCursor) {
					this.#currentIdx = i;
					break;
				}
	}

	render(): TemplateResult {
		const { level, hideStart } = this.state;
		const total = this.#source.count();
		// In the strip there is room for the rail and nothing else: no toolbar, no rows. It is the SAME virtual column in
		// both, in the same place in this template, so the element survives collapsing rather than being torn down and
		// built again — and with it the window it is showing, which is where the reader was.
		const spine = this.isSpineView;
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
					? html`<div class="log-rows">${emptyOrLoading(this.#events.loaded, "No events at this level.")}</div>`
					: html`<shu-virtual-column ?spine=${spine} .cursor=${this.#currentIdx} .source=${this.#source} .renderRow=${this.renderLogRow} ?follow=${this.state.tail}></shu-virtual-column>`
			}
		`;
	}

	/** One log row at its absolute index. The time-cursor and future classes read the derived state; `row` is always
	 *  resident (the source holds the whole filtered list), so the skeleton is only a defensive fallback. An arrow so its
	 *  identity is stable across renders, which lit-virtualizer relies on. */
	private renderLogRow = (index: number, row: unknown): TemplateResult => {
		const r = row as TLogRow | undefined;
		if (!r) return html`<div class="log-row" data-testid="monitor-log-row"></div>`;
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
			const startIdx = this.startRowIndex.get(r.seqPath.join("."));
			const dispatch = startIdx !== undefined ? this.rows[startIdx].dispatch : undefined;
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
		return html`<div class="log-row${cls}" data-testid="monitor-log-row">
			<span class="time-group" @click=${this.onTimeClick(r.timestamp)}>${r.seqPath ? html`<span class="seqpath">[${r.seqPath.join(".")}]</span> ` : ""}<span class="time">${r.time}</span></span>
			<span class="row-content" @click=${this.onRowClick(r.seqPath)}>${r.isAsync && !r.hasEnd ? html`<span class="loader"></span>` : html`<span class="icon">${LEVEL_ICONS[r.level] ?? "❓"}</span>`} <span class="step">${r.step}</span> <span class="msg">${r.message}</span>${dispatchText ? html` <span class="dispatch">${dispatchText}</span>` : ""}${capabilityText ? html` <span class="capability${capabilityRefused ? " refused" : ""}" title="capability required to run this step">${capabilityText}</span>` : ""}</span>
		</div>`;
	};
}
