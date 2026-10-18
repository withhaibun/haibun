/** The stepper's name, which its actions and its steps' methods begin with. */
export const ACTIVITIES_STEPPER = "ActivitiesStepper";

/** The actions a delegation names to let another party save a waypoint, and run a waypoint saved while actuality ran. Each
 *  saved waypoint's step requires running one, and so does `run the saved waypoint`; each line of the waypoint requires its
 *  own action under the caller's invocation, so holding it never allows more than calling the lines one by one. Kept apart
 *  from the stepper, so a page names them without bundling the stepper. */
export const ACTIVITIES_ACTIONS = { saveWaypoint: `${ACTIVITIES_STEPPER}:saveWaypoint`, runSavedWaypoint: `${ACTIVITIES_STEPPER}:runSavedWaypoint` } as const;
