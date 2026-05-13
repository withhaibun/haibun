/**
 * Map a haibun event to a slider marker style: an emoji icon plus a colour.
 * Mirrors the vocabulary used by the monitor-browser slider so the two views
 * stay visually consistent.
 *
 * The event shape is the SSE wire form; this helper only reads fields it
 * understands and returns a safe default for anything else.
 */
import { ICON_FEATURE, ICON_SCENARIO, ICON_STEP_RUNNING, ICON_STEP_FAILED, ICON_STEP_COMPLETED, ICON_LOG_INFO, ICON_LOG_WARN, ICON_LOG_ERROR, ICON_DEFAULT, ICON_ARTIFACT } from "@haibun/core/schema/protocol.js";

export type TEventMarkerStyle = { color: string; icon: string };

type TPartialEvent = {
	kind?: string;
	type?: string;
	status?: string;
	level?: string;
	stage?: string;
};

export function eventMarkerStyle(event: unknown): TEventMarkerStyle {
	const e = event as TPartialEvent;
	if (e.kind === "lifecycle") {
		if (e.type === "feature") return { color: "#c084fc", icon: ICON_FEATURE };
		if (e.type === "scenario") return { color: "#60a5fa", icon: ICON_SCENARIO };
		if (e.type === "step") {
			if (e.status === "running") return { color: "#eab308", icon: ICON_STEP_RUNNING };
			if (e.status === "failed") return { color: "#ef4444", icon: ICON_STEP_FAILED };
			if (e.status === "completed") return { color: "#22c55e", icon: ICON_STEP_COMPLETED };
			return { color: "#94a3b8", icon: ICON_DEFAULT };
		}
	}
	if (e.kind === "log") {
		if (e.level === "error") return { color: "#ef4444", icon: ICON_LOG_ERROR };
		if (e.level === "warn") return { color: "#eab308", icon: ICON_LOG_WARN };
		if (e.level === "info") return { color: "#3b82f6", icon: ICON_LOG_INFO };
		return { color: "#94a3b8", icon: ICON_DEFAULT };
	}
	if (e.kind === "artifact") return { color: "#10b981", icon: ICON_ARTIFACT };
	return { color: "#94a3b8", icon: ICON_DEFAULT };
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
