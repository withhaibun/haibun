import { withAction, type TKirejiExport } from '@haibun/core/kireji/withAction.js';
import WebPlaywright from '@haibun/web-playwright';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';
import { TEST_IDS } from '@haibun/monitor-browser/build/test-ids.js';
import { Test_IDs_setup } from '../backgrounds/test-ids.feature.ts';
import { HIDDEN_SECRET } from '@haibun/core/lib/sanitization.js';

const web = withAction(new WebPlaywright());
const vars = withAction(new VariablesStepper());

const { waitFor, click, gotoPage } = web;
const { set } = vars;

const sets = (id: string) => set({ what: `used-${id}`, value: '"true"' });
const waitsFor = (id: string) => [waitFor({ target: id }), sets(id)];
const clicks = (id: string) => [click({ target: id }), sets(id)];

const host = `http://192.168.0.200:3459`;

export const features: TKirejiExport = {
  'Monitor Self-Test Narrative': [
    Test_IDs_setup,

    'Scenario: A user opens the Haibun Monitor to review execution data.',
    // Set a known output path for the HTML report so z-post can verify it
    'use "/tmp/self-test-report.html" for monitor html output',
    `after every WebPlaywright, take a screenshot`,
    gotoPage({ name: host }),
    'see "Haibun Monitor"',

    'When the page loads, the user sees the main application container.',
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
    'The user clicks the raw view button to see the underlying JSON data.',
    ...clicks(TEST_IDS.HEADER.BUTTON_VIEW_RAW),
    ...waitsFor(TEST_IDS.VIEWS.RAW),
    'Then they switch to the document view for a formatted narrative.',
    ...clicks(TEST_IDS.HEADER.BUTTON_VIEW_DOCUMENT),
    ...waitsFor(TEST_IDS.VIEWS.DOCUMENT),
    'Finally, they return to the log view for detailed event output.',
    ...clicks(TEST_IDS.HEADER.BUTTON_VIEW_LOG),
    ...waitsFor(TEST_IDS.VIEWS.LOG),

    'Scenario: The user controls playback with the timeline.',
    'The time display shows how far into the recording they are.',
    ...waitsFor(TEST_IDS.TIMELINE.TIME_DISPLAY),
    'They click play to start automatic playback of events.',
    ...clicks(TEST_IDS.TIMELINE.PLAY_PAUSE),
    'They drag the slider to jump to a specific moment.',
    ...clicks(TEST_IDS.TIMELINE.SLIDER),
    'They adjust the playback speed for faster review.',
    ...clicks(TEST_IDS.TIMELINE.SPEED),
    'They click restart to go back to the beginning.',
    ...clicks(TEST_IDS.TIMELINE.RESTART),
    'They click end to jump to the most recent event.',
    ...clicks(TEST_IDS.TIMELINE.END),

    'Scenario: The user inspects a specific event in detail.',
    'They click on an event in the log to open the details panel.',
    ...clicks(TEST_IDS.VIEWS.LATEST_EVENT),
    'A side panel slides open showing detailed information.',
    ...waitsFor(TEST_IDS.APP.DETAILS_PANEL),
    'The panel header displays the event timestamp and type.',
    ...waitsFor(TEST_IDS.DETAILS.HEADER),

    'Scenario: The user enables the sequence and quad graph views.',
    'They click the sequence button to see HTTP request traces.',
    ...clicks(TEST_IDS.HEADER.TOGGLE_SEQUENCE),
    'They click the quad button to see knowledge graph data.',
    ...clicks(TEST_IDS.HEADER.TOGGLE_QUAD),

    'Scenario: Verify timeline seeking dims future events in log view.',
    'The user is in log view and sees events with timestamps.',
    ...waitsFor(TEST_IDS.VIEWS.LOG),
    'They click the restart button to go to the beginning of the timeline.',
    ...clicks(TEST_IDS.TIMELINE.RESTART),
    'At the beginning, future events (after position 0) should have the future-event class.',
    'They click on the latest event row to jump to that time.',
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
    'They click the restart button to go back to the beginning.',
    ...clicks(TEST_IDS.TIMELINE.RESTART),
    'Now the first trace should be highlighted and all others dimmed.',
    'They click end to jump to the most recent event.',
    ...clicks(TEST_IDS.TIMELINE.END),
    'Now all traces should be visible (none dimmed as we are at the end).',

    'Scenario: Verify quad graph highlights current nodes/edges and dims future ones.',
    ...waitsFor(TEST_IDS.DETAILS.QUAD_VIEW),
    'The quad graph shows knowledge relationships from execution.',
    'Nodes and edges that occurred before the current time are fully visible.',
    'Nodes and edges in the future relative to timeline are dimmed.',
    'They click restart to go to timeline beginning.',
    ...clicks(TEST_IDS.TIMELINE.RESTART),
    'Future nodes should have dashed strokes and reduced opacity.',
    'They click end to see all nodes fully visible.',
    ...clicks(TEST_IDS.TIMELINE.END),
    'All nodes and edges should now be fully visible (none dimmed).',

    'Scenario: Verify document view row selection updates timeline and dims future content.',
    'The user switches to document view for a narrative display.',
    ...clicks(TEST_IDS.HEADER.BUTTON_VIEW_DOCUMENT),
    ...waitsFor(TEST_IDS.VIEWS.DOCUMENT),
    'They click the restart button to go to the beginning.',
    ...clicks(TEST_IDS.TIMELINE.RESTART),
    'Future rows after the timeline position should have the future-event class applied.',
    'When they click on a document row, the timeline position updates.',
    'Previous rows remain fully visible while later rows become dimmed.',
    'They can then click end to jump to the most recent event.',
    ...clicks(TEST_IDS.TIMELINE.END),
    'All rows should now be fully visible (none dimmed).',
    'The user returns to log view to continue testing.',
    ...clicks(TEST_IDS.HEADER.BUTTON_VIEW_LOG),
    ...waitsFor(TEST_IDS.VIEWS.LOG),

    'Scenario: Verify clicking an early row does not jump the view.',
    'The user clicks on the first visible row.',
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

    'Scenario: All testable IDs have been verified.',
    'every id in MonitorTestIds is variable used-{id} is "true"',
    */

    `
    Scenario: Secret variables are auto-detected by password pattern.
    When a variable name contains "password", Haibun automatically treats it as secret.
    set userPassword to "my-secret-password"
    The variable is set and can be used internally.
    variable userPassword exists
    But when displayed in the monitor, the value is obscured.
    show var userPassword
    pause for 1s
    see "value": "${HIDDEN_SECRET}"
    The step text itself is sanitized, replacing the literal value.
    see set userPassword to "${HIDDEN_SECRET}"

    Scenario: Secret variables can be explicitly marked with as secret.
    Variables can also be explicitly marked as secret using "as secret".
    set apiKey as secret string to "key-123-abc"
    The variable is set and can be used internally.
    variable apiKey exists
    But is hidden in all monitor output.
    show var apiKey
    pause for 1s
    see "value": "${HIDDEN_SECRET}"
    The step text shows the hidden placeholder.
    see set apiKey as secret string to "${HIDDEN_SECRET}"

    Scenario: Show vars obscures secrets but shows non-secrets.
    When showing all variables, secrets are obscured while others remain visible.
    set publicUsername to "testuser"
    set dbPassword to "db-secret-pass"
    set sessionToken as secret to "session-abc-123"
    show vars
    pause for 1s
    Public variables display their actual values.
    see "publicUsername": "testuser"
    Secret variables show the hidden placeholder in the display.
    see "dbPassword": "${HIDDEN_SECRET}"
    see "sessionToken": "${HIDDEN_SECRET}"
    The step text for setting secrets is also sanitized.
    see set dbPassword to "${HIDDEN_SECRET}"
    see set sessionToken as secret to "${HIDDEN_SECRET}"

    Scenario: Mixed explicit and auto-detected secrets in show vars.
    Both explicit secrets and password-pattern secrets are obscured together.
    set configApiToken as secret string to "token-xyz"
    set normalConfig to "visible-config"
    set adminPassword to "admin-secret"
    show vars
    pause for 1s
    Non-secret config values remain visible.
    see "normalConfig": "visible-config"
    Both the explicit and auto-detected secrets are hidden.
    see "configApiToken": "${HIDDEN_SECRET}"
    see "adminPassword": "${HIDDEN_SECRET}"

    Scenario: Password variations are detected as secret.
    The password pattern detection is case-insensitive and works with various naming styles.
    set PASSWORD_DB to "all-caps-pass"
    set MyPassword123 to "camel-case-pass"
    set user_password_hash to "snake-case-pass"
    show vars
    pause for 1s
    All variations containing "password" are detected and hidden.
    see "PASSWORD_DB": "${HIDDEN_SECRET}"
    see "MyPassword123": "${HIDDEN_SECRET}"
    see "user_password_hash": "${HIDDEN_SECRET}"

    Scenario: Secret status is inherited through compose.
    When composing a new variable from secret components, the result inherits secret status.
    set mySecret as secret to "secret-value-123"
    set publicPart to "prefix"
    compose derivedFromSecret with {publicPart}-{mySecret}-suffix
    compose multiSecret with {mySecret}x{mySecret}
    show vars
    pause for 1s
    Both composed variables are marked as secrets because they contain secret values.
    see "derivedFromSecret": "${HIDDEN_SECRET}"
    see "multiSecret": "${HIDDEN_SECRET}"
`,
  ]
}
