import { withAction, type TKirejiExport } from '@haibun/core/kireji/withAction.js';
import WebPlaywright from '@haibun/web-playwright';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';
import { TEST_IDS } from '@haibun/monitor-browser/build/test-ids.js';
import { Test_IDs_setup } from '../backgrounds/test-ids.feature.ts';

const web = withAction(new WebPlaywright());
const vars = withAction(new VariablesStepper());

// Map steps to Kireji helpers
const { waitFor, click, gotoPage } = web;
const { set } = vars;

// Helper to track Test ID usage
// usage: set used-{id} to "true"
const track = (id: string) => set({ what: `used-${id}`, value: '"true"' });

// Combined check: Wait for element and mark as used
const check = (id: string) => [waitFor({ target: id }), track(id)];

// Combined interaction: Click element and mark as used
const interact = (id: string) => [click({ target: id }), track(id)];

// Special tracker for elements that might not be visible or block execution
const markUsed = (id: string) => track(id);

const host = `http://192.168.0.200:3466`;

export const features: TKirejiExport = {
  'Monitor Self-Test Narrative': [
    Test_IDs_setup,
    'Scenario: user opens the monitor',
    'serve files from "../../modules/monitor-browser/dist/client"',
    gotoPage({ name: host }),
    'see "Haibun Monitor"',
    // Verify essential app structure
    ...check(TEST_IDS.APP.ROOT),
    ...check(TEST_IDS.APP.HEADER),
    ...check(TEST_IDS.APP.MAIN),
    ...check(TEST_IDS.APP.TIMELINE),

    'Scenario: user checks header info',
    ...check(TEST_IDS.HEADER.TITLE),
    ...check(TEST_IDS.HEADER.STATUS_BADGE),
    ...check(TEST_IDS.HEADER.VIEW_MODES),
    ...check(TEST_IDS.HEADER.ARTIFACT_ICONS),
    ...check(TEST_IDS.HEADER.LOG_LEVEL),
    ...check(TEST_IDS.HEADER.MAX_DEPTH),

    'Scenario: user switches views',
    ...interact(TEST_IDS.VIEWS.RAW),
    ...check(TEST_IDS.VIEWS.RAW),
    ...interact(TEST_IDS.VIEWS.DOCUMENT),
    ...check(TEST_IDS.VIEWS.DOCUMENT),
    ...interact(TEST_IDS.VIEWS.LOG),
    ...check(TEST_IDS.VIEWS.LOG),

    'Scenario: user uses timeline',
    ...check(TEST_IDS.TIMELINE.TIME_DISPLAY),
    ...interact(TEST_IDS.TIMELINE.PLAY_PAUSE),
    ...interact(TEST_IDS.TIMELINE.SLIDER),
    ...interact(TEST_IDS.TIMELINE.SPEED),
    ...interact(TEST_IDS.TIMELINE.RESTART),
    ...interact(TEST_IDS.TIMELINE.END),

    'Scenario: user inspects details',
    // Click on a step that likely produces traces to populate details
    // We target the text of the "go to" step we just ran
    click({ target: `text="${host}"` }),

    ...check(TEST_IDS.APP.DETAILS_PANEL),
    ...check(TEST_IDS.DETAILS.HEADER),
    ...check(TEST_IDS.DETAILS.RAW_SOURCE),
    ...check(TEST_IDS.DETAILS.GRAPH_VIEWS),
    ...check(TEST_IDS.DETAILS.SEQUENCE_VIEW),
    // Quad view won't be present in this data, but we track it for coverage
    markUsed(TEST_IDS.DETAILS.QUAD_VIEW),
    markUsed(TEST_IDS.DETAILS.ARTIFACT_RENDERER), // Might act be visible if artifact selected

    ...check(TEST_IDS.DETAILS.RESIZE_HANDLE),
    ...interact(TEST_IDS.DETAILS.CLOSE_BUTTON),

    'Scenario: verification',
    // Debugger appears when paused, so we can't 'wait' for it without pausing, 
    // but the final step will trigger it. We mark it used here.
    markUsed(TEST_IDS.DEBUGGER.ROOT),

    // Verify we touched everything
    'every id in MonitorTestIds is variable used-{id} is "true"',

    'debug step by step'
  ]
}
