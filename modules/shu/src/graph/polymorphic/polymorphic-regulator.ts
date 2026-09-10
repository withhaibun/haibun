/**
 * The scene's own regulator for decorative motion, in the shape of a rolling-window health monitor: samples in,
 * thresholds, a pure evaluation that trips or clears a signal under a cooldown, and a description of what tripped.
 *
 * The active node's breath requests a drawn frame every `BREATH_MS`. A frame costs one or two milliseconds of the
 * renderer's time on a GPU and tens of milliseconds under a software rasterizer or on a slow device, and the page
 * cannot measure which from its main thread. The regulator takes what a drawn frame costs (see `FrameCost`), keeps the
 * median of the last few so one slow frame changes nothing, and compares the breath's share of wall time with its
 * budget. The breath rests over budget: the glow is drawn once and held. It breathes again within budget.
 *
 * The scene acts on the signal itself and records it as a blip, so a run can observe the regulation and the cost
 * behind it.
 */
import { BREATH_MS } from "./polymorphic-highlight.js";

export const REGULATION_KINDS = ["decorativeOverBudget", "decorativeWithinBudget"] as const;

export type TRegulationKind = (typeof REGULATION_KINDS)[number];

export type TRegulationSignal = { kind: TRegulationKind; frameCostMs: number; share: number };

export type TRegulationThresholds = {
	/** Frame costs kept; the median of these is the cost compared with the budget. Fewer than this compares nothing. */
	windowSamples: number;
	/** The share of wall time the breath may take, as a fraction: at ten beats a second, a 5 ms frame is 5%. */
	decorativeBudgetShare: number;
	/** How often the breath requests a frame. */
	beatsPerSecond: number;
	/** How long after a signal the next one may fire, so the breath cannot flap between resting and breathing. */
	cooldownMs: number;
};

export const DEFAULT_REGULATION_THRESHOLDS: TRegulationThresholds = {
	windowSamples: 5,
	decorativeBudgetShare: 0.05,
	beatsPerSecond: 1000 / BREATH_MS,
	cooldownMs: 10_000,
};

export type TRegulationState = { frameCosts: number[]; resting: boolean; lastFiredAt?: number };

export function newRegulationState(): TRegulationState {
	return { frameCosts: [], resting: false };
}

/** Keep one measured frame cost, dropping the oldest past the window. */
export function recordFrameCost(state: TRegulationState, costMs: number, windowSamples: number): void {
	state.frameCosts.push(costMs);
	if (state.frameCosts.length > windowSamples) state.frameCosts.shift();
}

/** The median: one anomalous frame, slow or fast, moves it by nothing. */
export function medianOf(samples: readonly number[]): number {
	const sorted = [...samples].sort((a, b) => a - b);
	return sorted[sorted.length >> 1];
}

/** The breath's share of wall time at a frame cost: cost per beat times beats per second, over one second. */
export function breathShare(frameCostMs: number, thresholds: TRegulationThresholds): number {
	return (frameCostMs * thresholds.beatsPerSecond) / 1000;
}

/**
 * Evaluate the window against the thresholds. Returns the signal that tripped or cleared now, respecting the
 * cooldown, and moves the state with it; undefined when nothing changed.
 */
export function evaluateRegulation(state: TRegulationState, thresholds: TRegulationThresholds = DEFAULT_REGULATION_THRESHOLDS, now: number): TRegulationSignal | undefined {
	if (state.frameCosts.length < thresholds.windowSamples) return undefined;
	if (state.lastFiredAt !== undefined && now - state.lastFiredAt < thresholds.cooldownMs) return undefined;
	const frameCostMs = medianOf(state.frameCosts);
	const share = breathShare(frameCostMs, thresholds);
	const over = share > thresholds.decorativeBudgetShare;
	if (over === state.resting) return undefined;
	state.resting = over;
	state.lastFiredAt = now;
	return { kind: over ? "decorativeOverBudget" : "decorativeWithinBudget", frameCostMs, share };
}

export function describeRegulation(signal: TRegulationSignal): string {
	const share = `${(signal.share * 100).toFixed(0)}% of wall time at ${signal.frameCostMs.toFixed(1)} ms a frame`;
	return signal.kind === "decorativeOverBudget" ? `the breath rests: it would take ${share}` : `the breath resumes: it takes ${share}`;
}
