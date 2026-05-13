/**
 * <shu-timeline> — Playhead slider that drives TIME_SYNC across every shu view.
 *
 * Self-contained data source: the timeline subscribes to the SSE event stream
 * directly so it tracks the latest event time without depending on the
 * monitor column being mounted. Every panel that listens on TIME_SYNC stays
 * in lockstep regardless of which panes are visible.
 *
 * The slider maps wall-clock time through a piecewise-linear function:
 * long idle gaps (above `idleThresholdMs`) collapse to a fixed visual
 * width, so a 10-second burst followed by 10 idle minutes followed by a
 * step still renders as proportional visible segments. Without that, a
 * short burst would compress into an invisible sliver against the
 * stretched wall-clock total.
 *
 * Event markers — colour-coded emoji from `eventMarkerStyle` — sit on the
 * track at each significant event's piecewise position. The vocabulary
 * matches the monitor-browser slider (feature, scenario, step end/failed,
 * log error/warn, artifact), so the two views read identically.
 *
 * Live-tailing behaviour: when the cursor sits at the latest event (the
 * "end"), incoming events extend the bounds AND auto-advance the cursor
 * so downstream views always reflect the newest state. If the user has
 * parked the cursor mid-history to review, new events extend the bounds
 * but the cursor stays where it is — review intent is preserved.
 */
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { SseClient } from "../sse-client.js";
import { buildPiecewiseTimeline, displayToTime, timeToDisplay, type TPiecewiseTimeline } from "../piecewise-timeline.js";
import { eventMarkerStyle, shouldMarkEvent } from "../event-marker.js";

const SPEED_OPTIONS = [0.02, 0.05, 1, 2];

const formatSpeed = (s: number): string => {
	if (s === 0.02) return "-50×";
	if (s === 0.05) return "-20×";
	return `${s}×`;
};

type TTrackedEvent = { timestamp: number; icon: string; color: string; label: string; seqPath?: number[] | string };

const StateSchema = z.object({
	playing: z.boolean().default(false),
	speed: z.number().default(1),
	atEnd: z.boolean().default(true),
});

const STYLES = `
:host { display: flex; align-items: center; gap: 6px; padding: 2px 6px; font: 11px ui-monospace, monospace; }
:host([hidden]) { display: none; }
button { background: none; border: none; cursor: pointer; font-size: 14px; padding: 0 3px; color: #666; }
button:hover { color: #333; }
select { font: inherit; padding: 0 2px; border: 1px solid #ddd; border-radius: 2px; }
.slider-wrap { flex: 1; position: relative; height: 22px; display: flex; align-items: center; }
input[type="range"] { width: 100%; cursor: pointer; margin: 0; position: relative; z-index: 2; background: transparent; }
.track-overlay { position: absolute; inset: 0; pointer-events: none; display: flex; align-items: center; gap: 0; z-index: 0; }
.track-overlay .seg { height: 4px; }
.track-overlay .active { background: #c9d9ee; }
.track-overlay .idle { background: repeating-linear-gradient(90deg, #e0e0e0, #e0e0e0 2px, transparent 2px, transparent 4px); }
.markers { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
.marker { position: absolute; top: 50%; transform: translate(-50%, -50%); font-size: 12px; line-height: 1; opacity: 0.65; }
.marker.error { opacity: 0.9; }
.slider-wrap { position: relative; overflow: visible; }
.knob-label { position: absolute; top: 100%; transform: translate(-50%, 2px); background: rgba(0,0,0,0.72); color: #fff; padding: 1px 5px; border-radius: 3px; font-size: 10px; line-height: 12px; white-space: nowrap; pointer-events: none; z-index: 3; }
`;

export class ShuTimeline extends ShuElement<typeof StateSchema> {
	private events: TTrackedEvent[] = [];
	private currentTime = 0; // absolute epoch ms (current playhead position)
	private piecewise: TPiecewiseTimeline = { segments: [], totalDisplay: 0 };
	private lastFrame = 0;
	private rafId = 0;
	private unsubscribe: (() => void) | null = null;
	private sse: SseClient | null = null;
	private suppressIncomingSync = false;
	private piecewiseDirty = false;
	private timeSyncDirty = false;

	constructor() {
		super(StateSchema, { playing: false, speed: 1, atEnd: true });
	}

	connectedCallback(): void {
		super.connectedCallback();
		if (this.unsubscribe) return;
		this.sse = SseClient.for("");
		this.unsubscribe = this.subscribeBatched({
			onBatch: (events) => {
				for (const ev of events) this.processEvent(ev);
				if (this.piecewiseDirty) {
					this.piecewise = buildPiecewiseTimeline(this.events.map((e) => e.timestamp));
					this.piecewiseDirty = false;
				}
				if (this.timeSyncDirty) {
					this.timeSyncDirty = false;
					this.dispatchTimeSync();
				}
				this.render();
			},
		});
	}

	disconnectedCallback(): void {
		this.stopPlayback();
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.sse = null;
	}

