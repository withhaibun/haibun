import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import ShuStepper from "../../build/shu-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import BlipsStepper from "@haibun/core/steps/blips-stepper.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import { SHU_TEST_IDS } from "../../build/domains/test-ids.js";
import { createStepUI, flattenTestIds } from "@haibun/shu/test/step-ui.js";
import { SHU_TAG } from "@haibun/shu/domains/elements.js";
import { views } from "../../waypoints/backgrounds/views.feature.ts";

const wp = new WebPlaywright();
const { serveShuApp } = withAction(new ShuStepper());
const { click, waitFor, gotoPage, takeScreenshot } = withAction(wp);
const { setAs } = withAction(new VariablesStepper());
const { watchBlips } = withAction(new BlipsStepper());
const { feature, scenario } = withAction(new Haibun());
const { enterStepMode, passesStepExecution } = createStepUI(wp);
const host = "http://localhost:8237";
const IDS = SHU_TEST_IDS;
const MONITOR = `"${SHU_TAG.MONITOR_COLUMN}"`;
const DOCUMENT = `"${SHU_TAG.DOCUMENT_COLUMN}"`;

const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));
// Buffer far more events than any viewport can hold, so a virtualized monitor renders only a small window of them.
const BULK_EVENTS = 200;
const bulkEvents = Array.from({ length: BULK_EVENTS }, (_, i) => setAs({ what: `windowEvent${i}`, domain: "page-test-id", value: `"v${i}"` }));
// A running test does not stream one event and stop; it streams a burst. This reproduces that, so the live-follow test
// covers continuous streaming (staying at the edge across many appends), not just a single settled append.
const BURST_EVENTS = 30;
const burstEvents = Array.from({ length: BURST_EVENTS }, (_, i) => setAs({ what: `burstEvent${i}`, domain: "page-test-id", value: `"b${i}"` }));
const docStreamEvents = Array.from({ length: 12 }, (_, i) => setAs({ what: `docStream${i}`, domain: "page-test-id", value: `"ds${i}"` }));

