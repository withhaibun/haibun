import type { TKirejiExport } from "@haibun/core/kireji/withAction.js";
import { withAction } from '@haibun/core/kireji/withAction.js';
import ActivitiesStepper from '@haibun/core/steps/activities-stepper.js';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';
import { TEST_IDS } from '@haibun/monitor-browser/build/test-ids.js';
import { flattenTestIds } from '@haibun/shu/build/index.js';

const { activity } = withAction(new ActivitiesStepper());
const { setAs } = withAction(new VariablesStepper());

export const Test_IDs_setup = 'Test IDs set up';

const allTestIds = flattenTestIds(TEST_IDS);

// Categorize IDs - DEBUGGER is now tested in debugger scenario
const testableGroups = ['APP', 'HEADER', 'VIEWS', 'TIMELINE', 'DETAILS', 'DEBUGGER'];

// IDs that require specific conditions to be visible (can't be tested in automated self-test)
const conditionalIds = [
  TEST_IDS.DETAILS.ARTIFACT_RENDERER, // Requires artifact event type
  TEST_IDS.HEADER.TOGGLE_DEBUG, // Only appears during debug mode
  TEST_IDS.DEBUGGER.ROOT, // Only appears during debug mode
  TEST_IDS.DEBUGGER.INPUT, // Only appears during debug mode
  TEST_IDS.DEBUGGER.BUTTON_CONTINUE, // Only appears during debug mode
];

const filterIds = (groups: string[]) => {
  return flattenTestIds(
    Object.fromEntries(Object.entries(TEST_IDS).filter(([k]) => groups.includes(k)))
  );
};

const testableIds = filterIds(testableGroups).filter(id => !(conditionalIds as string[]).includes(id));

// Create domains
const defineDomain = (name: string, ids: string[]) =>
  `set of ${name} is [${ids.map(id => `"${id}"`).join(' ')}]`;

const domainDefinitions = [
  defineDomain('MonitorTestIds', testableIds), // Excludes conditional IDs
  defineDomain('AllTestIds', allTestIds),
];

// Generate set statements for all test-ids
const setStatements = allTestIds.map(id =>
  setAs({ what: id, domain: 'page-test-id', value: `"${id}"` })
);

export const features: TKirejiExport = {
  'Monitor Browser Test IDs Setup': [
    activity({ activity: 'Setting up Monitor Browser Test IDs' }),
    ...domainDefinitions,
    ...setStatements,
    `waypoint ${Test_IDs_setup}`,
  ]
}
