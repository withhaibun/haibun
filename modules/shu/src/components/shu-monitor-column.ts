/**
 * <shu-monitor-column> — Live execution log stream in a miller column.
 * Fetches initial events from MonitorStepper via RPC on connect,
 * then subscribes to SSE for live updates. No polling.
 * Clickable time values dispatch TIME_SYNC for cross-view synchronization.
 */
import { z } from "zod";
import { ShuElement, TIME_SYNC_CLASS } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { parseSeqPath } from "../quad-detail-pane.js";
import { SseClient, inAction } from "../sse-client.js";
import { esc } from "../util.js";
import type { ShuTimeline } from "./shu-timeline.js";

const MonitorColumnSchema = z.object({
	level: z.enum(["debug", "trace", "info", "warn", "error"]).default("info"),
	tail: z.boolean().default(true),
	hideStart: z.boolean().default(true),
});

import type { TDispatchTrace } from "../schemas.js";

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

const LEVEL_ICONS: Record<string, string> = {
	error: "\u274c",
	warn: "\u26a0\ufe0f",
	info: "\u2139\ufe0f",
	debug: "\ud83d\udcac",
	trace: "\ud83d\udd0d",
};
const LEVEL_ORDER = ["debug", "trace", "log", "info", "warn", "error"];

const STYLES = `
:host { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: auto; font-family: ui-monospace, monospace; font-size: 12px; }
:host(:not([data-show-controls])) .toolbar { display: none; }
.toolbar { display: flex; gap: 6px; align-items: center; padding: 4px 8px; background: #f5f5f5; border-bottom: 1px solid #ddd; flex: 0 0 auto; }
.toolbar select { font-size: 11px; padding: 1px 4px; }
.toolbar .count { margin-left: auto; color: #888; font-size: 11px; }
.toolbar .hide-start { font-size: 10px; color: #888; cursor: pointer; display: flex; align-items: center; gap: 2px; }
.log-rows { flex: 1; overflow: auto; }
.log-row { display: grid; grid-template-columns: 130px 1fr; border-bottom: 1px solid #f0f0f0; font-size: 11px; line-height: 1.4; }
.log-row:hover { background: #f8f8f8; }
.log-row .time-group { display: flex; gap: 4px; padding: 1px 4px; cursor: pointer; border-right: 1px solid #eee; }
.log-row .time-group:hover { color: #E87A5D; }
.log-row .row-content { padding: 1px 4px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.log-row .time { color: #888; margin-left: auto; }
.log-row .time-group:hover .time { color: #E87A5D; }
.log-row .seqpath { color: #555; font-size: 10px; }
.log-row .dispatch { color: #888; font-size: 10px; margin-left: 4px; }
.loader { display: inline-block; width: 10px; height: 10px; border: 2px solid #ddd; border-top-color: #E87A5D; border-radius: 50%; animation: spin 1.2s linear infinite; vertical-align: middle; }
@keyframes spin { to { transform: rotate(360deg); } }
.log-row .step { color: #333; font-weight: 500; }
.log-row .msg { color: #555; }
.log-row.error { background: #fff0f0; }
.log-row.warn { background: #fffde7; }
.log-row.speculative { opacity: 0.5; }
.empty { padding: 16px; color: #888; text-align: center; }
`;

export class ShuMonitorColumn extends ShuElement<typeof MonitorColumnSchema> {
	private rows: TLogRow[] = [];
	private unsubscribe?: () => void;
	private startTime = 0;
	private endTime = 0;

	constructor() {
		super(MonitorColumnSchema, { level: "info", tail: true, hideStart: true });
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		const client = SseClient.for("");
		try {
			const data = await inAction((scope) => client.rpc<{ events: Array<Record<string, unknown>> }>(scope, "MonitorStepper-getEvents"));
			if (data.events) {
				for (const e of data.events) this.addEvent(e);
				this.updateTimeline();
				this.renderRows();
			}
		} catch {
			// load failure isn't fatal — the column stays in its current state and the next refresh tries again.
		}

		if (this.hasAttribute("data-snapshot-time")) return;

		this.unsubscribe = client.onEvent((event) => {
			const e = event as Record<string, unknown>;
			this.addEvent(e);
			this.updateTimeline();
			this.renderRows();
		});
	}

	protected override onTimeSync(): void {
		this.renderRows();
	}

	disconnectedCallback(): void {
		this.unsubscribe?.();
	}

	private startRowIndex = new Map<string, number>();
	private seenEventIds = new Set<string>();

