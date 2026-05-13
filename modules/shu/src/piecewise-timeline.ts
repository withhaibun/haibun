/**
 * Piecewise-linear timeline mapping.
 *
 * Wall-clock event timestamps over a long run can include very long idle
 * intervals (the test ran in 10s then the user idled 10 minutes before
 * running a step). A slider scaled linearly to wall time hides the short
 * burst entirely. The piecewise mapping collapses any gap longer than
 * `idleThresholdMs` to a fixed visual width, so every burst stays visible.
 *
 * The module is pure: it takes a sorted array of event timestamps and
 * returns segments + bidirectional mappings between an absolute wall-clock
 * time and a display position in `[0, totalDisplay]`. shu-timeline uses
 * this to lay out a discontinuous slider track.
 */

export type TSegmentKind = "active" | "idle";

export type TPiecewiseSegment = {
	kind: TSegmentKind;
	startTime: number; // absolute epoch ms at segment start (matches end for an idle segment when no events fall inside)
	endTime: number; // absolute epoch ms at segment end
	displayStart: number; // accumulated display units from origin
	displayEnd: number; // displayStart + width
};

export type TPiecewiseTimeline = {
	segments: TPiecewiseSegment[];
	totalDisplay: number;
};

export const DEFAULT_IDLE_THRESHOLD_MS = 5_000;
export const DEFAULT_IDLE_SEGMENT_WIDTH = 12; // display units allocated to one idle gap regardless of duration

/**
 * Build segments from a sorted list of event timestamps. Empty input returns
 * an empty timeline. A single-event input collapses to a zero-width segment
 * (slider has no range to scrub).
 */
export function buildPiecewiseTimeline(eventTimes: number[], idleThresholdMs: number = DEFAULT_IDLE_THRESHOLD_MS, idleSegmentWidth: number = DEFAULT_IDLE_SEGMENT_WIDTH): TPiecewiseTimeline {
	if (eventTimes.length === 0) return { segments: [], totalDisplay: 0 };
	const sorted = [...eventTimes].sort((a, b) => a - b);
	const segments: TPiecewiseSegment[] = [];
	let display = 0;
	let activeStart = sorted[0];
	let prev = sorted[0];
	for (let i = 1; i < sorted.length; i++) {
		const t = sorted[i];
		const gap = t - prev;
		if (gap > idleThresholdMs) {
			// Close the active run we were accumulating.
			const activeWidth = prev - activeStart;
			segments.push({ kind: "active", startTime: activeStart, endTime: prev, displayStart: display, displayEnd: display + activeWidth });
			display += activeWidth;
			segments.push({ kind: "idle", startTime: prev, endTime: t, displayStart: display, displayEnd: display + idleSegmentWidth });
			display += idleSegmentWidth;
			activeStart = t;
		}
		prev = t;
	}
	const finalWidth = prev - activeStart;
	segments.push({ kind: "active", startTime: activeStart, endTime: prev, displayStart: display, displayEnd: display + finalWidth });
	display += finalWidth;
	return { segments, totalDisplay: display };
}

/**
 * Map a display position back to absolute wall-clock time. Positions inside
 * an idle segment snap to the segment's `endTime` (the boundary the user is
 * typically navigating toward), so dragging through a gap parks the cursor
 * at the next event rather than at an in-between value that doesn't exist.
 */
export function displayToTime(tl: TPiecewiseTimeline, displayPos: number): number {
	if (tl.segments.length === 0) return 0;
	if (displayPos <= tl.segments[0].displayStart) return tl.segments[0].startTime;
	if (displayPos >= tl.totalDisplay) return tl.segments[tl.segments.length - 1].endTime;
	for (const seg of tl.segments) {
		if (displayPos < seg.displayStart || displayPos > seg.displayEnd) continue;
		if (seg.kind === "active") {
			const segWidth = seg.displayEnd - seg.displayStart;
			if (segWidth === 0) return seg.startTime;
			const ratio = (displayPos - seg.displayStart) / segWidth;
			return seg.startTime + ratio * (seg.endTime - seg.startTime);
		}
		// idle — snap forward to the segment's endTime
		return seg.endTime;
	}
	return tl.segments[tl.segments.length - 1].endTime;
}

/**
 * Map an absolute wall-clock time to a display position. Times before the
 * first event clamp to 0; times after the last clamp to `totalDisplay`.
 * Times that fall inside an idle gap are placed at the start of the gap
 * (the wall-clock instant immediately after the prior event).
 */
export function timeToDisplay(tl: TPiecewiseTimeline, absoluteTime: number): number {
	if (tl.segments.length === 0) return 0;
	if (absoluteTime <= tl.segments[0].startTime) return tl.segments[0].displayStart;
	if (absoluteTime >= tl.segments[tl.segments.length - 1].endTime) return tl.totalDisplay;
	for (const seg of tl.segments) {
		if (absoluteTime < seg.startTime || absoluteTime > seg.endTime) continue;
		if (seg.kind === "active") {
			const span = seg.endTime - seg.startTime;
			if (span === 0) return seg.displayStart;
			const ratio = (absoluteTime - seg.startTime) / span;
			return seg.displayStart + ratio * (seg.displayEnd - seg.displayStart);
		}
		return seg.displayStart;
	}
	return tl.totalDisplay;
}
