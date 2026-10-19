/**
 * The declarations of goal resolution that steppers and views read: the findings of a goal's resolution, the change signal
 * of the affordances, and the waypoint entries a stepper contributes to the affordances snapshot.
 */
import type { TFeatureStep } from "../steps/domains/stepper.js";

export const GOAL_FINDING = { SATISFIED: "satisfied", PLAN: "plan", UNREACHABLE: "unreachable", REFUSED: "refused" } as const;

/** The event-id prefix of the `affordances.<seqPath>` change signal. The goal-resolution stepper emits it in afterStep for
 *  each step that isn't a read or a projection. SPA views filter the event stream on it and re-fetch the affordances
 *  snapshot after matching events. */
export const AFFORDANCE_EVENT_PREFIX = "affordances.";

export type TWaypointEntry = {
	outcome: string;
	method: string;
	paramSlots: string[];
	proofStatements: string[];
	/** True where this waypoint's proof holds now. */
	ensured: boolean;
	error?: string;
	source: { path: string; lineNumber?: number };
	isBackground: boolean;
};

/** A stepper that contributes waypoint entries to the affordances snapshot. `show affordances` calls `waypointEntries` on
 * every registered stepper that implements it, and merges the results. */
export interface ProvidesWaypoints {
	waypointEntries(featureStep: TFeatureStep): Promise<TWaypointEntry[]>;
}
export const providesWaypoints = (s: unknown): s is ProvidesWaypoints => typeof (s as { waypointEntries?: unknown })?.waypointEntries === "function";
