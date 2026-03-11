import { withAction } from '@haibun/core/kireji/withAction.js';
import ActivitiesStepper from '@haibun/core/steps/activities-stepper.js';

const activitiesStepper = new ActivitiesStepper();

const { waypointWithProof } = withAction(activitiesStepper);

export const dataIsReady = 'Data is ready';
export const varsAreSetup = 'Variables are setup';

export const backgrounds = {
  'Setup for Tests': [
    'Define reusable outcomes for testing.',
    waypointWithProof({ outcome: varsAreSetup, proof: 'set greeting to "Hello"' }),
    waypointWithProof({ outcome: dataIsReady, proof: 'set dataStatus to "ready"' }),
  ],
};
