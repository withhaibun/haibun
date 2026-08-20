/**
 * <shu-playback> — restart, play/pause and speed for the shared time cursor.
 *
 * Where the cursor IS is the log's own scroll rail: a reader drags the strip to a moment and every view follows. What a
 * rail cannot do is move on its own, so that is what this is — the part of the old timeline that was not a position.
 *
 * Playing advances the cursor from the first event to the last at `speed`, and stops on arrival. At the last event the
 * cursor is published as null rather than as that timestamp: null means "now, no upper bound", so a record written
 * after the newest event this page has seen is not filtered out as future before its own event arrives. Only a scrub
 * into the past publishes a concrete cutoff.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { SHU_TEST_IDS } from "../test-ids.js";

/** Playback rates. The two below 1 run slower than the run did, for a dense burst worth watching unfold. */
const SPEED_OPTIONS = [0.02, 0.05, 1, 2];
const formatSpeed = (s: number): string => (s === 0.02 ? "-50×" : s === 0.05 ? "-20×" : `${s}×`);

const StateSchema = z.object({
	playing: z.boolean().default(false),
	speed: z.number().default(1),
	atEnd: z.boolean().default(true),
});

export class ShuPlayback extends ShuElement<typeof StateSchema> {
	/** A control, not a view of data — contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static domainSelector = "shu-playback";

	static styles = [
		shuBaseStyles,
		css`
		:host { display: flex; align-items: center; gap: var(--shu-space-3); padding: var(--shu-space-1) var(--shu-space-3); font: var(--shu-font-sm) var(--shu-font-family); }
		button { background: none; border: none; cursor: pointer; font-size: var(--shu-font-lg); padding: 0 3px; color: var(--shu-fg-muted); }
		button:hover { color: var(--shu-fg); }
		select { font: inherit; padding: 0 var(--shu-space-1); border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); }
	`,
	];

	/** The run's bounds, taken from the events as they arrive: what playing runs between. */
	#firstTime = 0;
	#lastTime = 0;
	#currentTime = 0;
	#lastFrame = 0;
	#rafId = 0;

	constructor() {
		super(StateSchema, { playing: false, speed: 1, atEnd: true });
	}

	protected override onConnected(): void {
		this.autoTeardown(
			this.subscribeBatched({
				onBatch: (events) => {
					for (const e of events) {
						const ts = (e as { timestamp?: number }).timestamp;
						if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) continue;
						if (this.#firstTime === 0 || ts < this.#firstTime) this.#firstTime = ts;
						if (ts > this.#lastTime) this.#lastTime = ts;
					}
				},
			}),
		);
		this.autoTeardown(() => this.#stop());
	}

	/** The cursor moved somewhere else — a rail seek, a row click. Playing from here means playing from there. */
	protected override onTimeSync(cursor: number | null): void {
		this.#currentTime = cursor ?? this.#lastTime;
		const atEnd = cursor === null || this.#currentTime >= this.#lastTime;
		if (this.state.atEnd !== atEnd) this.setState({ atEnd });
	}

	/** Publish where playback has reached. At the end that is null — "now" — so live records are not read as future. */
	#publish(): void {
		this.timeCursor = this.state.atEnd ? null : this.#currentTime;
	}

	#stop(): void {
		if (this.#rafId) cancelAnimationFrame(this.#rafId);
		this.#rafId = 0;
		if (this.state.playing) this.setState({ playing: false });
	}

	#tick = (): void => {
		if (!this.state.playing) return;
		const now = performance.now();
		const elapsed = now - this.#lastFrame;
		this.#lastFrame = now;
		this.#currentTime = Math.min(this.#lastTime, this.#currentTime + elapsed * this.state.speed);
		const reachedEnd = this.#currentTime >= this.#lastTime;
		if (this.state.atEnd !== reachedEnd) this.setState({ atEnd: reachedEnd });
		this.#publish();
		if (reachedEnd) return this.#stop();
		this.#rafId = requestAnimationFrame(this.#tick);
	};

	private onPlay = (): void => {
		if (this.state.playing) return this.#stop();
		if (this.#lastTime === 0) return; // nothing has happened yet, so there is nothing to play through
		this.#lastFrame = performance.now();
		if (this.#currentTime >= this.#lastTime) this.#currentTime = this.#firstTime;
		this.setState({ playing: true, atEnd: false });
		this.#tick();
	};

	private onRestart = (): void => {
		this.#currentTime = this.#firstTime - 1;
		if (this.state.atEnd) this.setState({ atEnd: false });
		this.#publish();
	};

	private onSpeed = (e: Event): void => {
		this.setState({ speed: Number.parseFloat((e.target as HTMLSelectElement).value) });
	};

	render(): TemplateResult {
		const ids = SHU_TEST_IDS.PLAYBACK;
		return html`
			<button data-testid=${ids.RESTART} title="Back to the start" @click=${this.onRestart}>⏮</button>
			<button data-testid=${ids.PLAY} title=${this.state.playing ? "Pause" : "Play"} @click=${this.onPlay}>${this.state.playing ? "⏸️" : "▶️"}</button>
			<select data-testid=${ids.SPEED} title="Playback speed" @change=${this.onSpeed}>
				${SPEED_OPTIONS.map((s) => html`<option value=${s} ?selected=${s === this.state.speed}>${formatSpeed(s)}</option>`)}
			</select>
		`;
	}
}

customElements.define(ShuPlayback.domainSelector, ShuPlayback);
