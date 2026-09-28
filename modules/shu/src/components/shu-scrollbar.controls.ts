/**
 * Control steps for the scroll rail, kept beside the element (the polymorphic view's controls pattern). The rail is shared:
 * every virtualized column hosts one (shu-virtual-column) and so does the annotated body, in its own pixel space. These
 * steps therefore take the HOST as an argument and find its rail, so one step covers every view that has one rather
 * than each view growing its own copy.
 *
 * They measure the RENDERED thumb, its box on screen, not a computed value, because what a reader complains about is
 * the thumb they see.
 *
 * Steps never lead with the article "the", haibun treats such lines as narrative prose, not matchable steps.
 */
import type { Locator, Page } from "playwright";
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK } from "@haibun/core/lib/util/index.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { DOMAIN_PAGE_LOCATOR } from "@haibun/web-playwright/domains.js";
import { INPUT_EVENT, NO_ELEMENT, controlledPage } from "./controls-util.js";
import { SHU_TAG } from "../consts.js";

/** Where the thumb is measured, as a fraction of the host's scrollable length. The ends are included because a thumb
 *  clamped at a rail end is where an off-by-one in the travel shows. */
const SAMPLES = [0, 0.25, 0.5, 0.75, 1];
/** Settling time after each scroll: past the virtualizer's own measuring pass and the rail's re-render. */
const SETTLE_MS = 300;
/** A thumb whose height varies by more than this across a scroll is resizing as the content goes by. Some drift is
 *  approximate: a virtualizer refines its total-height estimate as rows are measured, so the bar is the CONTENT swing
 *  (a screen of prose against a screen of images differs manyfold), not estimate noise. */
const STEADY_SPREAD = (maxPx: number) => Math.max(4, Math.round(0.25 * maxPx));
const THUMB_ID = SHU_TEST_IDS.SCROLLBAR.THUMB;

/** One reading of the rendered thumb. */
type TThumb = { heightPx: number; topPx: number };

export default class ShuScrollbarControls extends AStepper {
	description = "Scroll rail controls: measure the rendered thumb of any view that hosts a rail.";

	/** The rail `host` holds. */
	private async rail(host: string): Promise<Locator> {
		return (await controlledPage(this)).locator(`${host} ${SHU_TAG.SCROLLBAR}`).first();
	}

	/** Scroll `host`'s rail through the sample points, reading the rendered thumb at each. Empty when the host, its rail
	 *  or anything to scroll is absent, which the caller reports as a miss rather than a pass. */
	private async thumbAcrossScroll(page: Page, host: string): Promise<TThumb[]> {
		const thumb = (await this.rail(host)).getByTestId(THUMB_ID);
		if ((await thumb.count()) === 0) return [];
		const handle = await thumb.elementHandle();
		// The scrolling region driving the rail: whichever element under the host has the most to scroll.
		return page
			.locator(host)
			.first()
			.locator("*")
			.evaluateAll(
				async (els, arg) => {
					const scroller = (els as HTMLElement[]).reduce<HTMLElement | null>(
						(most, el) => (el.scrollHeight - el.clientHeight > (most ? most.scrollHeight - most.clientHeight : 0) ? el : most),
						null,
					);
					if (!scroller || !arg.thumb) return [];
					const over = scroller.scrollHeight - scroller.clientHeight;
					const scrollTo = async (at: number) => {
						// A reader's scroll starts with input, and the wheel event is that signal: it pauses the live-edge
						// follow exactly as it does for a person, so the follow cannot reclaim the pane before the reading.
						scroller.dispatchEvent(new WheelEvent(arg.wheel, { bubbles: true, composed: true }));
						scroller.scrollTop = over * at;
						await new Promise((r) => setTimeout(r, arg.settleMs));
					};
					// A first pass lets the virtualizer measure the rows at each position, so the readings compare the thumb
					// across content rather than across an estimate still refining itself.
					for (const at of arg.samples) await scrollTo(at);
					const readings: TThumb[] = [];
					for (const at of arg.samples) {
						await scrollTo(at);
						const box = arg.thumb.getBoundingClientRect();
						readings.push({ heightPx: Math.round(box.height), topPx: Math.round(box.top) });
					}
					return readings;
				},
				{ thumb: handle, samples: SAMPLES, settleMs: SETTLE_MS, wheel: INPUT_EVENT.wheel },
			);
	}

	/** What a press at the middle of the host's rail thumb reaches: the thumb's own test id when it can be grabbed,
	 *  otherwise whatever covers it, or null where the host doesn't hold a rail thumb. Read inside the rail's shadow root, which
	 *  is where both are drawn. */
	private async thumbPressReaches(host: string): Promise<string | null> {
		const rail = await this.rail(host);
		if ((await rail.getByTestId(THUMB_ID).count()) === 0) return null;
		return rail.evaluate(
			(el, a) => {
				const box = el.shadowRoot?.querySelector(`[data-testid="${a.thumbId}"]`)?.getBoundingClientRect();
				if (!box) return null;
				const at = el.shadowRoot?.elementFromPoint(Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2));
				return at?.getAttribute("data-testid") ?? String(at?.tagName ?? a.empty).toLowerCase();
			},
			{ thumbId: THUMB_ID, empty: NO_ELEMENT },
		);
	}

	steps = {
		railThumbTakesAPress: {
			// The thumb is what a reader grabs to drag, so a press aimed at its middle has to reach it. Every marked event
			// is drawn on the same rail, and a mark over the thumb would take that press and jump to itself,
			// leaving the thumb ungrabbable on exactly the runs with the most to look through. A test outside a browser
			// can't detect this: it is a question of what paints over what.
			gwta: `rail thumb in {host: ${DOMAIN_PAGE_LOCATOR}} takes a press`,
			action: async ({ host }: { host: string }) => {
				const at = await this.thumbPressReaches(host);
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
				const readings = await this.thumbAcrossScroll(await controlledPage(this), host);
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
	} satisfies TStepperSteps;
}
