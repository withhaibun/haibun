import { withAction } from '@haibun/core/kireji/withAction.js';
import type { TKirejiExport } from '@haibun/core/kireji/withAction.js';
import ActivitiesStepper from '@haibun/core/steps/activities-stepper.js';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';

export const Release_at = 'Release is at';
export const phase = 'phase';
export const Release_domain = 'release_domain';
export const effort = 'effort';

const { activity, } = withAction(new ActivitiesStepper());
const { showVar } = withAction(new VariablesStepper());

export const features: TKirejiExport = {
	'Workflow backgrounds': [
		activity({ activity: 'works on the phase' }),
		"Advance the release phase by one step when it is before the requested phase.",
		showVar({ what: 'phase' }),
		`Activity: works on the phase`,
		`Calling a waypoint without ensure will always run the activity body once.`,
		`show var ${phase}`,
		`until whenever variable ${phase} is less than {phase}, Do work`,
		`waypoint ${Release_at} {phase} with not variable ${phase} is less than {phase}`,

		`Activity: Do work`,
		`whenever not variable ${effort} is set, set ${effort} as number to 0`,
		`increment ${effort}`,
		`increment ${phase}`,
		`waypoint Do work`,
	],
};
