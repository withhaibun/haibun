/**
 * How a row of a run marks a timeline: an emoji icon and a colour. The shared vocabulary every view marks by, so a rail
 * and a timeline never disagree about which rows matter or what they look like.
 *
 * A row states what the run recorded, so an outcome here is the outcome a step's record states. Only the fields this
 * understands are read; anything else takes the default.
 */
import {
	ICON_FEATURE,
	ICON_SCENARIO,
	ICON_STEP_RUNNING,
	ICON_STEP_FAILED,
	ICON_STEP_COMPLETED,
	ICON_LOG_INFO,
	ICON_LOG_WARN,
	ICON_LOG_ERROR,
	ICON_DEFAULT,
	ICON_ARTIFACT,
	MAYBE_CHECK_NO,
	MAYBE_CHECK_YES,
	RETURNED_TO_CALLER,
	isHandedOutEvent,
	isSpeculativeEvent,
} from "@haibun/core/schema/protocol.js";
import { SEQ_PATH_STATUS } from "@haibun/core/lib/resources.js";

export type TEventMarkerStyle = { color: string; icon: string };

type TPartialEvent = {
	kind?: string;
	type?: string;
	status?: string;
	level?: string;
	stage?: string;
	id?: string;
	intent?: { mode?: string };
};

/** The mark palette, named by what a mark says rather than by its hue, so every surface that marks an event reads from
 *  one place. UNDECIDED is neither fault nor success — a speculative try, or a call the run handed out. */
export const MARK_COLOUR = {
	feature: "#c084fc",
	scenario: "#60a5fa",
	pending: "#eab308",
	fault: "#ef4444",
	ok: "#22c55e",
	artifact: "#10b981",
	info: "#3b82f6",
	undecided: "#94a3b8",
} as const;

export function eventMarkerStyle(event: unknown): TEventMarkerStyle {
	const e = event as TPartialEvent;
	if (e.kind === "lifecycle") {
		if (e.type === "feature") return { color: MARK_COLOUR.feature, icon: ICON_FEATURE };
		if (e.type === "scenario") return { color: MARK_COLOUR.scenario, icon: ICON_SCENARIO };
		if (e.type === "step") {
			// A speculative statement's failure is expected and a handed-out call's failure belongs to its caller: the
			// same rule the log renders by (EventFormatter.getStatusIcon), so a mark never reports the run as failing
			// where the log does not.
			if (e.status === SEQ_PATH_STATUS.running) return { color: MARK_COLOUR.pending, icon: ICON_STEP_RUNNING };
			if (isSpeculativeEvent(e)) return { color: MARK_COLOUR.undecided, icon: e.status === SEQ_PATH_STATUS.failed ? MAYBE_CHECK_NO : MAYBE_CHECK_YES };
			if (e.status === SEQ_PATH_STATUS.failed)
				return isHandedOutEvent(e) ? { color: MARK_COLOUR.undecided, icon: RETURNED_TO_CALLER } : { color: MARK_COLOUR.fault, icon: ICON_STEP_FAILED };
			if (e.status === SEQ_PATH_STATUS.passed) return { color: MARK_COLOUR.ok, icon: ICON_STEP_COMPLETED };
			return { color: MARK_COLOUR.undecided, icon: ICON_DEFAULT };
		}
	}
	if (e.kind === "log") {
		if (e.level === "error") return { color: MARK_COLOUR.fault, icon: ICON_LOG_ERROR };
		if (e.level === "warn") return { color: MARK_COLOUR.pending, icon: ICON_LOG_WARN };
		if (e.level === "info") return { color: MARK_COLOUR.info, icon: ICON_LOG_INFO };
		return { color: MARK_COLOUR.undecided, icon: ICON_DEFAULT };
	}
	if (e.kind === "artifact") return { color: MARK_COLOUR.artifact, icon: ICON_ARTIFACT };
	return { color: MARK_COLOUR.undecided, icon: ICON_DEFAULT };
}

/**
 * The mark an event earns, or nothing where it earns none.
 *
 * This is the one call a surface makes to mark an event: whether it is worth marking and what it looks like are
 * decided together, in one place, so a rail, a track and anything else that marks events cannot disagree about which
 * events matter or how they are drawn. What a surface decides for itself is only WHERE the mark goes — a moment along
 * a time axis, a row's place in a log.
 */
export function markFor(event: unknown): TEventMarkerStyle | undefined {
	return shouldMarkEvent(event) ? eventMarkerStyle(event) : undefined;
}

/**
 * Decide whether an event deserves a slider marker. High-signal events
 * (failures, warnings, artifacts, feature/scenario structure, completed
 * step ends) get markers; low-level start events and internal log noise
 * are dropped so the slider doesn't blur into a wall of dots.
 */
export function shouldMarkEvent(event: unknown): boolean {
	const e = event as TPartialEvent & { in?: string };
	if (e.kind === "log" && (e.level === "error" || e.level === "warn")) return true;
	if (e.kind === "artifact") return true;
	if (e.kind === "lifecycle" && (e.type === "feature" || e.type === "scenario")) return true;
	if (e.kind === "lifecycle" && e.status === SEQ_PATH_STATUS.failed) return true;
	if (e.kind === "lifecycle" && e.type === "step") {
		// A step is one row, and a step whose text reads as prose is what a reader is looking for on a rail.
		const isTechnical = /^[a-z]/.test(e.in ?? "");
		return !isTechnical;
	}
	return false;
}

/**
 * The mark a division of the run earns, given what it holds and how much of each.
 *
 * A reader looking at a run of any length is shown its divisions rather than its records, so each division marks as
 * one thing. It marks as a failure where it holds one, which is what keeps a single failure from being averaged away
 * by the successes around it; otherwise it marks as whatever it holds most of. What a failure looks like, and which
 * failures count as one, are `eventMarkerStyle`'s to say, so a division and a row can never disagree.
 *
 * Nothing for a division holding nothing, so an empty stretch of the run draws as empty.
 */
export function bucketMarkerStyle(held: ReadonlyArray<{ event: unknown; count: number }>): TEventMarkerStyle | undefined {
	const styled = held.filter(({ count }) => count > 0).map(({ event, count }) => ({ style: eventMarkerStyle(event), count }));
	if (styled.length === 0) return undefined;
	const failing = styled.filter(({ style }) => style.color === MARK_COLOUR.fault);
	const among = failing.length > 0 ? failing : styled;
	// Most of what it holds, and where two hold as much, the one the run's own rule draws first: the same counts mark
	// the same way whatever order they were read in.
	return among.reduce((most, one) => (one.count > most.count || (one.count === most.count && one.style.icon < most.style.icon) ? one : most)).style;
}
