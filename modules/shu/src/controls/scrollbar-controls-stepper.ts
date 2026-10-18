/**
 * Controls for the scroll rail. The rail is shared: every virtualized column hosts one (shu-virtual-column), and so does
 * the annotated body, in its own pixel space. These steps take the host as an argument and find its rail, so one step
 * covers every view that holds one.
 *
 * They measure the RENDERED thumb, its box on screen, not a computed value, because what a reader complains about is
 * the thumb they see.
 *
 * Steps never lead with the article "the", haibun treats such lines as narrative prose, not matchable steps.
 */
import type { Page } from "playwright";
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK } from "@haibun/core/lib/domains/util.js";
import { DOMAIN_PAGE_LOCATOR } from "@haibun/web-playwright/domains.js";
import { SHU_TEST_IDS } from "../domains/test-ids.js";
import { thumbAcrossScroll, thumbPressReaches, type TThumbReading } from "./pipelines/page-reads.js";
import { controlled } from "./root.js";

/** Where the thumb is measured, as a fraction of the host's scrollable length. The ends are included because a thumb
 *  clamped at a rail end is where an off-by-one in the travel shows. */
const SAMPLES = [0, 0.25, 0.5, 0.75, 1];
/** How many frames in a row the thumb's box stays the same after a scroll before it is read. The virtualizer measures the
 *  rows it renders and the rail renders again in the frames after a scroll, and the box stays the same once both end. */
const STEADY_FRAMES = 3;
/** The most frames a reading waits for the thumb to stay the same. */
const SETTLE_FRAMES = 120;
/** A thumb whose height varies by more than this across a scroll is resizing as the content passes. Some drift is
 *  approximate: a virtualizer refines its total-height estimate as rows are measured, so the bar is the CONTENT swing
 *  (a screen of prose against a screen of images differs manyfold), not estimate noise. */
const STEADY_SPREAD = (maxPx: number) => Math.max(4, Math.round(0.25 * maxPx));
const THUMB_ID = SHU_TEST_IDS.SCROLLBAR.THUMB;
/** How a rail's thumb is read across a scroll. */
const READING: TThumbReading = { samples: SAMPLES, steadyFrames: STEADY_FRAMES, settleFrames: SETTLE_FRAMES };

export default class ShuScrollbarControls extends AStepper {
	description = "Scroll rail controls: measure the rendered thumb of any view that hosts a rail.";

	/** The page this control drives. */
	private page(): Promise<Page> {
		return controlled(this).page();
	}

	steps = {
		railThumbTakesAPress: {
			// The thumb is what a reader grabs to drag, so a press aimed at its middle has to reach it. Every marked event
			// is drawn on the same rail, and a mark over the thumb would take that press and jump to itself,
			// leaving the thumb ungrabbable on exactly the runs that hold the most to read. A test outside a browser
			// can't detect this: it is a question of what paints over what.
			gwta: `rail thumb in {host: ${DOMAIN_PAGE_LOCATOR}} takes a press`,
			action: async ({ host }: { host: string }) => {
				const at = await thumbPressReaches(await this.page(), host);
				if (at === null) return actionNotOK(`${host} doesn't hold a scroll rail thumb to press`);
				return at === THUMB_ID ? actionOK() : actionNotOK(`a press at the middle of the rail thumb in ${host} reaches the ${at}, so the thumb cannot be grabbed to drag it`);
			},
		},
		railThumbHoldsSize: {
			// The thumb states how much of the column is on screen, so it must not resize as the reader scrolls past
			// content of differing heights: a run document holds both a line of prose and a screenshot. It must also
			// travel, or a steady thumb would pass by being stuck.
			gwta: `rail thumb in {host: ${DOMAIN_PAGE_LOCATOR}} holds its size and travels while scrolling`,
			action: async ({ host }: { host: string }) => {
				const readings = await thumbAcrossScroll(await this.page(), host, READING);
				if (readings.length < SAMPLES.length) return actionNotOK(`${host} doesn't hold a scroll rail with anything to scroll`);
				const heights = readings.map((r) => r.heightPx);
				const spread = Math.max(...heights) - Math.min(...heights);
				const allowed = STEADY_SPREAD(Math.max(...heights));
				if (spread > allowed)
					return actionNotOK(
						`rail thumb in ${host} resizes as the reader scrolls: heights ${JSON.stringify(heights)} spread ${spread}px, over the ${allowed}px an estimate settling explains`,
					);
				const tops = readings.map((r) => r.topPx);
				if (Math.max(...tops) - Math.min(...tops) <= 0) return actionNotOK(`rail thumb in ${host} never moved: tops ${JSON.stringify(tops)}: the rail is not tracking the scroll`);
				return actionOK();
			},
		},
	} as const satisfies TStepperSteps;
}
