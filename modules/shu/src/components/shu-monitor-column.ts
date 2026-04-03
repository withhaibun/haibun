/**
 * <shu-monitor-column> — Live execution log stream in a miller column.
 * Fetches initial events from MonitorStepper via RPC on connect,
 * then subscribes to SSE for live updates. No polling.
 * Uses shu-result-table for scrollable rows.
 */
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { SseClient } from "../sse-client.js";
import { esc } from "../util.js";

const MonitorColumnSchema = z.object({
	level: z.enum(["debug", "trace", "info", "warn", "error"]).default("info"),
	tail: z.boolean().default(true),
});

type TLogRow = { time: string; level: string; step: string; message: string };

const LEVEL_ICONS: Record<string, string> = { error: "\u274c", warn: "\u26a0\ufe0f", info: "\u2139\ufe0f", debug: "\ud83d\udcac", trace: "\ud83d\udd0d" };
const LEVEL_ORDER = ["debug", "trace", "log", "info", "warn", "error"];

const STYLES = `
:host { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: auto; font-family: ui-monospace, monospace; font-size: 12px; }
.toolbar { display: flex; gap: 6px; align-items: center; padding: 4px 8px; background: #f5f5f5; border-bottom: 1px solid #ddd; flex: 0 0 auto; }
.toolbar select { font-size: 11px; padding: 1px 4px; }
.toolbar .count { margin-left: auto; color: #888; font-size: 11px; }
.log-rows { flex: 1; overflow: auto; }
.log-row { padding: 1px 4px; border-bottom: 1px solid #f0f0f0; white-space: nowrap; font-size: 11px; line-height: 1.4; }
.log-row:hover { background: #f8f8f8; }
.log-row .time { color: #888; }
.log-row .icon { }
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

	constructor() {
		super(MonitorColumnSchema, { level: "info", tail: true });
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		const client = SseClient.for("");

		// One-time backfill from stepper
		try {
			const data = await client.rpc<{ events: Array<Record<string, unknown>> }>("MonitorStepper-getEvents");
			if (data.events) {
				for (const e of data.events) this.addEvent(e);
				this.renderRows();
			}
		} catch {
			/* stepper may not be loaded */
		}

		// Live updates via SSE — no further RPC calls
		this.unsubscribe = client.onEvent((event) => {
			const e = event as Record<string, unknown>;
			if (e.kind === "lifecycle" || e.kind === "log") {
				this.addEvent(e);
				this.renderRows();
			}
		});
	}

	disconnectedCallback(): void {
		this.unsubscribe?.();
	}

	private addEvent(e: Record<string, unknown>): void {
		const ts = (e.timestamp as number) || Date.now();
		if (!this.startTime) this.startTime = ts;
		const relTime = ((ts - this.startTime) / 1000).toFixed(1);
		const level = String(e.level || "info");
		const step = String(e.in || e.id || "");
		let message = "";
		if (e.kind === "log") message = String((e as { message?: string }).message || "");
		else if (e.kind === "lifecycle" && e.stage === "end") {
			const status = e.status === "completed" ? "\u2705" : e.status === "failed" ? "\u274c" : "";
			message = `${status} ${String(e.actionName || "")}`;
		} else if (e.kind === "lifecycle" && e.stage === "start") {
			message = `\u23f3 ${String(e.type || "")}`;
		}
		this.rows.push({ time: `${relTime}s`, level, step, message });
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		const { level } = this.state;
		this.shadowRoot.innerHTML = `${this.css(STYLES)}
			<div class="toolbar" data-testid="monitor-log-stream">
				<select data-action="level">${LEVEL_ORDER.map((l) => `<option value="${l}"${l === level ? " selected" : ""}>${l}</option>`).join("")}</select>
				<span class="count">${this.rows.length} events</span>
			</div>
			<div class="log-rows"></div>`;

		this.shadowRoot.querySelector("[data-action=level]")?.addEventListener("change", (e) => {
			this.setState({ level: (e.target as HTMLSelectElement).value as typeof level });
		});
		this.renderRows();
	}

	private renderRows(): void {
		const container = this.shadowRoot?.querySelector(".log-rows");
		if (!container) return;
		const minLevel = LEVEL_ORDER.indexOf(this.state.level);
		const filtered = this.rows.filter((r) => LEVEL_ORDER.indexOf(r.level) >= minLevel);
		const count = this.shadowRoot?.querySelector(".count");
		if (count) count.textContent = `${filtered.length} events`;

		if (filtered.length === 0) {
			container.innerHTML = `<div class="empty">No events at this level.</div>`;
			return;
		}

		container.innerHTML = filtered
			.map((r) => {
				const cls = r.level === "error" ? " error" : r.level === "warn" ? " warn" : "";
				return `<div class="log-row${cls}"><span class="time">${esc(r.time)}</span> <span class="icon">${LEVEL_ICONS[r.level] ?? "\u2753"}</span> <span class="step">${esc(r.step)}</span> <span class="msg">${esc(r.message)}</span></div>`;
			})
			.join("");

		if (this.state.tail) container.scrollTop = container.scrollHeight;
	}
}
