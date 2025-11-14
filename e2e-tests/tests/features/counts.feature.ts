
import type { TKirejiExport } from '@haibun/core/kireji/withAction.js';

export const features: TKirejiExport = {
	'Counts feature': [
		`Demonstrate counting with waypoints and variables.
The activity 'counts' increments a counter variable and uses a waypoint to check if it has reached a target number.`,

		`Activity: Increment count
increment counter
waypoint Count to {num} with variable counter is {num}

Scenario: Use Until to ensure counter reaches 3
set counter as number to 0
until ensure Count to 3
show var counter
variable counter is 3`]
}
