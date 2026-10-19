/** The stepper's name, with which its actions and its steps' methods begin. */
export const ACTIVITIES_STEPPER = "ActivitiesStepper";

/** The actions a delegation names to let another party save a waypoint, run a saved waypoint's lines, and apply a waypoint,
 *  saved or stated, through a line that states its head. Each line of a waypoint requires its own action under the caller's
 *  invocation, so holding one of these never allows more than calling the lines one by one. Kept apart from the stepper, so a
 *  page names them without bundling the stepper. */
export const ACTIVITIES_ACTIONS = {
	saveWaypoint: `${ACTIVITIES_STEPPER}:saveWaypoint`,
	runSavedWaypoint: `${ACTIVITIES_STEPPER}:runSavedWaypoint`,
	applyWaypoint: `${ACTIVITIES_STEPPER}:applyWaypoint`,
} as const;
