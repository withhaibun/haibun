/**
 * <shu-monitor-column> — Live execution log stream in a miller column.
 * A ShuEventConsumer: the base owns the shared event log (one backfill + live merge + dedup); this view only derives
 * its rows from it. Clickable time values dispatch TIME_SYNC for cross-view synchronization.
 */
import { html, css, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { z } from "zod";
import { shuBaseStyles } from "./styles.js";
import { ShuElement, TIME_SYNC_CLASS, type TLinkedData } from "./shu-element.js";
import { EventsController } from "../controllers/index.js";
import "./shu-virtual-column.js";
import { virtualColumnCss } from "./shu-virtual-column.js";
import { arrayWindowedSource } from "../windowed-source.js";
import type { TScrollMarker } from "../scrollbar-model.js";
import { emptyOrLoading } from "./empty-state.js";
import { PaneState } from "../pane-state.js";
import { parseSeqPath } from "../quad-detail-pane.js";
import type { TDispatchTrace } from "../schemas.js";

const MonitorColumnSchema = z.object({
	level: z.enum(["debug", "trace", "info", "warn", "error"]).default("info"),
	tail: z.boolean().default(true),
	hideStart: z.boolean().default(true),
});

type TLogRow = {
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
};

const LEVEL_ICONS: Record<string, string> = { error: "❌", warn: "⚠️", info: "ℹ️", debug: "💬", trace: "🔍" };
const LEVEL_ORDER = ["debug", "trace", "log", "info", "warn", "error"];

export class ShuMonitorColumn extends ShuElement<typeof MonitorColumnSchema> {
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

	#events = new EventsController(this, () => this.onEventsChanged());
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

	/** Re-derive rows from the shared event log (ShuEventConsumer owns backfill + live merge + dedup). The log is
	 *  append-only, so append rows only for events past the last render; a cache reset (forceRefresh) shrinks it, so rebuild. */
	private onEventsChanged(): void {
		const all = this.#events.all;
		if (all.length < this.renderedCount) {
			this.rows = [];
			this.startRowIndex.clear();
			this.startTime = 0;
			this.endTime = 0;
			this.renderedCount = 0;
		}
		for (let i = this.renderedCount; i < all.length; i++) this.addEvent(all[i]);
		this.renderedCount = all.length;
		this.rows = [...this.rows];
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
			const status = e.status === "completed" ? "✅" : e.status === "failed" ? "❌" : "";
			message = `${status} ${String(e.actionName || "")}`;
		} else if (isStart) message = "";
		else if (e.kind === "lifecycle" && e.stage === "start") message = `▸ ${String(e.type || "")}`;
		let seqPath = Array.isArray(e.seqPath) ? (e.seqPath as number[]) : undefined;
		if (!seqPath && typeof e.id === "string") seqPath = parseSeqPath(e.id as string);
		const isEnd = isStep && e.stage === "end";
		if (isEnd && seqPath) {
			const startIdx = this.startRowIndex.get(seqPath.join("."));
			if (startIdx !== undefined) this.rows[startIdx].hasEnd = true;
		}
		const rowIdx = this.rows.length;
		const isAsync = isStart && e.isAsync === true;
		this.rows.push({ time: `${relTime}s`, timestamp: ts, level, step, message, seqPath, isStart, isAsync });
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

	// Derive the resident window source before each render: the level/hide-start filter, the rail markers (error and warn
	// rows, so a failure is visible on the rail across the whole log), and the time-cursor row. shu-virtual-column reads
	// the source and virtualizes; its notify-driven follow tails the live edge.
	protected willUpdate(): void {
		const { level, hideStart } = this.state;
		if (this.rows !== this.#lastRows || level !== this.#lastLevel || hideStart !== this.#lastHideStart) {
			this.#lastRows = this.rows;
			this.#lastLevel = level;
			this.#lastHideStart = hideStart;
			const minLevel = LEVEL_ORDER.indexOf(level);
			this.#filtered = this.rows.filter((r) => LEVEL_ORDER.indexOf(r.level) >= minLevel && !(hideStart && r.isStart && r.hasEnd));
			const markers: TScrollMarker[] = [];
			for (let i = 0; i < this.#filtered.length; i++) {
				const lvl = this.#filtered[i].level;
				if (lvl === "error" || lvl === "warn") markers.push({ index: i, id: `${this.#filtered[i].step}-${i}`, icon: LEVEL_ICONS[lvl], color: lvl === "error" ? "#ef4444" : "#eab308", label: this.#filtered[i].message });
			}
			this.#source.set(this.#filtered, markers);
		}
		// The current-row highlight depends on the time cursor, so recompute it every update against the cached filter.
		this.#currentIdx = -1;
		if (this.timeCursor !== null) for (let i = this.#filtered.length - 1; i >= 0; i--) if (this.#filtered[i].timestamp <= this.timeCursor) { this.#currentIdx = i; break; }
	}

	render(): TemplateResult {
		const { level, hideStart } = this.state;
		const total = this.#source.count();
		return html`
			<div class="toolbar" data-testid="monitor-log-stream">
				<select data-action="level" @change=${this.onLevelChange}>${LEVEL_ORDER.map((l) => html`<option value=${l} ?selected=${l === level}>${l}</option>`)}</select>
				<label class="hide-start"><input type="checkbox" data-action="hide-start" .checked=${hideStart} @change=${this.onHideStartChange}/> hide start</label>
				<span class="count">${total} events</span>
			</div>
			${
				total === 0
					? html`<div class="log-rows">${emptyOrLoading(this.#events.loaded, "No events at this level.")}</div>`
					: html`<shu-virtual-column .source=${this.#source} .renderRow=${this.renderLogRow} ?follow=${this.state.tail}></shu-virtual-column>`
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
		if (!r.isStart && r.seqPath) {
			const startIdx = this.startRowIndex.get(r.seqPath.join("."));
			const dispatch = startIdx !== undefined ? this.rows[startIdx].dispatch : undefined;
			if (dispatch) {
				const dur = dispatch.durationMs !== undefined ? `${dispatch.durationMs}ms` : "";
				dispatchText = `${dispatch.transport}${dur ? ` ${dur}` : ""}`;
			}
		}
		return html`<div class="log-row${cls}" data-testid="monitor-log-row">
			<span class="time-group" @click=${this.onTimeClick(r.timestamp)}>${r.seqPath ? html`<span class="seqpath">[${r.seqPath.join(".")}]</span> ` : ""}<span class="time">${r.time}</span></span>
			<span class="row-content" @click=${this.onRowClick(r.seqPath)}>${r.isAsync && !r.hasEnd ? html`<span class="loader"></span>` : html`<span class="icon">${LEVEL_ICONS[r.level] ?? "❓"}</span>`} <span class="step">${r.step}</span> <span class="msg">${r.message}</span>${dispatchText ? html` <span class="dispatch">${dispatchText}</span>` : ""}</span>
		</div>`;
	};
}