	private addEvent(e: Record<string, unknown>): void {
		// Deduplicate by event id + stage (backfill + SSE can overlap)
		const eventKey = `${e.id}:${e.stage || e.kind}`;
		if (this.seenEventIds.has(eventKey)) return;
		this.seenEventIds.add(eventKey);
		// Attach dispatch trace to matching start row
		if (e.kind === "artifact" && (e as Record<string, unknown>).artifactType === "dispatch-trace") {
			const trace = (e as Record<string, unknown>).trace as TDispatchTrace | undefined;
			if (trace?.seqPath) {
				const key = trace.seqPath.join(".");
				const idx = this.startRowIndex.get(key);
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
			const status = e.status === "completed" ? "\u2705" : e.status === "failed" ? "\u274c" : "";
			message = `${status} ${String(e.actionName || "")}`;
		} else if (isStart) {
			message = "";
		} else if (e.kind === "lifecycle" && e.stage === "start") {
			message = `\u25b8 ${String(e.type || "")}`;
		}
		let seqPath = Array.isArray(e.seqPath) ? (e.seqPath as number[]) : undefined;
		if (!seqPath && typeof e.id === "string") seqPath = parseSeqPath(e.id as string);

		// Match step start/end by seqPath
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

	private updateTimeline(): void {
		const timeline = this.shadowRoot?.querySelector("shu-timeline") as ShuTimeline | null;
		if (timeline && this.startTime && this.endTime) {
			timeline.setBounds(this.startTime, this.endTime);
			// On first load, set slider to end (show all data)
			if (this.timeCursor === null) timeline.seek(this.endTime - this.startTime);
		}
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		const { level, hideStart } = this.state;
		this.shadowRoot.innerHTML = `${this.css(STYLES)}
			<div class="toolbar" data-testid="monitor-log-stream">
				<select data-action="level">${LEVEL_ORDER.map((l) => `<option value="${l}"${l === level ? " selected" : ""}>${l}</option>`).join("")}</select>
				<label class="hide-start"><input type="checkbox" data-action="hide-start" ${hideStart ? "checked" : ""}> hide start</label>
				<span class="count">${this.rows.length} events</span>
			</div>
			<shu-timeline></shu-timeline><div class="log-rows"></div>`;

		this.shadowRoot.querySelector("[data-action=level]")?.addEventListener("change", (e) => {
			this.setState({ level: (e.target as HTMLSelectElement).value as typeof level });
		});
		this.shadowRoot.querySelector("[data-action=hide-start]")?.addEventListener("change", (e) => {
			this.setState({ hideStart: (e.target as HTMLInputElement).checked });
		});
		this.updateTimeline();
		this.renderRows();
	}

	private renderRows(): void {
		const container = this.shadowRoot?.querySelector(".log-rows");
		if (!container) return;
		const minLevel = LEVEL_ORDER.indexOf(this.state.level);
		const { hideStart } = this.state;
		const filtered = this.rows.filter((r) => LEVEL_ORDER.indexOf(r.level) >= minLevel && !(hideStart && r.isStart && r.hasEnd));
		const count = this.shadowRoot?.querySelector(".count");
		if (count) count.textContent = `${filtered.length} events`;

		if (filtered.length === 0) {
			container.innerHTML = `<div class="empty">No events at this level.</div>`;
			return;
		}

		// Find the current row (closest at or before cursor)
		let currentIdx = -1;
		if (this.timeCursor !== null) {
			for (let i = filtered.length - 1; i >= 0; i--) {
				if (filtered[i].timestamp <= this.timeCursor) {
					currentIdx = i;
					break;
				}
			}
		}

		container.innerHTML = filtered
			.map((r, i) => {
				let cls = r.level === "error" ? " error" : r.level === "warn" ? " warn" : "";
				if (this.timeCursor !== null) {
					if (this.isFuture(r.timestamp)) cls += ` ${TIME_SYNC_CLASS.FUTURE}`;
					if (i === currentIdx) cls += ` ${TIME_SYNC_CLASS.CURRENT}`;
				}
				const clickAttr = r.seqPath ? ` data-seqpath="${r.seqPath.join(",")}"` : "";
				const seqLabel = r.seqPath ? `<span class="seqpath">[${r.seqPath.join(".")}]</span> ` : "";
				// Show dispatch info (transport, duration) from the matching start row
				let dispatchLabel = "";
				if (!r.isStart && r.seqPath) {
					const startIdx = this.startRowIndex.get(r.seqPath.join("."));
					const dispatch = startIdx !== undefined ? this.rows[startIdx].dispatch : undefined;
					if (dispatch) {
						const dur = dispatch.durationMs !== undefined ? `${dispatch.durationMs}ms` : "";
						dispatchLabel = ` <span class="dispatch">${esc(dispatch.transport)}${dur ? ` ${dur}` : ""}</span>`;
					}
				}
				const statusIcon = r.isAsync && !r.hasEnd ? '<span class="loader"></span>' : `<span class="icon">${LEVEL_ICONS[r.level] ?? "\u2753"}</span>`;
				return `<div class="log-row${cls}"><span class="time-group" data-timestamp="${r.timestamp}">${seqLabel}<span class="time">${esc(r.time)}</span></span><span class="row-content"${clickAttr}>${statusIcon} <span class="step">${esc(r.step)}</span> <span class="msg">${esc(r.message)}</span>${dispatchLabel}</span></div>`;
			})
			.join("");

		// Click on time or seqPath → seek timeline and dispatch TIME_SYNC
		container.querySelectorAll(".time-group[data-timestamp]").forEach((el) => {
			el.addEventListener("click", (e) => {
				e.stopPropagation();
				const ts = parseInt((el as HTMLElement).dataset.timestamp ?? "0", 10);
				this.timeCursor = ts;
				const timeline = this.shadowRoot?.querySelector("shu-timeline") as ShuTimeline | null;
				if (timeline && this.startTime) timeline.seek(ts - this.startTime);
				this.dispatchEvent(
					new CustomEvent(SHU_EVENT.TIME_SYNC, {
						bubbles: true,
						composed: true,
						detail: { currentTime: ts, startTime: this.startTime },
					}),
				);
				this.renderRows();
			});
		});

		// Click on row content → open step detail
		container.querySelectorAll(".row-content[data-seqpath]").forEach((el) => {
			el.addEventListener("click", () => {
				const seqPath = (el as HTMLElement).dataset.seqpath?.split(",").map(Number);
				if (seqPath) this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_OPEN_STEP, { detail: { seqPath }, bubbles: true, composed: true }));
			});
		});

		// Scroll: if cursor active, scroll to current row; otherwise tail
		if (this.timeCursor !== null && currentIdx >= 0) {
			container.children[currentIdx]?.scrollIntoView({ block: "center", behavior: "smooth" });
		} else if (this.state.tail) {
			container.scrollTop = container.scrollHeight;
		}
	}
}
