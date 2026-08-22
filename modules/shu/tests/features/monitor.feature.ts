import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import ShuStepper from "../../build/shu-stepper.js";
import ShuMonitorColumnControls from "../../build/components/shu-monitor-column.controls.js";
import ShuScrollbarControls from "../../build/components/shu-scrollbar.controls.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import BlipsStepper from "@haibun/core/steps/blips-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { SHU_TEST_IDS } from "../../build/test-ids.js";
import { createStepUI, flattenTestIds } from "@haibun/shu/test/step-ui.js";
import { SHU_TAG } from "@haibun/shu/consts.js";

const wp = new WebPlaywright();
const { serveShuApp } = withAction(new ShuStepper());
const { waitFor, gotoPage, takeScreenshot } = withAction(wp);
const { setAs } = withAction(new VariablesStepper());
const { watchBlips } = withAction(new BlipsStepper());
const { feature, scenario } = withAction(new Haibun());
const {
	monitorShowsFewerThan,
	seekMonitorRail,
	monitorFirstVisibleRow,
	monitorFirstVisibleRowIsNot,
	documentShowsFewerThan,
	clickFirstDocRow,
	documentFutureRowsAtLeast,
	scrubMonitorFirstRow,
	monitorFutureRowsAtLeast,
	monitorShowsRowContaining,
	monitorTotalAtLeast,
	documentThumbnailsFlow,
	expandFirstThumbnail,
	expandedThumbnailNavigates,
	documentAtLiveEdge,
} = withAction(new ShuMonitorColumnControls());
const { railThumbHoldsSize, railThumbTakesAPress } = withAction(new ShuScrollbarControls());
const { enterStepMode, passesStepExecution } = createStepUI(wp);
const host = "http://localhost:8237";
const IDS = SHU_TEST_IDS;

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

		scenario({ scenario: "The monitor virtualizes the log to the viewport" }),
		"Every buffered event is in the log, but the monitor renders only the rows in view plus the virtualizer's small overscan, so the DOM stays small no matter how long the run.",
		monitorShowsFewerThan({ max: "150" }),
		"On load the monitor sits at the live edge, not the top: it followed the newest buffered event, so the first visible row is not row one.",
		monitorFirstVisibleRowIsNot({ ordinal: '"1"' }),

		scenario({ scenario: "A live event at the edge scrolls the monitor to the newest row" }),
		"With the reader at the live edge (still at the bottom from load, the time cursor null), a new event streaming in scrolls the monitor to it, so the newest row comes into view rather than being left out of view. The tail follows only while the reader is at the bottom and the cursor is at the live edge; scrolling up or scrubbing the cursor into the past pauses it.",
		setAs({ what: "liveTailEvent", domain: "page-test-id", value: '"live-tail-marker"' }),
		monitorTotalAtLeast({ n: "201" }),
		monitorShowsRowContaining({ text: '"liveTailEvent"' }),

		scenario({ scenario: "A running test streams a burst and the monitor stays at the live edge" }),
		"A real run streams events continuously, not one at a time. Thirty stream in with the cursor left at the live edge; the monitor keeps pace across every append, so the last of the burst is on screen at the end rather than left out of view.",
		...burstEvents,
		monitorTotalAtLeast({ n: "231" }),
		monitorShowsRowContaining({ text: '"burstEvent29"' }),

		scenario({ scenario: "The custom scroll rail drives the virtualized viewport" }),
		"Ask to be told what the views do, before touching the rail. A view records its own scroll geometry as it changes, at whatever rate it changes, and the run keeps none of it: asking is what makes it readable at all.",
		watchBlips({ names: '"haibun.shu.view"' }),

		"The rail is not decoration: seeking it moves the window. Seek to the bottom and the first visible row is no longer row one; seek back to the top and it is row one again — proving a drag or click on the rail scrolls the virtualizer (a holey placeholder items array once made every seek a silent no-op).",
		seekMonitorRail({ where: '"bottom"' }),
		monitorFirstVisibleRowIsNot({ ordinal: '"1"' }),
		seekMonitorRail({ where: '"top"' }),
		monitorFirstVisibleRow({ ordinal: '"1"' }),

		"The thumb is what a reader grabs to drag, so a press aimed at the middle of it has to reach it. Every event worth marking is drawn on this rail, and a mark drawn over the thumb would take that press and jump to itself instead, leaving the thumb ungrabbable on exactly the runs that have the most to look through.",
		railThumbTakesAPress({ host: `"${SHU_TAG.MONITOR_COLUMN}"` }),

		scenario({ scenario: "A manual scroll up pauses the tail; returning to the bottom resumes it" }),
		"A reader scrolling back through the log must not be yanked to the newest row every time an event streams in. Scrolled to the top, a streamed event leaves the view where it is — the tail is paused because the reader is no longer at the bottom, not because any cursor was scrubbed. Scroll back to the bottom and the tail re-engages, so the next event is followed again.",
		setAs({ what: "scrollPausedEvent", domain: "page-test-id", value: '"scroll-paused-marker"' }),
		monitorFirstVisibleRow({ ordinal: '"1"' }),
		seekMonitorRail({ where: '"bottom"' }),
		setAs({ what: "scrollResumedEvent", domain: "page-test-id", value: '"scroll-resumed-marker"' }),
		monitorShowsRowContaining({ text: '"scrollResumedEvent"' }),

		"The rail thumb states how much of the column is on screen, so it holds its size as the reader scrolls and travels with them. Rows here are uniform lines of log.",
		railThumbHoldsSize({ host: `"${SHU_TAG.MONITOR_COLUMN}"` }),

		"Everything the views did through all that scrolling reached the run as fine-grained occurrences, recorded in the browser at the rate they happened and handed over in batches, since one request each would not be affordable. The run keeps none of them; the watch holds them in order, which is what says whether a size changed while a reader was scrolling rather than only that it changed.",
		'some occurrence observed in watched blips is "variable occurrence/name is "haibun.shu.view.thumb_resize""',

		scenario({ scenario: "The run document virtualizes the same buffered log" }),
		"The document reads the same buffered events as prose. It too renders only the blocks in view, so a long run stays a small DOM with every earlier event still reachable.",
		...passesStepExecution("MonitorStepper-showDocument", {}),
		documentShowsFewerThan({ max: "150" }),

		scenario({ scenario: "The document panel follows the live edge, not just its rail" }),
		"Opened at the live edge, the document scrolls its PANEL, not only its rail, as events stream. A burst streams in with the cursor at the live edge; the panel's own scroller ends at the bottom (the height-estimate overshoot aside), showing the newest of them rather than parked where a rail-only follow would leave the content.",
		...docStreamEvents,
		takeScreenshot({}),
		takeScreenshot({}),
		takeScreenshot({}),
		documentAtLiveEdge(),

		scenario({ scenario: "The run's screenshots render as tiles that flow in the column" }),
		"The screenshots this very run just took stream in as artifact events and render as thumbnail tiles in the document: each frame sits in a thumbnail grid row, sized as a tile of the column's grid (never shrink-wrapped small, never blown up to the whole column), with the real image served and filling its frame. Grouping a run of screenshots into one strip is covered by the document-blocks unit tests; this measures the real rendered result.",
		documentThumbnailsFlow(),
		"The same holds where the blocks differ in height: a screen of prose and a screen of screenshots put very different numbers of blocks on screen, and the thumb must not resize between them.",
		railThumbHoldsSize({ host: `"${SHU_TAG.DOCUMENT_COLUMN}"` }),

		"The document column's own micro-movement reached the run: every raw change of its thumb measurement, including the ones too small to redraw, recorded from the browser and held in order. This is the record a smoothness problem is diagnosed from.",
		`some occurrence observed in watched blips is "variable occurrence/view is "${SHU_TAG.DOCUMENT_COLUMN}""`,

		scenario({ scenario: "A thumbnail expands with its step caption and arrows walk the run's screenshots" }),
		"Clicking a thumbnail expands it over the column and captions it with the step that took it; the caption rides a stamp the document build put on the frame, since under virtualization the step's own row may not be in the reading window at all. Arrow keys then move between the run's screenshots through the document column, which is the only party that can reach frames outside the rendered window; the time cursor follows each expanded screenshot's step, dimming everything recorded after it.",
		expandFirstThumbnail(),
		documentFutureRowsAtLeast({ min: "1" }),
		expandedThumbnailNavigates(),

		scenario({ scenario: "The document follows the global time cursor" }),
		"Scrubbing the time cursor to a row dims every event recorded after it. Click the first row and the later rows dim, proving the virtualized document tracks the shared cursor, not just its own initial paint.",
		clickFirstDocRow({}),
		documentFutureRowsAtLeast({ min: "1" }),

		scenario({ scenario: "The monitor and document both follow an externally moved cursor" }),
		"Move the cursor from the monitor's own first row (the way the timeline or another view moves it): both the monitor AND the still-open document dim their later rows, proving each virtualized view re-renders on the shared cursor, not only when it set the cursor itself.",
		scrubMonitorFirstRow(),
		monitorFutureRowsAtLeast({ min: "1" }),
		documentFutureRowsAtLeast({ min: "1" }),
	],
};
