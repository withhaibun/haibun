/**
 * shu-timeline — Playhead slider for time-syncing all shu views.
 * Click a time in the monitor to seek; press play to advance; drag to scrub.
 * Dispatches TIME_SYNC events consumed by monitor, sequence, and graph views.
 */
import { SHU_EVENT } from "../consts.js";

const SPEED_OPTIONS = [0.02, 0.05, 1, 2];

const formatSpeed = (s: number): string => {
	if (s === 0.02) return "-50\u00d7";
	if (s === 0.05) return "-20\u00d7";
	return `${s}\u00d7`;
};

const formatTime = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

const STYLES = `
:host { display: flex; align-items: center; gap: 6px; padding: 2px 6px; font: 11px ui-monospace, monospace; border-top: 1px solid #ddd; background: #fafafa; }
button { background: none; border: none; cursor: pointer; font-size: 14px; padding: 0 3px; color: #666; }
button:hover { color: #333; }
select { font: inherit; padding: 0 2px; border: 1px solid #ddd; border-radius: 2px; }
.slider-wrap { flex: 1; position: relative; height: 18px; display: flex; align-items: center; }
input[type="range"] { width: 100%; cursor: pointer; margin: 0; }
.time-display { color: #666; min-width: 90px; text-align: right; font-variant-numeric: tabular-nums; }
`;

export class ShuTimeline extends HTMLElement {
	private startTime = 0;
	private duration = 0;
	private currentTime = 0;
	private playing = false;
	private speed = 1;
	private lastFrame = 0;
	private rafId = 0;

	connectedCallback(): void {
		if (!this.shadowRoot) this.attachShadow({ mode: "open" });
		this.render();
	}

	disconnectedCallback(): void {
		this.stopPlayback();
	}

	/** Set the timeline bounds from event data. */
	setBounds(startTime: number, endTime: number): void {
		this.startTime = startTime;
		this.duration = Math.max(0, endTime - startTime);
		if (this.currentTime > this.duration) this.currentTime = this.duration;
		this.render();
	}

	/** Set the current time (relative ms from startTime). */
	seek(relativeMs: number): void {
		this.currentTime = Math.max(0, Math.min(this.duration, relativeMs));
		this.render();
	}

	/** Get absolute epoch timestamp for the current playhead position. */
	get absoluteTime(): number {
		return this.startTime + this.currentTime;
	}

	private dispatchTimeSync(): void {
		this.dispatchEvent(
			new CustomEvent(SHU_EVENT.TIME_SYNC, {
				bubbles: true,
				composed: true,
				detail: { currentTime: this.startTime + this.currentTime, startTime: this.startTime },
			}),
		);
	}

	private togglePlay(): void {
		if (this.playing) {
			this.stopPlayback();
		} else {
			this.playing = true;
			this.lastFrame = performance.now();
			if (this.currentTime >= this.duration) this.currentTime = 0;
			this.tick();
		}
		this.render();
	}

	private stopPlayback(): void {
		this.playing = false;
		if (this.rafId) cancelAnimationFrame(this.rafId);
		this.rafId = 0;
	}

	private tick = (): void => {
		if (!this.playing) return;
		const now = performance.now();
		const elapsed = now - this.lastFrame;
		this.lastFrame = now;
		this.currentTime = Math.min(this.duration, this.currentTime + elapsed * this.speed);
		this.dispatchTimeSync();
		this.updateDisplay();
		if (this.currentTime >= this.duration) {
			this.stopPlayback();
			this.render();
			return;
		}
		this.rafId = requestAnimationFrame(this.tick);
	};

	private updateDisplay(): void {
		const slider = this.shadowRoot?.querySelector("input[type=range]") as HTMLInputElement | null;
		const display = this.shadowRoot?.querySelector(".time-display") as HTMLElement | null;
		if (slider) slider.value = String(Math.round(this.currentTime));
		if (display) display.textContent = `${formatTime(this.currentTime)} / ${formatTime(this.duration)}`;
	}

	private render(): void {
		if (!this.shadowRoot) return;
		const speedOptions = SPEED_OPTIONS.map(
			(s) => `<option value="${s}"${s === this.speed ? " selected" : ""}>${formatSpeed(s)}</option>`,
		).join("");
		this.shadowRoot.innerHTML = `<style>${STYLES}</style>
			<button data-action="restart" data-testid="timeline-restart" title="Restart">\u23ee</button>
			<button data-action="play" data-testid="timeline-play" title="${this.playing ? "Pause" : "Play"}">${this.playing ? "\u23f8\ufe0f" : "\u25b6\ufe0f"}</button>
			<select data-action="speed" data-testid="timeline-speed" title="Playback speed">${speedOptions}</select>
			<div class="slider-wrap"><input type="range" data-testid="timeline-slider" min="0" max="${Math.round(this.duration) || 1}" value="${Math.round(this.currentTime)}"></div>
			<span class="time-display" data-testid="timeline-time">${formatTime(this.currentTime)} / ${formatTime(this.duration)}</span>`;
		this.shadowRoot.querySelector("[data-action=restart]")?.addEventListener("click", () => {
			this.currentTime = 0;
			this.dispatchTimeSync();
			this.render();
		});
		this.shadowRoot.querySelector("[data-action=play]")?.addEventListener("click", () => this.togglePlay());
		this.shadowRoot.querySelector("[data-action=speed]")?.addEventListener("change", (e) => {
			this.speed = parseFloat((e.target as HTMLSelectElement).value);
		});
		this.shadowRoot.querySelector("input[type=range]")?.addEventListener("input", (e) => {
			this.currentTime = parseInt((e.target as HTMLInputElement).value, 10);
			this.dispatchTimeSync();
		});
	}
}
