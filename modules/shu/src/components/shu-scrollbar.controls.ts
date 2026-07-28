/**
 * Control steps for the scroll rail, kept beside the element (the shu-graph-view.controls pattern). The rail is shared:
 * every virtualized column hosts one (shu-virtual-column) and so does the annotated body, in its own pixel space. These
 * steps therefore take the HOST as an argument and find its rail, so one step covers every view that has one rather
 * than each view growing its own copy.
 *
 * They measure the RENDERED thumb — its box on screen, not a computed value — because what a reader complains about is
 * the thumb they see. The page-providing stepper (web-playwright) is found by duck-typing getPage, so shu keeps no
 * dependency on it (mirrors shu-column-strip.controls). Pierces shadow roots to find the host.
 *
 * Steps never lead with the article "the" — haibun treats such lines as narrative prose, not matchable steps.
 */
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK } from "@haibun/core/lib/util/index.js";
import { SHU_TEST_IDS } from "../test-ids.js";

import type { EvalPage } from "./controls-util.js";

/** Where the thumb is measured, as a fraction of the host's scrollable length. The ends are included because a thumb
 *  clamped at a rail end is where an off-by-one in the travel shows. */
const SAMPLES = [0, 0.25, 0.5, 0.75, 1];
/** Settling time after each scroll: past the virtualizer's own measuring pass and the rail's re-render. */
const SETTLE_MS = 300;
/** A thumb whose height varies by more than this across a scroll is resizing as the content goes by. Some drift is
 *  honest — a virtualizer refines its total-height estimate as rows are measured — so the bar is the CONTENT swing
 *  (a screen of prose against a screen of images differs manyfold), not estimate noise. */
const STEADY_SPREAD = (maxPx: number) => Math.max(4, Math.round(0.25 * maxPx));

/** One reading of the rendered thumb. */
type TThumb = { heightPx: number; topPx: number };

export default class ShuScrollbarControls extends AStepper {
	description = "Scroll rail controls: measure the rendered thumb of any view that hosts a rail.";

	private page(): Promise<EvalPage> {
		const wp = this.getWorld().runtime.steppers?.find((s) => typeof (s as { getPage?: unknown }).getPage === "function") as { getPage(): Promise<EvalPage> } | undefined;
		if (!wp) throw new Error("ShuScrollbarControls: no page-providing stepper (web-playwright) in the world");
		return wp.getPage();
	}

	/** Scroll `host`'s rail through the sample points, reading the rendered thumb at each. Empty when the host or its
	 *  rail is absent, which the caller reports as a miss rather than a pass. */
	private async thumbAcrossScroll(page: EvalPage, host: string): Promise<TThumb[]> {
		return await page.evaluate<Promise<TThumb[]>, { host: string; thumbId: string; samples: number[]; settleMs: number }>(
			async (arg: { host: string; thumbId: string; samples: number[]; settleMs: number }) => {
				const deep = (test: (el: Element) => boolean): Element | null => {
					const stack: Array<Document | ShadowRoot> = [document];
					while (stack.length > 0) {
						const root = stack.pop();
						if (!root) break;
						for (const el of Array.from(root.querySelectorAll("*"))) {
							if (test(el)) return el;
							if (el.shadowRoot) stack.push(el.shadowRoot);
						}
					}
					return null;
				};
				// A host keeps its parts in its own shadow root, so a search under it starts from both.
				const rootsOf = (el: Element): Array<Element | ShadowRoot> => (el.shadowRoot ? [el, el.shadowRoot] : [el]);
				const within = (root: Element, test: (el: Element) => boolean): Element | null => {
					const stack: Array<Element | ShadowRoot> = rootsOf(root);
					while (stack.length > 0) {
						const node = stack.pop();
						if (!node) break;
						for (const el of Array.from(node.querySelectorAll("*"))) {
							if (test(el)) return el;
							if (el.shadowRoot) stack.push(el.shadowRoot);
						}
					}
					return null;
				};
				const hostEl = deep((el) => el.tagName.toLowerCase() === arg.host.toLowerCase());
				if (!hostEl) return [];
				const rail = within(hostEl, (el) => el.tagName.toLowerCase() === "shu-scrollbar");
				const thumb = rail?.shadowRoot?.querySelector(`[data-testid="${arg.thumbId}"]`) as HTMLElement | null;
				// The scrolling region driving the rail: whichever element under the host actually has somewhere to scroll.
				let scroller: HTMLElement | null = null;
				let most = 0;
				const stack: Array<Element | ShadowRoot> = rootsOf(hostEl);
				while (stack.length > 0) {
					const node = stack.pop();
					if (!node) break;
					for (const el of Array.from(node.querySelectorAll("*"))) {
						const over = (el as HTMLElement).scrollHeight - (el as HTMLElement).clientHeight;
						if (over > most) (most = over), (scroller = el as HTMLElement);
						if (el.shadowRoot) stack.push(el.shadowRoot);
					}
				}
				if (!thumb || !scroller || most <= 0) return [];
				const readings: TThumb[] = [];
				for (const at of arg.samples) {
					// A reader's scroll starts with input, and the wheel event is that signal: it pauses the live-edge
					// follow exactly as it does for a person, so the follow cannot reclaim the pane before the reading.
					scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true, composed: true }));
					(scroller as HTMLElement).scrollTop = most * at;
					await new Promise((r) => setTimeout(r, arg.settleMs));
					const box = thumb.getBoundingClientRect();
					readings.push({ heightPx: Math.round(box.height), topPx: Math.round(box.top) });
				}
				return readings;
			},
			{ host, thumbId: SHU_TEST_IDS.SCROLLBAR.THUMB, samples: SAMPLES, settleMs: SETTLE_MS },
		);
	}

	steps = {
		railThumbHoldsSize: {
			// The thumb states how much of the column is on screen, so it must not resize as the reader scrolls past
			// content of differing heights — a run document holds both a line of prose and a screenshot. It must also
			// actually travel, or a steady thumb would pass by simply being stuck.
			gwta: "rail thumb in {host} holds its size and travels while scrolling",
			action: async ({ host }: { host: string }) => {
				const readings = await this.thumbAcrossScroll(await this.page(), host);
				if (readings.length < SAMPLES.length) return actionNotOK(`no scroll rail found in ${host} with anything to scroll`);
				const heights = readings.map((r) => r.heightPx);
				const spread = Math.max(...heights) - Math.min(...heights);
				const allowed = STEADY_SPREAD(Math.max(...heights));
				if (spread > allowed) return actionNotOK(`rail thumb in ${host} resizes as the reader scrolls: heights ${JSON.stringify(heights)} spread ${spread}px, over the ${allowed}px an estimate settling explains`);
				const tops = readings.map((r) => r.topPx);
				if (Math.max(...tops) - Math.min(...tops) <= 0) return actionNotOK(`rail thumb in ${host} never moved: tops ${JSON.stringify(tops)} — the rail is not tracking the scroll`);
				return actionOK();
			},
		},
	} satisfies TStepperSteps;
}