export const features: TKirejiExport = {
	"Monitor view collects and displays execution events": [
		feature({ feature: "Monitor stepper with live log stream and run document" }),

		...testIdSetup,

		scenario({ scenario: "Start shu with monitor stepper" }),
		"The monitor stepper buffers execution events and serves them via RPC.",
		"The show monitor step opens a log stream column in the SPA.",
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "monitor-test"',

		scenario({ scenario: "Buffer many execution events" }),
		"These buffered events fill the log so a small data window has something to truncate.",
		...bulkEvents,

		scenario({ scenario: "Open SPA and enter step mode" }),
		gotoPage({ name: `"${host}/spa"` }),
		...enterStepMode,

		scenario({ scenario: "Open monitor column via step" }),
		"The show monitor step triggers the SPA to open a monitor log stream column.",
		...passesStepExecution("MonitorStepper-showMonitor", {}),
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		"The docked actions pane stands over the foot of the columns while it is open, so the reader closes it to reach the whole of the monitor's column.",
		click({ target: IDS.APP.DOCK_TOGGLE }),

		scenario({ scenario: "The monitor opens at the newest of a long run" }),
		"What a reader sees of a long run is a window of it, which the rail below moves; that is what keeps a run of any length readable.",
		"On load the monitor is placed at the live edge, not the top: it followed the newest buffered event, so the first visible row is not row one.",
		views.showsLaterRowFirst(MONITOR, "1"),

		scenario({ scenario: "A live event at the edge scrolls the monitor to the newest row" }),
		"With the reader at the live edge (still at the bottom from load, the time cursor null), a new event streaming in scrolls the monitor to it, so the newest row comes into view rather than being left out of view. The tail follows only while the reader is at the bottom and the cursor is at the live edge; scrolling up or scrubbing the cursor into the past pauses it.",
		setAs({ what: "liveTailEvent", domain: "page-test-id", value: '"live-tail-marker"' }),
		views.showsRowContaining(MONITOR, '"liveTailEvent"'),

		scenario({ scenario: "A running test streams a burst and the monitor stays at the live edge" }),
		"A real run streams events continuously, not one at a time. Thirty stream in with the cursor left at the live edge; the monitor caches pace across every append, so the last of the burst is on screen at the end rather than left out of view.",
		...burstEvents,
		views.showsRowContaining(MONITOR, '"burstEvent29"'),

		scenario({ scenario: "The custom scroll rail drives the virtualized viewport" }),
		"Ask to be informed what the views do, before touching the rail. A view records its own scroll geometry as it changes, at whatever rate it changes, and actuality doesn't cache it: asking is what makes it readable at all.",
		watchBlips({ names: '"haibun.shu.view"' }),

		"Seeking the rail moves the window. Press its end and the first visible row is no longer row one; press its start and it is row one again, so a seek reaches the virtualizer.",
		views.scrollToEnd(MONITOR),
		views.showsLaterRowFirst(MONITOR, "1"),
		views.scrollToStart(MONITOR),
		views.showsRowFirst(MONITOR, "1"),

		"The thumb is what a reader grabs to drag, so a press aimed at the middle of it has to reach it. Every event to mark is drawn on this rail, and a mark drawn over the thumb would take that press and jump to itself instead, leaving the thumb ungrabbable on exactly the runs that hold the most rows.",
		views.railThumbTakesAPress(MONITOR),

		scenario({ scenario: "A manual scroll up pauses the tail; returning to the bottom resumes it" }),
		"A reader scrolling back through the log must not be yanked to the newest row every time an event arrives. Scrolled to the top, a streamed event leaves the view where it is: the tail is paused because the reader is no longer at the bottom, not because any cursor was scrubbed. Scroll back to the bottom and the tail re-engages, so the next event is followed again.",
		views.scrollToStart(MONITOR),
		setAs({ what: "scrollPausedEvent", domain: "page-test-id", value: '"scroll-paused-marker"' }),
		views.showsRowFirst(MONITOR, "1"),
		views.scrollToEnd(MONITOR),
		setAs({ what: "scrollResumedEvent", domain: "page-test-id", value: '"scroll-resumed-marker"' }),
		views.showsRowContaining(MONITOR, '"scrollResumedEvent"'),

		"Everything the views did through all that scrolling reached actuality as fine-grained occurrences, recorded in the browser at the rate they happened and handed over in batches, since one request each would not be sustainable. Actuality doesn't cache them; the watch caches them in order, which is what reports whether a size changed while a reader was scrolling rather than only that it changed.",
		'some occurrence observed in watched blips is "variable occurrence/name is "haibun.shu.view.thumb_resize""',

		scenario({ scenario: "The run document reads the same run as prose" }),
		"The document reads the same events as prose, showing what a reader can see of a long run rather than all of it, with every earlier event still reachable.",
		"The reader opens the docked actions pane again to run the document's step.",
		click({ target: IDS.APP.DOCK_TOGGLE }),
		...passesStepExecution("MonitorStepper-showDocument", {}),
		"The reader closes the docked actions pane again to read the whole of the document's column.",
		click({ target: IDS.APP.DOCK_TOGGLE }),

		scenario({ scenario: "The document panel follows the live edge, not just its rail" }),
		"Opened at the live edge, the document scrolls its panel as events stream. A burst streams in with the cursor at the live edge, and the rows the panel shows hold the newest of them, which its rail states as the end of its travel.",
		...docStreamEvents,
		takeScreenshot({}),
		takeScreenshot({}),
		takeScreenshot({}),
		views.isAtItsEnd(DOCUMENT),

		scenario({ scenario: "Actuality's screenshots render as tiles that flow in the column" }),
		"The screenshots this actuality just took stream in as artifact events and render as thumbnail tiles in the document, each showing its image once the page has read the artifact.",
		views.documentShowsScreenshot("3"),
		"The document column's own micro-movement reached actuality: every raw change of its thumb measurement, including the ones too small to redraw, recorded from the browser and cached in order. This is the record from which a smoothness problem is diagnosed.",
		`some occurrence observed in watched blips is "variable occurrence/view is "${SHU_TAG.DOCUMENT_COLUMN}""`,

		scenario({ scenario: "A thumbnail expands with its step caption and arrows walk actuality's screenshots" }),
		"Clicking a thumbnail expands it over the column and captions it with the step that took it; the caption reads a stamp the document build put on the frame, since under virtualization the step's own row may not be in the reading window at all. The time cursor follows the expanded screenshot's step, dimming everything recorded after it. Arrow keys then move between actuality's screenshots through the document column, which reaches frames outside the rendered window. The expanded screenshot is drawn above every row, so a press on it reaches it and closes it.",
		views.expandFirstScreenshot(),
		views.expandedScreenshotShowsItsStep(),
		views.dimsRowsPastCursor(DOCUMENT),
		views.arrowKeyMovesExpandedScreenshot(),
		views.expandedScreenshotTakesAPress(),

		scenario({ scenario: "The document follows the global time cursor" }),
		"Scrubbing the time cursor to a row dims every event recorded after it. Click the first row and the later rows dim, proving the virtualized document tracks the shared cursor, not just its own initial paint.",
		views.moveCursorToFirstMoment(DOCUMENT),
		views.dimsRowsPastCursor(DOCUMENT),

		scenario({ scenario: "The monitor and document both follow an externally moved cursor" }),
		"Move the cursor from the monitor's own first row (the way the timeline or another view moves it): both the monitor AND the still-open document dim their later rows, proving each virtualized view re-renders on the shared cursor, not only when it set the cursor itself.",
		views.moveCursorToFirstMoment(MONITOR),
		views.dimsRowsPastCursor(MONITOR),
		views.dimsRowsPastCursor(DOCUMENT),
	],
};
