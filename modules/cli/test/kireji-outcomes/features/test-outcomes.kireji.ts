import { withAction } from '@haibun/core/kireji/withAction.js';
import ActivitiesStepper from '@haibun/core/steps/activities-stepper.js';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';
import { loggedIn, dataLoaded } from '../backgrounds/outcomes.kireji.js';

const activitiesStepper = new ActivitiesStepper();
const variablesStepper = new VariablesStepper();

const { activity, ensure } = withAction(activitiesStepper);
const { is: variableIs } = withAction(variablesStepper);

export const features = {
  'Test Outcomes': [
    'This feature tests outcomes using kireji format.',
    'Outcomes are automatically loaded from backgrounds.',
    activity({ activity: 'Test outcome caching' }),
    ensure({ outcome: loggedIn }),
    variableIs({ what: 'loggedIn', value: 'true' }),
    ensure({ outcome: loggedIn }),
    ensure({ outcome: dataLoaded }),
    variableIs({ what: 'dataReady', value: 'yes' }),
  ],
};
