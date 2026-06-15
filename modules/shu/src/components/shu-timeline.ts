/**
 * <shu-timeline> — Playhead slider that drives TIME_SYNC across every shu view.
 *
 * Self-contained data source: subscribes to the EventStream so it tracks the
 * latest event time regardless of which other panes are mounted.
 *
 * The slider maps wall-clock time through a piecewise-linear function (idle
 * gaps collapse to a fixed visual width).
 *
 * Event markers (colour-coded emoji from `eventMarkerStyle`) sit on the track
 * at each significant event's piecewise position.
 *
 * Live-tailing: when the cursor sits at "end", incoming events advance it. With
 * the cursor parked mid-history, new events extend bounds but leave the cursor.
 */
import { html, css, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { SHU_EVENT } from "../consts.js";
import { eventStream, type EventStream } from "../event-stream.js";
import { buildPiecewiseTimeline, displayToTime, timeToDisplay, type TPiecewiseTimeline } from "../piecewise-timeline.js";
import { eventMarkerStyle, shouldMarkEvent } from "../event-marker.js";

const SPEED_OPTIONS = [0.02, 0.05, 1, 2];
const formatSpeed = (s: number): string => (s === 0.02 ? "-50×" : s === 0.05 ? "-20×" : `${s}×`);

type TTrackedEvent = { timestamp: number; icon: string; color: string; label: string; seqPath?: number[] | string };

const StateSchema = z.object({
	playing: z.boolean().default(false),
	speed: z.number().default(1),
	atEnd: z.boolean().default(true),
});

export class ShuTimeline extends ShuElement<typeof StateSchema> {
	static styles = [shuBaseStyles, css`
		:host { display: flex; align-items: center; gap: var(--shu-space-3); padding: var(--shu-space-1) var(--shu-space-3); font: var(--shu-font-sm) var(--shu-font-family); }
		:host([hidden]) { display: none; }
		button { background: none; border: none; cursor: pointer; font-size: var(--shu-font-lg); padding: 0 3px; color: var(--shu-fg-muted); }
		button:hover { color: var(--shu-fg); }
		select { font: inherit; padding: 0 var(--shu-space-1); border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); }
		.slider-wrap { flex: 1; position: relative; height: 22px; display: flex; align-items: center; overflow: visible; }
		input[type="range"] { width: 100%; cursor: pointer; margin: 0; position: relative; z-index: 2; background: transparent; }
		.track-overlay { position: absolute; inset: 0; pointer-events: none; display: flex; align-items: center; gap: 0; z-index: 0; }
		.track-overlay .seg { height: 4px; }
		.track-overlay .active { background: var(--shu-bg-info-soft); }
		.track-overlay .idle { background: repeating-linear-gradient(90deg, var(--shu-border), var(--shu-border) 2px, transparent 2px, transparent 4px); }
		.markers { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
		.marker { position: absolute; top: 50%; transform: translate(-50%, -50%); font-size: var(--shu-font-md); line-height: 1; opacity: 0.65; }
		.marker.error { opacity: 0.9; }
		.knob-label {
			position: absolute; top: 100%; transform: translate(-50%, 2px);
			background: var(--shu-fg); color: var(--shu-bg);
			padding: 1px 5px; border-radius: var(--shu-radius);
			font-size: var(--shu-font-xs); line-height: 12px;
			white-space: nowrap; pointer-events: none; z-index: 3;
		}
	`];

	@property({ attribute: false }) accessor events: TTrackedEvent[] = [];

	private currentTime = 0;
	private piecewise: TPiecewiseTimeline = { segments: [], totalDisplay: 0 };
	private lastFrame = 0;
	private rafId = 0;
	private unsubscribe: (() => void) | null = null;
	private sse: EventStream | null = null;
	private piecewiseDirty = false;
	private timeSyncDirty = false;

	constructor() {
		super(StateSchema, { playing: false, speed: 1, atEnd: true });
	}

	protected override onConnected(): void {
		if (this.unsubscribe) return;
		try {
			this.sse = eventStream();
		} catch {
			this.sse = null;
		}
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
				this.events = [...this.events];
			},
		});
	}

	protected override onDisconnected(): void {
		this.stopPlayback();
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.sse = null;
	}

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
		this.events = [...this.events];
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

	/** Publish the scrubber position to the global cursor signal; the `cursor === this.currentTime` guard in onTimeSync makes the self-echo a no-op. */
	private dispatchTimeSync(): void {
		if (this.events.length === 0) return;
		// At the live edge, publish a null cursor — "now", no upper bound — so a freshly-written record (timestamp
		// newer than the last event we've processed) is not filtered out as "future" before its own timeline event
		// lands. Only a scrub into the past publishes a concrete cutoff. This mirrors a reload, which never
		// time-filters live data. The scrubber still reads its own currentTime, so the playhead stays at the end.
		this.timeCursor = this.state.atEnd ? null : this.currentTime;
	}

	protected onTimeSync(cursor: number | null): void {
		if (cursor == null || cursor === this.currentTime) return;
		this.currentTime = cursor;
		const atEnd = this.currentTime >= this.lastEventTime();
		if (this.state.atEnd !== atEnd) this.setState({ atEnd });
		this.requestUpdate();
	}

	private togglePlay = (): void => {
		if (this.state.playing) this.stopPlayback();
		else {
			this.lastFrame = performance.now();
			if (this.currentTime >= this.lastEventTime()) this.currentTime = this.firstEventTime();
			this.setState({ playing: true });
			this.tick();
		}
	};

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
		this.requestUpdate();
		if (reachedEnd) {
			this.stopPlayback();
			return;
		}
		this.rafId = requestAnimationFrame(this.tick);
	};

	private currentEventIndex(): number {
		const n = this.events.length;
		if (n === 0) return 0;
		if (this.currentTime < this.events[0].timestamp) return 0;
		let lo = 0,
			hi = n - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >>> 1;
			if (this.events[mid].timestamp <= this.currentTime) lo = mid;
			else hi = mid - 1;
		}
		return lo + 1;
	}

	private onRestart = (): void => {
		this.currentTime = this.firstEventTime() - 1;
		if (this.state.atEnd) this.setState({ atEnd: false });
		this.dispatchTimeSync();
	};

	private onSpeed = (e: Event): void => {
		this.setState({ speed: parseFloat((e.target as HTMLSelectElement).value) });
	};

	private onSliderInput = (e: Event): void => {
		const pos = parseInt((e.target as HTMLInputElement).value, 10);
		this.currentTime = pos === 0 ? this.firstEventTime() - 1 : displayToTime(this.piecewise, pos);
		const atEnd = this.currentTime >= this.lastEventTime();
		if (this.state.atEnd !== atEnd) this.setState({ atEnd });
		this.dispatchTimeSync();
	};

	render(): TemplateResult {
		const total = Math.max(1, Math.round(this.piecewise.totalDisplay));
		const display = Math.round(timeToDisplay(this.piecewise, this.currentTime));
		const count = this.events.length;
		const totalRecorded = this.sse ? this.sse.totalRecorded() : count;
		const wrapped = totalRecorded > count;
		const current = this.currentEventIndex();
		const knobLabel = wrapped ? `${current} / ${count} / ${totalRecorded}` : `${current} / ${count}`;
		const knobPct = total > 0 ? (display / total) * 100 : 0;
		return html`
			<button data-action="restart" data-testid="timeline-restart" title="Restart" @click=${this.onRestart}>⏮</button>
			<button data-action="play" data-testid="timeline-play" title=${this.state.playing ? "Pause" : "Play"} @click=${this.togglePlay}>${this.state.playing ? "⏸️" : "▶️"}</button>
			<select data-action="speed" data-testid="timeline-speed" title="Playback speed" @change=${this.onSpeed}>${SPEED_OPTIONS.map((s) => html`<option value=${s} ?selected=${s === this.state.speed}>${formatSpeed(s)}</option>`)}</select>
			<div class="slider-wrap">
				<div class="track-overlay">${this.piecewise.segments.map((seg) => {
					const width = seg.displayEnd - seg.displayStart;
					const pct = (width / total) * 100;
					return html`<div class=${`seg ${seg.kind}`} style=${`width:${pct.toFixed(2)}%`}></div>`;
				})}</div>
				<div class="markers">${this.events
					.filter((e) => e.icon)
					.map((e) => {
						const pos = timeToDisplay(this.piecewise, e.timestamp);
						const pct = (pos / total) * 100;
						const cls = e.color === "#ef4444" ? "marker error" : "marker";
						const label = `${e.label} @ ${formatRelative(e.timestamp - this.firstEventTime())}`;
						return html`<span class=${cls} style=${`left:${pct.toFixed(2)}%;color:${e.color}`} title=${label}>${e.icon}</span>`;
					})}</div>
				<input type="range" data-testid="timeline-slider" min="0" max=${total} .value=${String(display)} @input=${this.onSliderInput}>
				<span class="knob-label" data-testid="timeline-time" style=${`left:${knobPct.toFixed(2)}%`}>${knobLabel}</span>
			</div>
		`;
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
