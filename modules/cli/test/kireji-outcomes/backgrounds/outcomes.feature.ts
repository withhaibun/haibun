import { withAction } from '@haibun/core/kireji/withAction.js';
import ActivitiesStepper from '@haibun/core/steps/activities-stepper.js';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';

const activitiesStepper = new ActivitiesStepper();
const variablesStepper = new VariablesStepper();

const { waypoint } = withAction(activitiesStepper);
const { set } = withAction(variablesStepper);

export const loggedIn = 'User is logged in';
export const dataLoaded = 'Data is loaded';

export const backgrounds = {
  'Outcome Setup': [
    'Define reusable outcomes for testing.',
    set({ what: 'username', value: 'testuser' }),
    set({ what: 'loggedIn', value: 'true' }),
    waypoint({ outcome: loggedIn, proof: 'set loggedIn to true' }),
    waypoint({ outcome: dataLoaded, proof: 'set dataReady to yes' }),
  ],
};
