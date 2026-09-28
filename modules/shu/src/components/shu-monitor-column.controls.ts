/**
 * Inspection steps for shu-monitor-column, kept beside the element (the polymorphic view's controls pattern). Counts the
 * rendered log rows so a feature can assert the monitor VIRTUALIZES: the DOM holds only the rows in view (plus the
 * virtualizer's small overscan), not every buffered event, however long the run is. Waits, since the backfill and
 * re-render land asynchronously.
 *
 * Steps never lead with the article "the", haibun treats such lines as narrative prose, not matchable steps.
 */
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK } from "@haibun/core/lib/util/index.js";
import { DOMAIN_NUMBER, DOMAIN_TEXT, createEnumDomainDefinition } from "@haibun/core/lib/domains.js";
import type { Locator, Page } from "playwright";
import { INPUT_EVENT, STATE_MS, comesToHold, controlledPage, findsAtLeast, pollUntil } from "./controls-util.js";
import { FOLLOW_EDGE_SLACK_PX } from "../controllers/index.js";
import { SHU_TAG } from "../consts.js";
import { SHU_TEST_IDS } from "../test-ids.js";

/** What a thumbnail is: a tile of the column's grid, never the natural-size shrink-wrap and never the whole column. */
const MIN_TILE_PX = 140;
const MAX_TILE_PX = 450;

const MONITOR_ROW = `[data-testid="${SHU_TEST_IDS.MONITOR.LOG_ROW}"]`;
const MONITOR_COUNT = `[data-testid="${SHU_TEST_IDS.MONITOR.LOG_STREAM}"] .count`;
const VIRTUALIZER = "lit-virtualizer";
const SRC = "src";
const DOC_ROW = ".doc-row";
const THUMB_FRAME = `${SHU_TAG.ARTIFACT_FRAME}.thumb`;
const EXPANDED_FRAME = `${SHU_TAG.ARTIFACT_FRAME}.fullscreen`;
const THUMB_IMAGE = `${THUMB_FRAME} img`;
const EXPANDED_IMAGE = `${EXPANDED_FRAME} img`;
const FUTURE = "future-event"; // the dim class shared by monitor rows and document blocks past the time cursor
// The follow's own contract for "at the live edge": the assertion holds the component to the slack it re-sticks past.
const DOC_LIVE_EDGE_PX = FOLLOW_EDGE_SLACK_PX;

/** The ends of the monitor's scroll rail a seek goes to. */
export const RAIL_END = { top: "top", bottom: "bottom" } as const;
const DOMAIN_RAIL_END = "rail-end";