	/**
	 * Record an event with its timestamp and marker style. Tests call this
	 * directly to drive the timeline without an SSE source; the SSE path uses
	 * `subscribeBatched` which queues raw events for batch processing instead.
	 */
	addEvent(event: unknown): void {
		this.processEvent(event);
		if (this.piecewiseDirty) {
			this.piecewise = buildPiecewiseTimeline(this.events.map((e) => e.timestamp));
			this.piecewiseDirty = false;
		}
		if (this.timeSyncDirty) {
			this.timeSyncDirty = false;
			this.dispatchTimeSync();
		}
		this.render();
	}

	private processEvent(event: unknown): void {
		const ts = (event as { timestamp?: number })?.timestamp;
		if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return;
		const marked = shouldMarkEvent(event);
		const { icon, color } = marked ? eventMarkerStyle(event) : { icon: "", color: "" };
		const label = describeEvent(event);
		const seqPath = (event as { seqPath?: number[] | string })?.seqPath;
		this.events.push({ timestamp: ts, icon, color, label, seqPath });
		this.piecewiseDirty = true;
		if (this.state.atEnd) {
			this.currentTime = ts;
			this.timeSyncDirty = true;
		}
	}

	private lastEventTime(): number {
		return this.events.length === 0 ? 0 : this.events[this.events.length - 1].timestamp;
	}

	private firstEventTime(): number {
		return this.events.length === 0 ? 0 : this.events[0].timestamp;
	}

	private dispatchTimeSync(): void {
		if (this.events.length === 0) return;
		this.suppressIncomingSync = true;
		try {
			this.dispatchEvent(
				new CustomEvent(SHU_EVENT.TIME_SYNC, {
					bubbles: true,
					composed: true,
					detail: { currentTime: this.currentTime, startTime: this.firstEventTime() },
				}),
			);
		} finally {
			this.suppressIncomingSync = false;
		}
	}

	protected onTimeSync(cursor: number | null): void {
		if (this.suppressIncomingSync || cursor == null) return;
		this.currentTime = cursor;
		const atEnd = this.currentTime >= this.lastEventTime();
		if (this.state.atEnd !== atEnd) this.setState({ atEnd });
		this.updateSliderPosition();
	}

	private togglePlay(): void {
		if (this.state.playing) {
			this.stopPlayback();
		} else {
			this.lastFrame = performance.now();
			if (this.currentTime >= this.lastEventTime()) this.currentTime = this.firstEventTime();
			this.setState({ playing: true });
			this.tick();
		}
		this.render();
	}

	private stopPlayback(): void {
		if (this.rafId) cancelAnimationFrame(this.rafId);
		this.rafId = 0;
		if (this.state.playing) this.setState({ playing: false });
	}

	private tick = (): void => {
		if (!this.state.playing) return;
		const now = performance.now();
		const elapsed = now - this.lastFrame;
		this.lastFrame = now;
		const lastTime = this.lastEventTime();
		this.currentTime = Math.min(lastTime, this.currentTime + elapsed * this.state.speed);
		const reachedEnd = this.currentTime >= lastTime;
		if (this.state.atEnd !== reachedEnd) this.setState({ atEnd: reachedEnd });
		this.dispatchTimeSync();
		this.updateSliderPosition();
		if (reachedEnd) {
			this.stopPlayback();
			this.render();
			return;
		}
		this.rafId = requestAnimationFrame(this.tick);
	};

