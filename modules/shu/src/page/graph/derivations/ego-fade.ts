/**
 * The fade of the ego overlay: an opacity that moves from where it is toward 0 or 1, eased over the duration of its direction.
 * A fade toward the other end starts from the opacity at that instant, so a hover during a fade-out reverses the fade in place.
 * The overlay draws while a fade runs, and the scene rests once it ends.
 */
import { easeInOutCubic } from "./grouping.js";

/** How long the overlay takes to fade in, and to fade out. */
export const EGO_FADE_MS = { in: 360, out: 220 } as const;

/** A fade: the opacity it starts from, the end it moves toward, and when it started. */
export type TEgoFade = { from: number; to: 0 | 1; at: number };

/** The fade of an overlay that isn't shown. */
export const EGO_HIDDEN: TEgoFade = { from: 0, to: 0, at: 0 };

/** Returns the opacity of `fade` at `now`. */
export function fadeOpacity({ from, to, at }: TEgoFade, now: number): number {
	const share = Math.min(1, Math.max(0, (now - at) / (to === 1 ? EGO_FADE_MS.in : EGO_FADE_MS.out)));
	return from + (to - from) * easeInOutCubic(share);
}

/** Returns the fade toward `to` from the opacity `fade` holds at `now`; a fade that already moves toward `to` stays as it is. */
export const fadeToward = (fade: TEgoFade, to: 0 | 1, now: number): TEgoFade => (fade.to === to ? fade : { from: fadeOpacity(fade, now), to, at: now });

/** Whether `fade` has reached its end at `now`. */
export const fadeEnded = (fade: TEgoFade, now: number): boolean => fadeOpacity(fade, now) === fade.to;
