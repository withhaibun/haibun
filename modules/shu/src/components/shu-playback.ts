/**
 * <shu-playback>: restart, play/pause and speed for the shared time cursor.
 *
 * Where the cursor IS is the log's own scroll rail: a reader drags the strip to a moment and every view follows. What a
 * rail cannot do is move on its own, so that is what this is: the part of the old timeline that was not a position.
 *
 * Playing advances the cursor from the first event to the last at `speed`, and stops on arrival. At the last event the
 * cursor is published as null rather than as that timestamp: null means "now, no upper bound", so a record written
 * after the newest event this page has seen is not filtered out as future before its own event arrives. Only a scrub
 * into the past publishes a concrete cutoff.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles, shuIconButtonStyles } from "./styles.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { SHU_EVENT, SHU_TAG } from "../consts.js";
import { runSpan } from "../client-cache/index.js";

/** Playback rates. The two below 1 run slower than the run did, for a dense burst worth watching as it plays. */
const SPEED_OPTIONS = [0.02, 0.05, 1, 2];
const formatSpeed = (s: number): string => (s < 1 ? `-${Math.round(1 / s)}×` : `${s}×`);

const StateSchema = z.object({
	playing: z.boolean().default(false),
	speed: z.number().default(1),
});

export class ShuPlayback extends ShuElement<typeof StateSchema> {
	/** A control, not a view of data, contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static domainSelector = SHU_TAG.PLAYBACK;

	static styles = [
		shuBaseStyles,
		shuIconButtonStyles,
		css`
		:host { display: flex; align-items: center; gap: var(--shu-space-3); padding: var(--shu-space-1) var(--shu-space-3); font: var(--shu-font-sm) var(--shu-font-family); }
		/* The look of an icon button and of a select are the base's (shuIconButtonStyles, shuBaseStyles); only the glyph
		   size and the tighter select padding are this control's own. */
		button.icon { font-size: var(--shu-font-lg); }
		select { padding: 0 var(--shu-space-1); }
	`,
	];

	#currentTime = 0;
	#lastFrame = 0;
	#rafId = 0;

	constructor() {
		super(StateSchema, {});
	}

	protected override onConnected(): void {
		this.autoTeardown(() => this.#stop());
	}

	/** What playing runs between: the shared log's span, read without asking for a window of it. This control keeps no
	 *  running bounds of its own, and registers nothing that would hold the run in memory after it is put away. */
	get #span(): { first: number; last: number } {
		return runSpan();
	}

	/** Whether the cursor has reached the end of the run. Derived rather than kept: every place that would have written
	 *  it is this same comparison, and nothing renders from it. */
	get #atEnd(): boolean {
		return this.#currentTime >= this.#span.last;
	}

	/** The cursor moved somewhere else: a rail seek, a row click. Playing from here means playing from there. Its own
	 *  publishes come back through here, and re-reading them would conflict with the frame that is mid-flight. */
	protected override onTimeSync(cursor: number | null): void {
		const at = cursor ?? this.#span.last;
		if (at === this.#currentTime) return;
		this.#currentTime = at;
	}

	/** Publish where playback has reached. At the end that is null, "now", so live records are not read as future. */
	#publish(): void {
		this.timeCursor = this.#atEnd ? null : this.#currentTime;
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
		const last = this.#span.last; // read once: this runs every frame
		this.#currentTime = Math.min(last, this.#currentTime + elapsed * this.state.speed);
		this.#publish();
		if (this.#currentTime >= last) return this.#stop();
		this.#rafId = requestAnimationFrame(this.#tick);
	};

	private onPlay = (): void => {
		if (this.state.playing) return this.#stop();
		const { first, last } = this.#span;
		if (last === 0) return; // nothing has happened yet, so there is nothing to play through
		this.#lastFrame = performance.now();
		if (this.#currentTime >= last) this.#currentTime = first;
		this.setState({ playing: true });
		this.#tick();
	};

	private onRestart = (): void => {
		this.#currentTime = this.#span.first - 1;
		this.#publish();
	};

	/** Back to the live edge, and tailing again. A press on a rail is meant to stay put, so this is what takes a reader
	 *  off a moment they picked and back to whatever is happening now. */
	private onLive = (): void => {
		this.timeCursor = null;
		this.dispatchEvent(new CustomEvent(SHU_EVENT.GO_LIVE, { bubbles: true, composed: true }));
	};

	private onSpeed = (e: Event): void => {
		this.setState({ speed: Number.parseFloat((e.target as HTMLSelectElement).value) });
	};

	render(): TemplateResult {
		const ids = SHU_TEST_IDS.PLAYBACK;
		return html`
			<button class="icon" data-testid=${ids.RESTART} title="Back to the start" @click=${this.onRestart}>⏮</button>
			<button class="icon" data-testid=${ids.PLAY} title=${this.state.playing ? "Pause" : "Play"} @click=${this.onPlay}>${this.state.playing ? "⏸️" : "▶️"}</button>
			<button class="icon" data-testid=${ids.LIVE} title="Back to now, and follow" @click=${this.onLive}>⏭</button>
			<select data-testid=${ids.SPEED} title="Playback speed" @change=${this.onSpeed}>
				${SPEED_OPTIONS.map((s) => html`<option value=${s} ?selected=${s === this.state.speed}>${formatSpeed(s)}</option>`)}
			</select>
		`;
	}
}

customElements.define(ShuPlayback.domainSelector, ShuPlayback);
