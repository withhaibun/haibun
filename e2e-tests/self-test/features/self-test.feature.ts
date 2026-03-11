import { withAction, type TKirejiExport } from '@haibun/core/kireji/withAction.js';
import WebPlaywright from '@haibun/web-playwright';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';
import { TEST_IDS } from '@haibun/monitor-browser/build/test-ids.js';
import { Test_IDs_setup } from '../backgrounds/test-ids.feature.ts';
import { OBSCURED_VALUE } from '@haibun/core/lib/feature-variables.js';

const web = withAction(new WebPlaywright());
const vars = withAction(new VariablesStepper());

const { waitFor, click, gotoPage } = web;
const { set } = vars;

const sets = (id: string) => set({ what: `used-${id}`, value: '"true"' });
const waitsFor = (id: string) => [waitFor({ target: id }), sets(id)];
const clicks = (id: string) => [click({ target: id }), sets(id)];

const host = `http://localhost:3459`;

const FRAGMENT = 'ISECRET';

// these must be the same as self-test script in package.json.
export const SECRETS = {
  FRAGMENT,
  SNAKE_CASE: `${FRAGMENT}_snake`,
  ALL_CAPS: `${FRAGMENT}_CAPS`,
  USER_PASSWORD: `${FRAGMENT}_user`,
};

