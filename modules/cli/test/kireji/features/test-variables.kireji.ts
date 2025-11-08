import { withAction } from '@haibun/core/kireji/withAction.js';
import ActivitiesStepper from '@haibun/core/steps/activities-stepper.js';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';

import { dataIsReady, varsAreSetup } from '../backgrounds/setup.kireji.js';

const activitiesStepper = new ActivitiesStepper();
const variablesStepper = new VariablesStepper();

const { activity, ensure } = withAction(activitiesStepper);
const { set, is: variableIs, combine } = withAction(variablesStepper);

export const features = {
  'Test Kireji Variables and Outcomes': [
    'This feature tests variables and outcomes using kireji format.',
    'Variables can be set, checked, and combined.',
    'Outcomes are automatically loaded from backgrounds.',
    activity({ activity: 'Test variable operations' }),
    ensure({ outcome: varsAreSetup }),
    variableIs({ what: 'greeting', value: 'Hello' }),
    set({ what: 'name', value: 'World' }),
    combine({ p1: 'greeting', p2: 'name', what: 'fullGreeting' }),
    variableIs({ what: 'fullGreeting', value: 'HelloWorld' }),
    activity({ activity: 'Test outcomes' }),
    ensure({ outcome: dataIsReady }),
    variableIs({ what: 'dataStatus', value: 'ready' }),
    ensure({ outcome: dataIsReady }),
  ],
};
