/**
 * Computes the mark for an event row on a timeline: an emoji icon and a colour. Every view marks rows through this module,
 * so a rail and a timeline mark the same rows the same way.
 *
 * A row holds what actuality recorded, so an outcome here is the outcome a step's record states. These functions read only
 * the fields `TPartialEvent` declares and a step's `in`. An event that doesn't match a case gets the default mark.
 */
import {
	ICON_FEATURE,
	ICON_SCENARIO,
	ICON_STEP_RUNNING,
	ICON_STEP_FAILED,
	ICON_STEP_COMPLETED,
	ICON_STEP_STOPPED,
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
	RECORDED_STATUS,
} from "@haibun/core/schema/protocol.js";

export type TEventMarkerStyle = { color: string; icon: string };

type TPartialEvent = { kind?: string; type?: string; status?: string; level?: string; stage?: string; id?: string; intent?: { mode?: string } };

/** The mark palette. Each colour is named by what a mark shows rather than by its hue. Every surface that marks an event
 *  reads its colours here. `undecided` marks an outcome that isn't a fault or a success: a speculative try, a failed call
 *  actuality handed out, a stopped step or an event that doesn't match a case. */
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
			// A speculative statement's failure is expected. A handed-out call returns its failure to its caller.
			// EventFormatter.getStatusIcon applies the same rule, so a mark doesn't show a failure where the log doesn't.
			if (e.status === RECORDED_STATUS.running) return { color: MARK_COLOUR.pending, icon: ICON_STEP_RUNNING };
			if (isSpeculativeEvent(e)) return { color: MARK_COLOUR.undecided, icon: e.status === RECORDED_STATUS.failed ? MAYBE_CHECK_NO : MAYBE_CHECK_YES };
			if (e.status === RECORDED_STATUS.failed)
				return isHandedOutEvent(e) ? { color: MARK_COLOUR.undecided, icon: RETURNED_TO_CALLER } : { color: MARK_COLOUR.fault, icon: ICON_STEP_FAILED };
			if (e.status === RECORDED_STATUS.completed) return { color: MARK_COLOUR.ok, icon: ICON_STEP_COMPLETED };
			// A step its caller stopped isn't a fault or a pass.
			if (e.status === RECORDED_STATUS.stopped) return { color: MARK_COLOUR.undecided, icon: ICON_STEP_STOPPED };
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
 * Returns the mark for an event, or undefined where the event doesn't get one.
 *
 * A surface calls this to mark an event. This one call determines whether an event gets a mark and what the mark looks
 * like, so a rail, a track and every other surface mark the same events the same way. A surface determines only the
 * mark's position: a moment along a time axis or a row's place in a log.
 */
export function markFor(event: unknown): TEventMarkerStyle | undefined {
	return shouldMarkEvent(event) ? eventMarkerStyle(event) : undefined;
}

/**
 * Determines whether an event gets a slider mark. Error and warning logs, artifacts, feature and scenario starts, failed
 * lifecycle events and steps whose text doesn't start with a lowercase letter get a mark. Technical steps, other logs and
 * other events don't get a mark, so the slider's marks stay distinct.
 */
function shouldMarkEvent(event: unknown): boolean {
	const e = event as TPartialEvent & { in?: string };
	if (e.kind === "log" && (e.level === "error" || e.level === "warn")) return true;
	if (e.kind === "artifact") return true;
	// A feature's or a scenario's start marks it once; its end carries its id again, so it doesn't mark it a second time.
	if (e.kind === "lifecycle" && (e.type === "feature" || e.type === "scenario") && e.stage !== "end") return true;
	if (e.kind === "lifecycle" && e.status === RECORDED_STATUS.failed) return true;
	if (e.kind === "lifecycle" && e.type === "step") {
		// Each step is one row. A technical step's text starts with a lowercase letter. A reader looks for the prose steps on a rail.
		const isTechnical = /^[a-z]/.test(e.in ?? "");
		return !isTechnical;
	}
	return false;
}

/**
 * Returns the mark for a division of actuality from the events it holds and the count of each.
 *
 * A view shows actuality of any length as divisions rather than records, so each division gets one mark. A division
 * that holds an event marked as a fault marks as a fault, so the successes around a single failure don't hide it. Any
 * other division takes the style of the held entry with the largest count. `eventMarkerStyle` determines the fault style
 * and which events get it, so a division and a row mark a failure the same way.
 *
 * Returns undefined for a division that doesn't hold an event, so an empty stretch of actuality draws as empty.
 */
export function bucketMarkerStyle(held: ReadonlyArray<{ event: unknown; count: number }>): TEventMarkerStyle | undefined {
	const styled = held.filter(({ count }) => count > 0).map(({ event, count }) => ({ style: eventMarkerStyle(event), count }));
	if (styled.length === 0) return undefined;
	const failing = styled.filter(({ style }) => style.color === MARK_COLOUR.fault);
	const among = failing.length > 0 ? failing : styled;
	// Selects the style of the entry with the largest count. A tie selects the entry whose icon sorts first, so the same
	// counts give the same mark in any read order.
	return among.reduce((most, one) => (one.count > most.count || (one.count === most.count && one.style.icon < most.style.icon) ? one : most)).style;
}
