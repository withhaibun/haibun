/**
 * The scene's own regulator for decorative motion, in the shape of a rolling-window health monitor: samples in,
 * thresholds, a pure evaluation that trips or clears a signal under a cooldown, and a description of what tripped.
 *
 * The active node's breath requests a drawn frame every `BREATH_MS`. A frame takes one or two milliseconds of the
 * renderer's time on a GPU and tens of milliseconds under a software rasterizer or on a slow device, and the page
 * cannot measure which from its main thread. The regulator reads what a drawn frame takes (see `FrameTime`), keeps
 * the median of the last few so one slow frame doesn't change the result, and compares the breath's share of wall time with
 * its limit. The breath rests over its limit: the glow is drawn once and held. It breathes again within its limit.
 * Decoration starts at rest and runs once a full window measures within the limit, so a slow renderer never pays for
 * decoration while it is being measured.
 *
 * The scene acts on the signal itself and records it as a blip, so a run can observe the regulation and the time
 * behind it.
 */
import { BREATH_MS } from "./polymorphic-highlight.js";

export const REGULATION_KINDS = ["decorativeOverLimit", "decorativeWithinLimit"] as const;

type TRegulationKind = (typeof REGULATION_KINDS)[number];

type TRegulationSignal = { kind: TRegulationKind; frameTimeMs: number; share: number };

export type TRegulationThresholds = {
	/** Frame times kept; the median of these is the time compared with the limit. The regulator doesn't compare with fewer than this. */
	windowSamples: number;
	/** The share of wall time the breath may take, as a fraction: at ten beats a second, a 5 ms frame is 5%. */
	decorativeShareLimit: number;
	/** How often the breath requests a frame. */
	beatsPerSecond: number;
	/** How long after a signal the next one may fire, so the breath cannot flap between resting and breathing. */
	cooldownMs: number;
};

export const DEFAULT_REGULATION_THRESHOLDS: TRegulationThresholds = {
	windowSamples: 5,
	decorativeShareLimit: 0.05,
	beatsPerSecond: 1000 / BREATH_MS,
	cooldownMs: 10_000,
};

type TRegulationState = { frameTimes: number[]; resting: boolean; lastFiredAt?: number };

/** A scene's regulation before it has measured a frame: decoration rests until a measurement shows it may run. */
export function newRegulationState(): TRegulationState {
	return { frameTimes: [], resting: true };
}

/** Keep one measured frame time, dropping the oldest past the window. */
export function recordFrameTime(state: TRegulationState, timeMs: number, windowSamples: number): void {
	state.frameTimes.push(timeMs);
	if (state.frameTimes.length > windowSamples) state.frameTimes.shift();
}

/** The median: one anomalous frame doesn't move it, whether slow or fast. */
export function medianOf(samples: readonly number[]): number {
	const sorted = [...samples].sort((a, b) => a - b);
	return sorted[sorted.length >> 1];
}

/** The breath's share of wall time at a frame time: time per beat times beats per second, over one second. */
function breathShare(frameTimeMs: number, thresholds: TRegulationThresholds): number {
	return (frameTimeMs * thresholds.beatsPerSecond) / 1000;
}

/**
 * Evaluate the window against the thresholds. Returns the signal that tripped or cleared now, respecting the
 * cooldown, and moves the state with it; undefined when the state didn't change.
 */
export function evaluateRegulation(state: TRegulationState, thresholds: TRegulationThresholds = DEFAULT_REGULATION_THRESHOLDS, now: number): TRegulationSignal | undefined {
	if (state.frameTimes.length < thresholds.windowSamples) return undefined;
	if (state.lastFiredAt !== undefined && now - state.lastFiredAt < thresholds.cooldownMs) return undefined;
	const frameTimeMs = medianOf(state.frameTimes);
	const share = breathShare(frameTimeMs, thresholds);
	const over = share > thresholds.decorativeShareLimit;
	if (over === state.resting) return undefined;
	state.resting = over;
	state.lastFiredAt = now;
	return { kind: over ? "decorativeOverLimit" : "decorativeWithinLimit", frameTimeMs, share };
}

export function describeRegulation(signal: TRegulationSignal): string {
	const share = `${(signal.share * 100).toFixed(0)}% of wall time at ${signal.frameTimeMs.toFixed(1)} ms a frame`;
	return signal.kind === "decorativeOverLimit" ? `the breath rests: it would take ${share}` : `the breath resumes: it takes ${share}`;
}
