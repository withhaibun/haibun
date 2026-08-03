/**
 * Map a haibun event to a slider marker style: an emoji icon plus a colour.
 * The shared vocabulary for marking events on a timeline slider.
 *
 * The event shape is the SSE wire form; this helper only reads fields it
 * understands and returns a safe default for anything else.
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
			if (e.status === "running") return { color: MARK_COLOUR.pending, icon: ICON_STEP_RUNNING };
			if (isSpeculativeEvent(e)) return { color: MARK_COLOUR.undecided, icon: e.status === "failed" ? MAYBE_CHECK_NO : MAYBE_CHECK_YES };
			if (e.status === "failed") return isHandedOutEvent(e) ? { color: MARK_COLOUR.undecided, icon: RETURNED_TO_CALLER } : { color: MARK_COLOUR.fault, icon: ICON_STEP_FAILED };
			if (e.status === "completed") return { color: MARK_COLOUR.ok, icon: ICON_STEP_COMPLETED };
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
	if (e.kind === "lifecycle" && e.status === "failed") return true;
	if (e.kind === "lifecycle" && e.type === "step" && e.stage === "end") {
		const isTechnical = /^[a-z]/.test(e.in ?? "");
		return !isTechnical;
	}
	return false;
}
