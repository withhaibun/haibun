/**
 * The colours of the marks every view draws, and the mark of each status a record states. A timeline's row and a graph's
 * node read them, so both mark one outcome alike. The module holds only these, so a bundle that marks a node by its
 * outcome doesn't load the marks of events.
 */
import { ICON_STEP_COMPLETED, ICON_STEP_FAILED, ICON_STEP_INTERRUPTED, ICON_STEP_RUNNING, ICON_STEP_STOPPED, RECORDED_STATUS } from "@haibun/core/lib/domains/protocol.js";

export type TEventMarkerStyle = { color: string; icon: string };

/** The mark palette. Each colour is named by what a mark shows rather than by its hue. Every surface that marks an event
 *  reads its colours here. `undecided` marks an outcome that isn't a fault or a success: a nested call's failure, a failed call
 *  actuality handed out, a stopped or interrupted step or an event that doesn't match a case. */
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

/** The mark of each status a record states as it runs or ends, by the status. A step its caller stopped, or whose process
 *  ended before it did, isn't a fault or a pass. A word that isn't a recorded status, or an absent status, doesn't have a mark. */
export const STATUS_MARKS: ReadonlyMap<string | undefined, TEventMarkerStyle> = new Map([
	[RECORDED_STATUS.running, { color: MARK_COLOUR.pending, icon: ICON_STEP_RUNNING }],
	[RECORDED_STATUS.failed, { color: MARK_COLOUR.fault, icon: ICON_STEP_FAILED }],
	[RECORDED_STATUS.completed, { color: MARK_COLOUR.ok, icon: ICON_STEP_COMPLETED }],
	[RECORDED_STATUS.stopped, { color: MARK_COLOUR.undecided, icon: ICON_STEP_STOPPED }],
	[RECORDED_STATUS.interrupted, { color: MARK_COLOUR.undecided, icon: ICON_STEP_INTERRUPTED }],
]);
