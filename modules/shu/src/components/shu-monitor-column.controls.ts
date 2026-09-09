/**
 * Inspection steps for shu-monitor-column, kept beside the element (the polymorphic view's controls pattern). Counts the
 * rendered log rows across shadow boundaries so a feature can assert the monitor VIRTUALIZES: the DOM holds only the
 * rows in view (plus the virtualizer's small overscan), not every buffered event, no matter how long the run. Polls,
 * since the backfill and re-render land asynchronously. The page-providing stepper is duck-typed, so shu keeps no
 * dependency on it.
 *
 * Steps never lead with the article "the" — haibun treats such lines as narrative prose, not matchable steps.
 */
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK } from "@haibun/core/lib/util/index.js";

import { type EvalPage, pollUntil, countMatching, firstText, firstAttr, hasText, clickFirst } from "./controls-util.js";
import { FOLLOW_EDGE_SLACK_PX } from "./shu-virtual-column.js";
import { SHU_TAG } from "../consts.js";

// Selectors reused across the assertions, so a markup rename lands in one place.
/** What a thumbnail is: a tile of the column's grid, never the natural-size shrink-wrap and never the whole column. */
const MIN_TILE_PX = 140;
const MAX_TILE_PX = 450;

const MONITOR_ROW = '[data-testid="monitor-log-row"]';
const MONITOR_COUNT = '[data-testid="monitor-log-stream"] .count';
const SCROLLBAR_POS_TOP = '[data-testid="scrollbar-pos-top"]';
const DOC_ROW = ".doc-row";
const FUTURE = "future-event"; // the dim class shared by monitor rows and document blocks past the time cursor
// The follow's own contract for "at the live edge": the assertion holds the component to the slack it re-sticks past.
const DOC_LIVE_EDGE_PX = FOLLOW_EDGE_SLACK_PX;

export default class ShuMonitorColumnControls extends AStepper {
	description = "shu-monitor-column inspection: count rendered log rows to assert the data window bounds the view.";

	private page(): Promise<EvalPage> {
		const wp = this.getWorld().runtime.steppers?.find((s) => typeof (s as { getPage?: unknown }).getPage === "function") as { getPage(): Promise<EvalPage> } | undefined;
		if (!wp) throw new Error("ShuMonitorColumnControls: no page-providing stepper (web-playwright) in the world");
		return wp.getPage();
	}

	private rowCount(page: EvalPage): Promise<number> {
		return countMatching(page, MONITOR_ROW);
	}