export default class ShuMonitorColumnControls extends AStepper implements IHasCycles {
	description = "shu-monitor-column inspection: count rendered log rows to assert the data window bounds the view.";
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [createEnumDomainDefinition({ name: DOMAIN_RAIL_END, values: Object.values(RAIL_END), description: "An end of the monitor's scroll rail" })],
		}),
	};

	private page(): Promise<Page> {
		return controlledPage(this);
	}

	/** The run's document column. */
	private document(page: Page) {
		return page.locator(SHU_TAG.DOCUMENT_COLUMN).first();
	}

	/** The monitor's scroll rail. */
	private rail(page: Page): Locator {
		return page.locator(`${SHU_TAG.MONITOR_COLUMN} ${SHU_TAG.SCROLLBAR}`).first();
	}

	/** The first visible row the monitor's rail states. */
	private firstRowStated(page: Page): Locator {
		return this.rail(page).getByTestId(SHU_TEST_IDS.SCROLLBAR.POS_TOP);
	}

	/** Whether the first visible row the rail states comes to satisfy `test` of its ordinal text. */
	private firstVisibleRow(page: Page, test: (on: { el: HTMLElement; arg: string }) => boolean, ordinal: number): Promise<boolean> {
		return comesToHold(this.firstRowStated(page), test, String(ordinal), STATE_MS);
	}

	steps = {
		monitorShowsMoreThan: {
			gwta: `monitor shows more than {min: ${DOMAIN_NUMBER}} rows`,
			action: async ({ min }: { min: number }) => {
				const rows = (await this.page()).locator(MONITOR_ROW);
				return (await findsAtLeast(rows, min + 1)) ? actionOK() : actionNotOK(`monitor shows ${await rows.count()} rows, expected more than ${min}`);
			},
		},
		monitorShowsExactly: {
			gwta: `monitor shows exactly {count: ${DOMAIN_NUMBER}} rows`,
			action: async ({ count }: { count: number }) => {
				const page = await this.page();
				const rows = page.locator(MONITOR_ROW);
				const n = await pollUntil(
					page,
					() => rows.count(),
					(c) => c === count,
				);
				return n === count ? actionOK() : actionNotOK(`monitor shows ${n} rows, expected exactly ${count}`);
			},
		},
		seekMonitorRail: {
			// A pointerdown on the custom rail at its top or bottom, the way a click-to-seek does, so a feature can prove the
			// rail scrolls the virtualizer (a holey placeholder items array once made every seek a silent no-op).
			gwta: `seek the monitor rail to the {where: ${DOMAIN_RAIL_END}}`,
			action: async ({ where }: { where: string }) => {
				const rail = this.rail(await this.page()).getByTestId(SHU_TEST_IDS.SCROLLBAR.RAIL);
				const box = await rail.boundingBox();
				if (!box) return actionNotOK("the page doesn't show a scroll rail to seek");
				const clientY = where === RAIL_END.top ? box.y + 3 : box.y + box.height - 3;
				await rail.dispatchEvent(INPUT_EVENT.pointerdown, { bubbles: true, cancelable: true, clientX: box.x + 7, clientY, pointerId: 1 });
				return actionOK();
			},
		},
		monitorFirstVisibleRow: {
			gwta: `monitor first visible row reads {ordinal: ${DOMAIN_NUMBER}}`,
			action: async ({ ordinal }: { ordinal: number }) => {
				const page = await this.page();
				if (await this.firstVisibleRow(page, ({ el, arg }) => el.textContent?.trim() === arg, ordinal)) return actionOK();
				return actionNotOK(`monitor rail shows first visible row ${(await this.firstRowStated(page).textContent())?.trim()}, expected ${ordinal}`);
			},
		},
		monitorFirstVisibleRowIsNot: {
			gwta: `monitor first visible row does not read {ordinal: ${DOMAIN_NUMBER}}`,
			action: async ({ ordinal }: { ordinal: number }) => {
				const page = await this.page();
				if (await this.firstVisibleRow(page, ({ el, arg }) => !!el.textContent?.trim() && el.textContent.trim() !== arg, ordinal)) return actionOK();
				return actionNotOK(`monitor rail still shows first visible row ${ordinal}; the seek did not move the window`);
			},
		},
		documentThumbnailsFlow: {
			// Measure the run's REAL screenshot thumbnails (frames the document built from its own artifact events, images
			// served from /artifacts): every frame sits in a .thumb-row grid, sized as a TILE (a track's width, never the tiny
			// natural-size shrink-wrap and never the whole column), and its image loaded and fills the frame.
			gwta: "document thumbnails flow as tiles sized to the column grid",
			action: async () => {
				const page = await this.page();
				const read = () =>
					this.document(page).evaluate(
						(doc, tags) => {
							const root = doc.shadowRoot;
							if (!root) return { frames: [], overlapping: 0, where: [] };
							const frames = (Array.from(root.querySelectorAll(tags.frame)) as HTMLElement[]).map((f) => {
								const img = f.querySelector("img");
								return { w: f.offsetWidth, inRow: f.parentElement?.classList.contains("thumb-row") ?? false, imgLoaded: (img?.naturalWidth ?? 0) > 0, imgW: img?.offsetWidth ?? 0 };
							});
							// A row given a height it does not have paints over the row before it, which is what a strip of screenshots
							// did while every row was estimated. A row is what the virtualizer positions, so the rows are its own
							// children, each carrying a record's identity; the virtualizer's hidden sizing element is a child too.
							const rows = (Array.from(root.querySelector(tags.column)?.querySelector(tags.virtualizer)?.children ?? []) as HTMLElement[])
								.filter((el) => el.hasAttribute("data-id"))
								.map((el) => el.getBoundingClientRect())
								.filter((r) => r.height > 0)
								.sort((a, b) => a.top - b.top);
							const where: string[] = [];
							for (let i = 1; i < rows.length; i++)
								if (rows[i].top < rows[i - 1].bottom - 1)
									where.push(`a row ${Math.round(rows[i].height)}px high over ${Math.round(rows[i - 1].bottom - rows[i].top)}px of the row before it`);
							return { frames, overlapping: where.length, where };
						},
						{ column: SHU_TAG.VIRTUAL_COLUMN, virtualizer: VIRTUALIZER, frame: THUMB_FRAME },
					);
				// A tile is measured once it has been laid out: an image decodes before its frame is placed, so a read taken
				// between the two reports a width the reader never sees. A row grows when its images load, and the virtualizer
				// moves the rows after it once it observes the new height, so a read between the two sees an overlap the reader
				// never sees either. What is asserted below is what the poll waits for.
				const tileSized = (f: { w: number }): boolean => f.w >= MIN_TILE_PX && f.w <= MAX_TILE_PX;
				const v = await pollUntil(page, read, (s) => s.frames.length >= 3 && s.frames.every((f) => f.imgLoaded && tileSized(f)) && s.overlapping === 0, 40, 250);
				const { frames } = v;
				if (frames.length < 3) return actionNotOK(`only ${frames.length} real thumbnails rendered, expected the run's screenshots (the artifact placeholders were not filled)`);
				const offRow = frames.filter((f) => !f.inRow).length;
				if (offRow > 0) return actionNotOK(`${offRow} thumbnails render outside a .thumb-row grid (holders were not extracted into tiles)`);
				if (frames.some((f) => !tileSized(f)))
					return actionNotOK(
						`thumbnails are not tile-sized: ${JSON.stringify(frames.map((f) => f.w))} (a tiny width is the shrink-wrap regression, a huge one is a tile blown up to the column)`,
					);
				const notLoaded = frames.filter((f) => !f.imgLoaded).length;
				if (notLoaded > 0) return actionNotOK(`${notLoaded} thumbnail images failed to load from /artifacts`);
				const notFilling = frames.filter((f) => f.imgW < f.w * 0.9).length;
				if (notFilling > 0) return actionNotOK(`${notFilling} thumbnail images do not fill their tile`);
				if (v.overlapping > 0)
					return actionNotOK(`${v.overlapping} rows of the manual paint over the row before them, so a row was given a height it does not have: ${JSON.stringify(v.where)}`);
				return actionOK();
			},
		},
		expandFirstThumbnail: {
			// Click the document's first thumbnail image. The frame expands fullscreen, captioned with the step its artifact
			// came from: the frame names that step, and the document column captions it from the step's row.
			gwta: "expanding the first thumbnail shows its step caption",
			action: async () => {
				const page = await this.page();
				const thumb = this.document(page).locator(THUMB_IMAGE).first();
				if ((await thumb.count()) === 0) return actionNotOK("the document doesn't show a thumbnail image to click");
				await thumb.dispatchEvent(INPUT_EVENT.click);
				const read = () =>
					this.document(page).evaluate((doc, frame) => {
						const f = doc.shadowRoot?.querySelector(frame);
						const fr = f?.getBoundingClientRect();
						const cr = doc.getBoundingClientRect();
						// The top-most element at the overlay's centre must belong to the expanded frame: inside a virtualized
						// column the rows are stacking contexts, and without the top layer a later row's tiles paint over it.
						let onTop = false;
						if (f && fr) {
							let el: Element | null = null;
							let root: Document | ShadowRoot = document;
							for (;;) {
								const hit: Element | null = root.elementFromPoint(fr.left + fr.width / 2, fr.top + fr.height / 2);
								if (!hit || hit === el) break;
								el = hit;
								if (!el.shadowRoot) break;
								root = el.shadowRoot;
							}
							for (let n: Node | null = el; n; n = n instanceof ShadowRoot ? n.host : n.parentNode)
								if (n === f) {
									onTop = true;
									break;
								}
						}
						return {
							open: !!f,
							stepId: f?.getAttribute("data-step-id") ?? "",
							caption: f?.shadowRoot?.querySelector(".step-caption")?.textContent?.trim() ?? "",
							dLeft: fr ? Math.abs(fr.left - cr.left) : -1,
							widthRatio: fr && cr.width > 0 ? fr.width / cr.width : 0,
							onTop,
						};
					}, EXPANDED_FRAME);
				const v = await pollUntil(page, read, (s) => s.open && s.caption.length > 0, 20, 150);
				if (!v.open) return actionNotOK("clicking the thumbnail did not expand it fullscreen");
				if (!v.caption) return actionNotOK(`the expanded thumbnail doesn't show a step caption: the document doesn't hold the row of step "${v.stepId}", which it names`);
				// The overlay must take the WHOLE column box, from its left edge, inside a virtualizer, fixed-position
				// coordinates resolve against the transformed row, so uncorrected values leave it askew beside the tiles.
				if (v.dLeft > 2 || v.widthRatio < 0.98)
					return actionNotOK(`the expanded thumbnail does not cover the column (left off by ${Math.round(v.dLeft)}px, width ${Math.round(v.widthRatio * 100)}% of the column)`);
				if (!v.onTop)
					return actionNotOK("another element paints over the expanded thumbnail (the overlay is trapped in its virtualizer row's stacking context instead of the top layer)");
				return actionOK();
			},
		},
		expandedThumbnailNavigates: {
			// ←/→ on the expanded thumbnail must reach the run's OTHER screenshots: the document column navigates its block
			// list (a frame cannot see off-window siblings under virtualization). Asserts the expanded image changes.
			gwta: "arrow keys move the expanded thumbnail to the next screenshot",
			action: async () => {
				const page = await this.page();
				const image = this.document(page).locator(EXPANDED_IMAGE).first();
				if ((await image.count()) === 0) return actionNotOK("the document doesn't show an expanded thumbnail to navigate from");
				const before = await image.getAttribute(SRC);
				await page.keyboard.press("ArrowRight");
				const moved = await comesToHold(image, ({ el, arg }) => !!el.getAttribute(arg.src) && el.getAttribute(arg.src) !== arg.before, { src: SRC, before }, STATE_MS);
				if (!moved) return actionNotOK(`ArrowRight did not move to the next screenshot (still showing ${before})`);
				await page.keyboard.press("Escape");
				return actionOK();
			},
		},
		monitorHoldsRows: {
			gwta: `monitor holds at least {n: ${DOMAIN_NUMBER}} rows of the run`,
			action: async ({ n }: { n: number }) => {
				const count = (await this.page()).locator(MONITOR_COUNT).first();
				if (await comesToHold(count, ({ el, arg }) => (Number(el.textContent?.replace(/[^0-9]/g, "")) || 0) >= arg, n, STATE_MS)) return actionOK();
				return actionNotOK(`the monitor holds ${await count.textContent()} rows, expected at least ${n} (what the run recorded did not reach the view)`);
			},
		},
		monitorShowsRowContaining: {
			gwta: `monitor shows a row containing {text: ${DOMAIN_TEXT}}`,
			action: async ({ text }: { text: string }) => {
				const row = (await this.page()).locator(MONITOR_ROW).filter({ hasText: text });
				return (await findsAtLeast(row, 1)) ? actionOK() : actionNotOK(`monitor never rendered a row containing "${text}" (it did not follow the live edge)`);
			},
		},
		documentAtLiveEdge: {
			// The document panel (not just its rail) is scrolled to the live edge: measure the virtualizer's own remaining
			// scroll below the viewport. At the edge this is only the height-estimate overshoot below the last row (tens of px);
			// a follow that stalled short of the newest events leaves the newest hundreds/thousands of px out of view. Reading
			// the real scroller geometry is the ground truth for "did the panel scroll", not whether a block merely
			// rendered in the virtualizer's overscan.
			gwta: "document panel is scrolled to the live edge",
			action: async () => {
				const scroller = this.document(await this.page())
					.locator(VIRTUALIZER)
					.first();
				const atEdge = await comesToHold(scroller, ({ el, arg }) => el.scrollHeight - el.scrollTop - el.clientHeight < arg, DOC_LIVE_EDGE_PX, STATE_MS);
				if (atEdge) return actionOK();
				const above = await scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
				return actionNotOK(
					`document panel is ${Math.round(above)}px above its live edge (the newest events are scrolled out of view: the panel followed its rail but not its content)`,
				);
			},
		},
		scrubMonitorFirstRow: {
			// Click the first monitor row's time (onTimeClick sets the GLOBAL cursor without a local requestUpdate), so this drives
			// the cursor EXTERNALLY, the way the timeline or another view would, isolating whether onTimeSync updates a view.
			gwta: "scrub the cursor from the monitor's first row",
			action: async () => {
				const time = (await this.page()).locator(`${MONITOR_ROW} .time-group`).first();
				if ((await time.count()) === 0) return actionNotOK("the monitor doesn't show a row time to scrub");
				await time.dispatchEvent(INPUT_EVENT.click);
				return actionOK();
			},
		},
		monitorFutureRowsAtLeast: {
			gwta: `monitor dims at least {min: ${DOMAIN_NUMBER}} future rows`,
			action: async ({ min }: { min: number }) => {
				const future = (await this.page()).locator(`${MONITOR_ROW}.${FUTURE}`);
				return (await findsAtLeast(future, min, STATE_MS))
					? actionOK()
					: actionNotOK(`monitor dimmed ${await future.count()} future rows after the external cursor moved, expected at least ${min}`);
			},
		},
		clickFirstDocRow: {
			gwta: "scrub to the first document row",
			action: async () => {
				const row = (await this.page()).locator(DOC_ROW).first();
				if ((await row.count()) === 0) return actionNotOK("the document doesn't show a row to click");
				await row.dispatchEvent(INPUT_EVENT.click);
				return actionOK();
			},
		},
		documentFutureRowsAtLeast: {
			gwta: `document dims at least {min: ${DOMAIN_NUMBER}} future rows`,
			action: async ({ min }: { min: number }) => {
				const future = (await this.page()).locator(`.doc-block.${FUTURE}, ${DOC_ROW}.${FUTURE}`);
				return (await findsAtLeast(future, min, STATE_MS))
					? actionOK()
					: actionNotOK(`document dimmed ${await future.count()} future rows after the cursor moved, expected at least ${min}`);
			},
		},
	} satisfies TStepperSteps;
}
