/**
 * Where a moment of a run sits on a rail that carries the whole run.
 *
 * A rail is a few hundred pixels and a run is however long it ran, so one scale cannot serve both: a year spread evenly
 * over a rail gives a reader a day per pixel, and nothing they are reading can be picked out of it. The scale is
 * focused instead. The window a page holds around where a reader is takes the middle share of the rail and maps
 * linearly, so a press near the focus picks the moment it points at. What the run did before that window and after it
 * compresses into the ends, by the logarithm of how far away it is, so a failure a year back still has a place on the
 * rail and sits further out than one from an hour back.
 *
 * A run whose whole reach the window covers maps linearly end to end: a short run is not distorted to look long.
 *
 * Pure: the reading that counts a run and the element that draws a rail both read these, and neither states a scale of
 * its own.
 */

/** What the run spans: the instants of its first and last records. */
export type TRunSpan = { first: number; last: number };

/** Where the rail is focused: the moment a reader is reading around, and the window the page holds around it. */
export type TRunFocus = { at: number; from: number; to: number };

/** The share of the rail the held window takes. The rest carries what the run did outside it, at both ends. */
export const FOCUS_SHARE = 0.6;

const clamp = (n: number): number => Math.min(1, Math.max(0, n));

/** How the shares outside the window divide between the two ends: by the logarithm of what each holds, so an end with
 *  nothing beyond it takes nothing and the other takes it all. */
function ends(span: TRunSpan, focus: TRunFocus): { before: number; after: number; beforeLen: number; afterLen: number } {
	const beforeLen = Math.max(0, focus.from - span.first);
	const afterLen = Math.max(0, span.last - focus.to);
	const weight = Math.log1p(beforeLen) + Math.log1p(afterLen);
	const outside = 1 - FOCUS_SHARE;
	if (weight === 0) return { before: 0, after: 0, beforeLen, afterLen };
	return { before: (outside * Math.log1p(beforeLen)) / weight, after: (outside * Math.log1p(afterLen)) / weight, beforeLen, afterLen };
}

/** Whether the window the page holds covers the whole run, which is every short run. */
const holdsItAll = (span: TRunSpan, focus: TRunFocus): boolean => focus.from <= span.first && focus.to >= span.last;

/** Where a moment sits on the rail, as a fraction of it from the run's first record to its last. */
export function railAt(moment: number, span: TRunSpan, focus: TRunFocus): number {
	const reach = span.last - span.first;
	if (reach <= 0) return 0;
	if (holdsItAll(span, focus)) return clamp((moment - span.first) / reach);
	const { before, after, beforeLen, afterLen } = ends(span, focus);
	if (moment <= focus.from) return beforeLen === 0 ? 0 : clamp(before * (1 - Math.log1p(focus.from - moment) / Math.log1p(beforeLen)));
	if (moment >= focus.to) return afterLen === 0 ? 1 : clamp(before + FOCUS_SHARE + after * (Math.log1p(moment - focus.to) / Math.log1p(afterLen)));
	const held = focus.to - focus.from;
	return clamp(before + (held <= 0 ? 0 : (FOCUS_SHARE * (moment - focus.from)) / held));
}

/** The moment a fraction of the rail names, which is what a press on the rail asks the run for. */
export function momentAt(fraction: number, span: TRunSpan, focus: TRunFocus): number {
	const reach = span.last - span.first;
	if (reach <= 0) return span.first;
	const f = clamp(fraction);
	if (holdsItAll(span, focus)) return span.first + f * reach;
	const { before, after, beforeLen, afterLen } = ends(span, focus);
	if (f <= before) return beforeLen === 0 ? span.first : focus.from - (Math.expm1(((before - f) / before) * Math.log1p(beforeLen)) || 0);
	if (f >= before + FOCUS_SHARE) return afterLen === 0 ? span.last : focus.to + (Math.expm1(((f - before - FOCUS_SHARE) / after) * Math.log1p(afterLen)) || 0);
	return focus.from + ((f - before) / FOCUS_SHARE) * (focus.to - focus.from);
}