	/** Poll `read` until the count settles (two equal, non-zero reads in a row), so a "fewer than" assertion reads the
	 *  stable virtualized count, never a mid-backfill snapshot that happens to be small. */
	/** Dispatch a pointerdown on the custom rail at its top or bottom, the way a click-to-seek does, so a feature can prove
	 *  the rail actually scrolls the virtualizer (a holey placeholder items array once made every seek a silent no-op). */
	private seekRail(page: EvalPage, where: string): Promise<boolean> {
		return page.evaluate((w: string) => {
			let rail: Element | null = null;
			const stack: Array<Document | ShadowRoot> = [document];
			while (stack.length > 0 && !rail) {
				const root = stack.pop();
				if (!root) break;
				const sb = root.querySelector("shu-scrollbar");
				if (sb?.shadowRoot) rail = sb.shadowRoot.querySelector(".rail"); // .rail lives in shu-scrollbar's shadow root
				for (const el of Array.from(root.querySelectorAll("*"))) if (el.shadowRoot) stack.push(el.shadowRoot);
			}
			if (!rail) return false;
			const r = rail.getBoundingClientRect();
			const clientY = w === "top" ? r.top + 3 : r.bottom - 3;
			rail.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: r.left + 7, clientY, pointerId: 1 }));
			return true;
		}, where);
	}

	steps: TStepperSteps = {
		monitorShowsMoreThan: {
			gwta: "monitor shows more than {min} rows",
			action: async ({ min }: { min: string }) => {
				const want = Number(min);
				const n = await pollUntil(
					await this.page(),
					(p) => this.rowCount(p),
					(c) => c > want,
				);
				return n > want ? actionOK() : actionNotOK(`monitor shows ${n} rows, expected more than ${want}`);
			},
		},
		monitorShowsExactly: {
			gwta: "monitor shows exactly {count} rows",
			action: async ({ count }: { count: string }) => {
				const want = Number(count);
				const n = await pollUntil(
					await this.page(),
					(p) => this.rowCount(p),
					(c) => c === want,
				);
				return n === want ? actionOK() : actionNotOK(`monitor shows ${n} rows, expected exactly ${want}`);
			},
		},
		seekMonitorRail: {
			gwta: "seek the monitor rail to the {where}",
			action: async ({ where }: { where: string }) => {
				const ok = await this.seekRail(await this.page(), where);
				return ok ? actionOK() : actionNotOK("no shu-scrollbar rail found to seek");
			},
		},
		monitorFirstVisibleRow: {
			gwta: "monitor first visible row reads {ordinal}",
			action: async ({ ordinal }: { ordinal: string }) => {
				const v = await pollUntil(
					await this.page(),
					(p) => firstText(p, SCROLLBAR_POS_TOP),
					(x) => x === ordinal,
					25,
					100,
				);
				return v === ordinal ? actionOK() : actionNotOK(`monitor rail shows first visible row ${v || "(none)"}, expected ${ordinal}`);
			},
		},
		monitorFirstVisibleRowIsNot: {
			gwta: "monitor first visible row does not read {ordinal}",
			action: async ({ ordinal }: { ordinal: string }) => {
				const v = await pollUntil(
					await this.page(),
					(p) => firstText(p, SCROLLBAR_POS_TOP),
					(x) => x !== "" && x !== ordinal,
					25,
					100,
				);
				return v !== "" && v !== ordinal ? actionOK() : actionNotOK(`monitor rail still shows first visible row ${ordinal}; the seek did not move the window`);
			},
		},
		documentThumbnailsFlow: {
			// Measure the run's REAL screenshot thumbnails (frames the document built from its own artifact events, images
			// served from /artifacts): every frame sits in a .thumb-row grid, sized as a TILE (a track's width, never the tiny
			// natural-size shrink-wrap and never the whole column), and its image actually loaded and fills the frame.
			gwta: "document thumbnails flow as tiles sized to the column grid",
			action: async () => {
				const read = (p: EvalPage) =>
					p.evaluate((docTag: string) => {
						let doc: Element | null = null;
						const stack: Array<Document | ShadowRoot> = [document];
						while (stack.length && !doc) {
							const r = stack.pop();
							if (!r) break;
							doc = r.querySelector(docTag);
							for (const e of Array.from(r.querySelectorAll("*"))) if (e.shadowRoot) stack.push(e.shadowRoot);
						}
						const root = doc?.shadowRoot;
						if (!root) return { frames: [] as Array<{ w: number; inRow: boolean; imgLoaded: boolean; imgW: number }>, overlapping: 0 };
						const frames = (Array.from(root.querySelectorAll("shu-artifact-frame.thumb")) as HTMLElement[]).map((f) => {
							const img = f.querySelector("img") as HTMLImageElement | null;
							return { w: f.offsetWidth, inRow: f.parentElement?.classList.contains("thumb-row") ?? false, imgLoaded: (img?.naturalWidth ?? 0) > 0, imgW: img?.offsetWidth ?? 0 };
						});
						// A row given a height it does not have paints over the row before it, which is what a strip of
						// screenshots did while every row was estimated. A row is what the virtualizer positions, so the
						// rows are its own children; the blocks within one row lie side by side and are not compared.
						const virtualizer = root.querySelector("shu-virtual-column")?.querySelector("lit-virtualizer");
						// A row is a child the virtualizer positions and that carries a record's identity; the virtualizer's own
						// hidden sizing element is a child too, and it is not a row.
						const rows = (Array.from(virtualizer?.children ?? []) as HTMLElement[]).filter((el) => el.hasAttribute("data-id")).map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0);
						const ordered = rows.sort((a, b) => a.top - b.top);
						let overlapping = 0;
						const where: string[] = [];
						for (let i = 1; i < ordered.length; i++)
							if (ordered[i].top < ordered[i - 1].bottom - 1) {
								overlapping++;
								where.push(`a row ${Math.round(ordered[i].height)}px high over ${Math.round(ordered[i - 1].bottom - ordered[i].top)}px of the row before it`);
							}
						return { frames, overlapping, where };
					}, SHU_TAG.DOCUMENT_COLUMN);
				// A tile is measured once it has been laid out: an image decodes before its frame is placed, so a read taken
				// between the two reports a width the reader never sees. What is asserted below is what the poll waits for.
				const tileSized = (f: { w: number }): boolean => f.w >= MIN_TILE_PX && f.w <= MAX_TILE_PX;
				const v = await pollUntil(await this.page(), read, (s) => s.frames.length >= 3 && s.frames.every((f) => f.imgLoaded && tileSized(f)), 40, 250);
				const { frames } = v;
				if (frames.length < 3) return actionNotOK(`only ${frames.length} real thumbnails rendered, expected the run's screenshots (the artifact placeholders were not filled)`);
				const offRow = frames.filter((f) => !f.inRow).length;
				if (offRow > 0) return actionNotOK(`${offRow} thumbnails render outside a .thumb-row grid (holders were not extracted into tiles)`);
				const badSize = frames.filter((f) => !tileSized(f));
				if (badSize.length > 0)
					return actionNotOK(
						`thumbnails are not tile-sized: ${JSON.stringify(frames.map((f) => f.w))} (a tiny width is the shrink-wrap regression, a huge one is a tile blown up to the column)`,
					);
				const notLoaded = frames.filter((f) => !f.imgLoaded).length;
				if (notLoaded > 0) return actionNotOK(`${notLoaded} thumbnail images failed to load from /artifacts`);
				const notFilling = frames.filter((f) => f.imgW < f.w * 0.9).length;
				if (notFilling > 0) return actionNotOK(`${notFilling} thumbnail images do not fill their tile`);
				if ((v.overlapping ?? 0) > 0) return actionNotOK(`${v.overlapping} rows of the manual paint over the row before them, so a row was given a height it does not have: ${JSON.stringify((v as {where?: string[]}).where)}`);
				return actionOK();
			},
		},
		expandFirstThumbnail: {
			// Click the first real thumbnail's image: the frame expands fullscreen and shows the stamped step caption — the
			// caption and the cursor scrub both ride the build-time data-step-label/id stamp, not DOM sibling walking (which
			// virtualization broke).
			gwta: "expanding the first thumbnail shows its step caption",
			action: async () => {
				if (!(await clickFirst(await this.page(), "shu-artifact-frame.thumb img"))) return actionNotOK("no rendered thumbnail image to click");
				const read = (p: EvalPage) =>
					p.evaluate((docTag: string) => {
						let doc: Element | null = null;
						const stack: Array<Document | ShadowRoot> = [document];
						while (stack.length && !doc) {
							const rr = stack.pop();
							if (!rr) break;
							doc = rr.querySelector(docTag);
							for (const e of Array.from(rr.querySelectorAll("*"))) if (e.shadowRoot) stack.push(e.shadowRoot);
						}
						const f = doc?.shadowRoot?.querySelector("shu-artifact-frame.fullscreen");
						const fr = f?.getBoundingClientRect();
						const cr = doc?.getBoundingClientRect();
						// The top-most element at the overlay's centre must belong to the expanded frame — inside a virtualized
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
							caption: f?.shadowRoot?.querySelector(".step-caption")?.textContent?.trim() ?? "",
							dLeft: fr && cr ? Math.abs(fr.left - cr.left) : -1,
							widthRatio: fr && cr && cr.width > 0 ? fr.width / cr.width : 0,
							onTop,
						};
					}, SHU_TAG.DOCUMENT_COLUMN);
				const v = await pollUntil(await this.page(), read, (s) => s.open && s.caption.length > 0, 20, 150);
				if (!v.open) return actionNotOK("clicking the thumbnail did not expand it fullscreen");
				if (!v.caption) return actionNotOK("the expanded thumbnail shows no step caption (the data-step-label stamp is missing)");
				// The overlay must take the WHOLE column box, from its left edge — inside a virtualizer, fixed-position
				// coordinates resolve against the transformed row, so uncorrected values leave it askew beside the tiles.
				if (v.dLeft > 2 || v.widthRatio < 0.98)
					return actionNotOK(`the expanded thumbnail does not cover the column (left off by ${Math.round(v.dLeft)}px, width ${Math.round(v.widthRatio * 100)}% of the column)`);
				if (!v.onTop)
					return actionNotOK("another element paints over the expanded thumbnail (the overlay is trapped in its virtualizer row's stacking context instead of the top layer)");
				return actionOK();
			},
		},
		expandedThumbnailNavigates: {
			// ←/→ on the expanded thumbnail must reach the run's OTHER screenshots — the document column navigates its block
			// list (a frame cannot see off-window siblings under virtualization). Asserts the expanded image actually changes.
			gwta: "arrow keys move the expanded thumbnail to the next screenshot",
			action: async () => {
				const srcOf = (p: EvalPage) => firstAttr(p, "shu-artifact-frame.fullscreen img", "src");
				const page = await this.page();
				const before = await srcOf(page);
				if (!before) return actionNotOK("no expanded thumbnail to navigate from");
				await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true })));
				const after = await pollUntil(page, srcOf, (s) => s !== "" && s !== before, 30, 200);
				if (after === "" || after === before) return actionNotOK(`ArrowRight did not move to the next screenshot (still showing ${before})`);
				await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })));
				return actionOK();
			},
		},
		monitorHoldsRows: {
			gwta: "monitor holds at least {n} rows of the run",
			action: async ({ n }: { n: string }) => {
				const want = Number(n);
				const read = (p: EvalPage) => firstText(p, MONITOR_COUNT).then((t) => Number(t.replace(/[^0-9]/g, "")) || 0);
				const v = await pollUntil(await this.page(), read, (x) => x >= want);
				return v >= want ? actionOK() : actionNotOK(`the monitor holds ${v} rows, expected at least ${want} (what the run recorded did not reach the view)`);
			},
		},
		monitorShowsRowContaining: {
			gwta: "monitor shows a row containing {text}",
			action: async ({ text }: { text: string }) => {
				const found = await pollUntil(
					await this.page(),
					(p) => hasText(p, MONITOR_ROW, text),
					(ok) => ok,
				);
				return found ? actionOK() : actionNotOK(`monitor never rendered a row containing "${text}" (it did not follow the live edge)`);
			},
		},
		documentAtLiveEdge: {
			// The document panel (not just its rail) is scrolled to the live edge: measure the virtualizer's own remaining
			// scroll below the viewport. At the edge this is only the height-estimate overshoot below the last row (tens of px);
			// a follow that stalled short of the newest events leaves the newest hundreds/thousands of px out of view. Reading
			// the real scroller geometry is the ground truth for "did the panel actually scroll", not whether a block merely
			// rendered in the virtualizer's overscan.
			gwta: "document panel is scrolled to the live edge",
			action: async () => {
				const read = async (p: EvalPage): Promise<number> =>
					p.evaluate((docTag: string) => {
						let doc: Element | null = null;
						const stack: Array<Document | ShadowRoot> = [document];
						while (stack.length && !doc) {
							const r = stack.pop();
							if (!r) break;
							doc = r.querySelector(docTag);
							for (const e of Array.from(r.querySelectorAll("*"))) if (e.shadowRoot) stack.push(e.shadowRoot);
						}
						const virt = doc?.shadowRoot?.querySelector("lit-virtualizer") as HTMLElement | null;
						return virt ? virt.scrollHeight - virt.scrollTop - virt.clientHeight : Number.POSITIVE_INFINITY;
					}, SHU_TAG.DOCUMENT_COLUMN);
				const dist = await pollUntil(await this.page(), read, (d) => d < DOC_LIVE_EDGE_PX, 25, 200);
				return dist < DOC_LIVE_EDGE_PX
					? actionOK()
					: actionNotOK(
							`document panel is ${Math.round(dist)}px above its live edge (the newest events are scrolled out of view — the panel followed its rail but not its content)`,
						);
			},
		},
		scrubMonitorFirstRow: {
			// Click the first monitor row's time (onTimeClick sets the GLOBAL cursor with no local requestUpdate), so this drives
			// the cursor EXTERNALLY — the way the timeline or another view would — isolating whether onTimeSync updates a view.
			gwta: "scrub the cursor from the monitor's first row",
			action: async () => {
				const ok = await clickFirst(await this.page(), `${MONITOR_ROW} .time-group`);
				return ok ? actionOK() : actionNotOK("no monitor row time to scrub");
			},
		},
		monitorFutureRowsAtLeast: {
			gwta: "monitor dims at least {min} future rows",
			action: async ({ min }: { min: string }) => {
				const want = Number(min);
				const read = (p: EvalPage) => countMatching(p, `${MONITOR_ROW}.${FUTURE}`);
				const n = await pollUntil(await this.page(), read, (x) => x >= want, 20, 150);
				return n >= want ? actionOK() : actionNotOK(`monitor dimmed ${n} future rows after the external cursor moved, expected at least ${want}`);
			},
		},
		clickFirstDocRow: {
			gwta: "scrub to the first document row",
			action: async () => {
				const ok = await clickFirst(await this.page(), DOC_ROW);
				return ok ? actionOK() : actionNotOK("no .doc-row to click");
			},
		},
		documentFutureRowsAtLeast: {
			gwta: "document dims at least {min} future rows",
			action: async ({ min }: { min: string }) => {
				const want = Number(min);
				const read = (p: EvalPage) => countMatching(p, `.doc-block.${FUTURE}, ${DOC_ROW}.${FUTURE}`);
				const n = await pollUntil(await this.page(), read, (x) => x >= want, 20, 150);
				return n >= want ? actionOK() : actionNotOK(`document dimmed ${n} future rows after the cursor moved, expected at least ${want}`);
			},
		},
	};
}
