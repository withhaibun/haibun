import { withAction } from '@haibun/core/kireji/withAction.js';
import ActivitiesStepper from '@haibun/core/steps/activities-stepper.js';

const activitiesStepper = new ActivitiesStepper();

const { remember } = withAction(activitiesStepper);

export const dataIsReady = 'Data is ready';
export const varsAreSetup = 'Variables are setup';

export const backgrounds = {
  'Setup for Tests': [
    'Define reusable outcomes for testing.',
    remember({ outcome: varsAreSetup, proof: 'set greeting to Hello' }),
    remember({ outcome: dataIsReady, proof: 'set dataStatus to ready' }),
  ],
};