	/**
	 * 1-based position of the event at or just before `currentTime` within the
	 * timeline's local events array. Returns 0 when the cursor sits before the
	 * first known event (e.g. just after Restart).
	 */
	private currentEventIndex(): number {
		const n = this.events.length;
		if (n === 0) return 0;
		if (this.currentTime < this.events[0].timestamp) return 0;
		let lo = 0;
		let hi = n - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >>> 1;
			if (this.events[mid].timestamp <= this.currentTime) lo = mid;
			else hi = mid - 1;
		}
		return lo + 1;
	}

	private updateSliderPosition(): void {
		const slider = this.shadowRoot?.querySelector("input[type=range]") as HTMLInputElement | null;
		if (!slider) return;
		const display = Math.round(timeToDisplay(this.piecewise, this.currentTime));
		slider.value = String(display);
		this.refreshKnobLabel(display);
	}

	/**
	 * Move the `.knob-label` to match `display` (slider position) and rewrite
	 * its text. Called from the live drag handler and from `updateSliderPosition`
	 * so the label tracks the thumb whether the move came from the user or a
	 * TIME_SYNC pushed by another consumer.
	 */
	private refreshKnobLabel(display: number): void {
		const knob = this.shadowRoot?.querySelector(".knob-label") as HTMLElement | null;
		if (!knob) return;
		const total = Math.max(1, Math.round(this.piecewise.totalDisplay));
		const pct = total > 0 ? (display / total) * 100 : 0;
		knob.style.left = `${pct.toFixed(2)}%`;
		const count = this.events.length;
		const totalRecorded = this.sse ? this.sse.totalRecorded() : count;
		const current = this.currentEventIndex();
		knob.textContent = totalRecorded > count ? `${current} / ${count} / ${totalRecorded}` : `${current} / ${count}`;
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		const total = Math.max(1, Math.round(this.piecewise.totalDisplay));
		const display = Math.round(timeToDisplay(this.piecewise, this.currentTime));
		const speedOptions = SPEED_OPTIONS.map((s) => `<option value="${s}"${s === this.state.speed ? " selected" : ""}>${formatSpeed(s)}</option>`).join("");
		const segments = this.piecewise.segments
			.map((seg) => {
				const width = seg.displayEnd - seg.displayStart;
				const pct = (width / total) * 100;
				return `<div class="seg ${seg.kind}" style="width:${pct.toFixed(2)}%"></div>`;
			})
			.join("");
		const markers = this.events
			.filter((e) => e.icon)
			.map((e) => {
				const pos = timeToDisplay(this.piecewise, e.timestamp);
				const pct = (pos / total) * 100;
				const cls = e.color === "#ef4444" ? "marker error" : "marker";
				const label = escapeAttr(`${e.label} @ ${formatRelative(e.timestamp - this.firstEventTime())}`);
				return `<span class="${cls}" style="left:${pct.toFixed(2)}%;color:${e.color}" title="${label}">${e.icon}</span>`;
			})
			.join("");
		// Slider knob badge: `current / count` of the events the timeline has
		// received; when the SSE replay buffer has wrapped (subscriber recorded
		// more than the buffer holds), append ` / total` so the truncation is
		// visible to the user.
		const count = this.events.length;
		const totalRecorded = this.sse ? this.sse.totalRecorded() : count;
		const wrapped = totalRecorded > count;
		const current = this.currentEventIndex();
		const knobLabel = wrapped ? `${current} / ${count} / ${totalRecorded}` : `${current} / ${count}`;
		const knobPct = total > 0 ? (display / total) * 100 : 0;
		this.shadowRoot.innerHTML = `<style>${STYLES}</style>
			<button data-action="restart" data-testid="timeline-restart" title="Restart">⏮</button>
			<button data-action="play" data-testid="timeline-play" title="${this.state.playing ? "Pause" : "Play"}">${this.state.playing ? "⏸️" : "▶️"}</button>
			<select data-action="speed" data-testid="timeline-speed" title="Playback speed">${speedOptions}</select>
			<div class="slider-wrap">
				<div class="track-overlay">${segments}</div>
				<div class="markers">${markers}</div>
				<input type="range" data-testid="timeline-slider" min="0" max="${total}" value="${display}">
				<span class="knob-label" data-testid="timeline-knob-label" style="left:${knobPct.toFixed(2)}%">${knobLabel}</span>
			</div>`;
		this.shadowRoot.querySelector("[data-action=restart]")?.addEventListener("click", () => {
			// Cursor parks one millisecond before the first event so views that
			// filter with `timestamp <= cursor` render an empty pre-run state.
			// The slider track still aligns visually with the first segment.
			this.currentTime = this.firstEventTime() - 1;
			if (this.state.atEnd) this.setState({ atEnd: false });
			this.dispatchTimeSync();
			this.render();
		});
		this.shadowRoot.querySelector("[data-action=play]")?.addEventListener("click", () => this.togglePlay());
		this.shadowRoot.querySelector("[data-action=speed]")?.addEventListener("change", (e) => {
			this.setState({ speed: parseFloat((e.target as HTMLSelectElement).value) });
		});
		this.shadowRoot.querySelector("input[type=range]")?.addEventListener("input", (e) => {
			const pos = parseInt((e.target as HTMLInputElement).value, 10);
			// Slider value 0 represents the pre-run cursor (one millisecond
			// before the first event) so views filtering with `timestamp <=
			// cursor` show an empty graph at start. Any non-zero position
			// maps through the piecewise function as usual.
			this.currentTime = pos === 0 ? this.firstEventTime() - 1 : displayToTime(this.piecewise, pos);
			const atEnd = this.currentTime >= this.lastEventTime();
			if (this.state.atEnd !== atEnd) this.setState({ atEnd });
			// Reposition the knob label in lockstep with the drag — dispatchTimeSync's
			// suppressIncomingSync flag silences our own TIME_SYNC handler so the
			// label would otherwise stay parked at its last-rendered position.
			this.refreshKnobLabel(pos);
			this.dispatchTimeSync();
		});
	}
}

function formatRelative(ms: number): string {
	const seconds = ms / 1000;
	if (Math.abs(seconds) < 60) return `${seconds.toFixed(1)}s`;
	return `${(seconds / 60).toFixed(1)}m`;
}

function describeEvent(event: unknown): string {
	const e = event as { kind?: string; type?: string; in?: string; status?: string; level?: string };
	if (e.kind === "lifecycle" && e.type === "step") return e.in ?? "step";
	if (e.kind === "lifecycle") return `${e.type ?? "lifecycle"}`;
	if (e.kind === "log") return `log/${e.level ?? "?"}`;
	if (e.kind === "artifact") return "artifact";
	return e.kind ?? "event";
}

function escapeAttr(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