export const features: TKirejiExport = {
  'Monitor Self-Test Narrative': [
    Test_IDs_setup,

    'Scenario: A user opens the Haibun Monitor to review execution data.',
    `saves monitor to "/tmp/monitor.html"`,
    `after every WebPlaywright, take a screenshot`,
    gotoPage({ name: host }),
    `
		see "Haibun Monitor"

    When the page loads, see the main application container.`,
    ...waitsFor(TEST_IDS.APP.ROOT),
    'At the top, a header bar provides navigation and status information.',
    ...waitsFor(TEST_IDS.APP.HEADER),
    'The main content area displays execution events and logs.',
    ...waitsFor(TEST_IDS.APP.MAIN),
    'At the bottom, a timeline bar allows scrubbing through recorded events.',
    ...waitsFor(TEST_IDS.APP.TIMELINE),

    'Scenario: The user explores the header controls.',
    'The title confirms this is the Haibun Monitor.',
    ...waitsFor(TEST_IDS.HEADER.TITLE),
    'A status badge indicates whether the connection is live or offline.',
    ...waitsFor(TEST_IDS.HEADER.STATUS_BADGE),
    'View mode buttons let the user switch between different displays.',
    ...waitsFor(TEST_IDS.HEADER.VIEW_MODES),
    'Icons show available artifacts like videos and traces.',
    ...waitsFor(TEST_IDS.HEADER.ARTIFACT_ICONS),
    'A log level selector filters which messages are shown.',
    ...waitsFor(TEST_IDS.HEADER.LOG_LEVEL),
    'A depth control limits nesting in the display.',
    ...waitsFor(TEST_IDS.HEADER.MAX_DEPTH),

    'Scenario: The user switches between different view modes.',
    'Click the raw view button to see the underlying JSON data.',
    ...clicks(TEST_IDS.HEADER.BUTTON_VIEW_RAW),
    ...waitsFor(TEST_IDS.VIEWS.RAW),
    'Switch to the document view for a formatted narrative.',
    ...clicks(TEST_IDS.HEADER.BUTTON_VIEW_DOCUMENT),
    ...waitsFor(TEST_IDS.VIEWS.DOCUMENT),
    'Return to the log view for detailed event output.',
    ...clicks(TEST_IDS.HEADER.BUTTON_VIEW_LOG),
    ...waitsFor(TEST_IDS.VIEWS.LOG),

    'Scenario: The user controls playback with the timeline.',
    'The time display shows position in the recording.',
    ...waitsFor(TEST_IDS.TIMELINE.TIME_DISPLAY),
    'Click play to start automatic playback of events.',
    ...clicks(TEST_IDS.TIMELINE.PLAY_PAUSE),
    'Drag the slider to jump to a specific moment.',
    ...clicks(TEST_IDS.TIMELINE.SLIDER),
    'Adjust the playback speed for faster review.',
    ...clicks(TEST_IDS.TIMELINE.SPEED),
    'Click restart to go back to the beginning.',
    ...clicks(TEST_IDS.TIMELINE.RESTART),
    'Click end to jump to the most recent event.',
    ...clicks(TEST_IDS.TIMELINE.END),

    'Scenario: The user inspects a specific event in detail.',
    'Click on an event in the log to open the details panel.',
    `pause for 1s`,
    ...clicks(TEST_IDS.VIEWS.LATEST_EVENT),
    'A side panel slides open showing detailed information.',
    ...waitsFor(TEST_IDS.APP.DETAILS_PANEL),
    'The panel header displays the event timestamp and type.',
    ...waitsFor(TEST_IDS.DETAILS.HEADER),

    'Scenario: The user enables the sequence and quad graph views.',
    'Click the sequence button to see HTTP request traces.',
    ...clicks(TEST_IDS.HEADER.TOGGLE_SEQUENCE),
    'Click the quad button to see knowledge graph data.',
    ...clicks(TEST_IDS.HEADER.TOGGLE_QUAD),

    'Scenario: Verify timeline seeking dims future events in log view.',
    'The user is in log view and sees events with timestamps.',
    ...waitsFor(TEST_IDS.VIEWS.LOG),
    'Click the restart button to go to the beginning of the timeline.',
    ...clicks(TEST_IDS.TIMELINE.RESTART),
    'At the beginning, future events (after position 0) should have the future-event class.',
    'Click on the latest event row to jump to that time.',
    ...clicks(TEST_IDS.VIEWS.LATEST_EVENT),
    'The timeline slider should reflect the new position.',
    ...waitsFor(TEST_IDS.TIMELINE.SLIDER),
    'The details panel shows information about the selected event.',
    ...waitsFor(TEST_IDS.APP.DETAILS_PANEL),

    'Scenario: Verify sequence diagram highlights current trace and dims future traces.',
    'With sequence diagram enabled, the user navigates to mid-timeline.',
    ...waitsFor(TEST_IDS.DETAILS.SEQUENCE_VIEW),
    'The current trace in the sequence diagram should be highlighted with bold styling.',
    'Past traces remain visible but unemphasized.',
    'Future traces should appear dimmed with reduced opacity.',
    'Click the restart button to go back to the beginning.',
    ...clicks(TEST_IDS.TIMELINE.RESTART),
    'Now the first trace should be highlighted and all others dimmed.',
    'Click end to jump to the most recent event.',
    ...clicks(TEST_IDS.TIMELINE.END),
    'Now all traces should be visible (none dimmed as we are at the end).',

    'Scenario: Verify quad graph highlights current nodes/edges and dims future ones.',
    ...waitsFor(TEST_IDS.DETAILS.QUAD_VIEW),
    'The quad graph shows knowledge relationships from execution.',
    'Nodes and edges that occurred before the current time are fully visible.',
    'Nodes and edges in the future relative to timeline are dimmed.',
    'Click restart to go to timeline beginning.',
    ...clicks(TEST_IDS.TIMELINE.RESTART),
    'Future nodes should have dashed strokes and reduced opacity.',
    'Click end to see all nodes fully visible.',
    ...clicks(TEST_IDS.TIMELINE.END),
    'All nodes and edges should now be fully visible (none dimmed).',

    'Scenario: Verify document view row selection updates timeline and dims future content.',
    'Switch to document view for a narrative display.',
    ...clicks(TEST_IDS.HEADER.BUTTON_VIEW_DOCUMENT),
    ...waitsFor(TEST_IDS.VIEWS.DOCUMENT),
    'Click the restart button to go to the beginning.',
    ...clicks(TEST_IDS.TIMELINE.RESTART),
    'Future rows after the timeline position should have the future-event class applied.',
    'Click on a document row to update the timeline position.',
    'Previous rows remain fully visible while later rows become dimmed.',
    'Click end to jump to the most recent event.',
    ...clicks(TEST_IDS.TIMELINE.END),
    'All rows should now be fully visible (none dimmed).',
    'Return to log view to continue testing.',
    ...clicks(TEST_IDS.HEADER.BUTTON_VIEW_LOG),
    ...waitsFor(TEST_IDS.VIEWS.LOG),

    'Scenario: Verify clicking an early row does not jump the view.',
    'Click on the first visible row.',
    ...clicks(TEST_IDS.VIEWS.FIRST_ROW),
    'The first row should still be visible after selection.',
    ...waitsFor(TEST_IDS.VIEWS.FIRST_ROW),

    /* fix these after
    'The raw JSON source is shown for debugging purposes.',
    ...waitsFor(TEST_IDS.DETAILS.RAW_SOURCE),
    'Graph visualizations help understand execution flow.',
    ...waitsFor(TEST_IDS.DETAILS.GRAPH_VIEWS),
    'The sequence diagram shows HTTP request timing.',
    ...waitsFor(TEST_IDS.DETAILS.SEQUENCE_VIEW),
    'The quad graph shows semantic relationships.',
    ...waitsFor(TEST_IDS.DETAILS.QUAD_VIEW),
    'A resize handle lets the user adjust the panel width.',
    ...waitsFor(TEST_IDS.DETAILS.RESIZE_HANDLE),
    'When done, they click close to dismiss the panel.',
    ...clicks(TEST_IDS.DETAILS.CLOSE_BUTTON),

    // Note: DEBUGGER and ARTIFACT_RENDERER IDs are excluded from verification
    // because they require specific conditions (debug mode, artifact events)

    'every id in MonitorTestIds is variable used-{id} is "true"',
    */

    `
    Scenario: Show env obscures secrets and keeps others visible.
    show env
    not see "${SECRETS.FRAGMENT}"

    Scenario: Composed variables inherit secret status from environment.
    set normalConfig to "visible-config"
    compose adminPassword with {normalConfig}-{SNAKE_CASE_PASSWORD}
    show vars
    pause for 1s
    see ""normalConfig": "visible-config""
    see ""adminPassword": "${OBSCURED_VALUE}""
    `
  ]
}
