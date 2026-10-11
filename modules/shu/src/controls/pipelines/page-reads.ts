/**
 * What a control reads of the page, and the waits it takes on it. Playwright's locators reach into shadow roots, so a read
 * finds an element by its selector and doesn't walk roots. A function a read runs in the page takes only its element and
 * an argument, since the page runs it apart from this module.
 */
import type { Locator, Page } from "playwright";
import { SHU_TAG } from "../../domains/elements.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { INPUT_EVENT, NO_ELEMENT } from "../domains/waits.js";
import { objectId } from "../../page/derivations/record-fields.js";

/** A fraction as a percentage to `digits` places, for a refusal to state. */
export const percent = (fraction: number, digits: number): string => `${(fraction * 100).toFixed(digits)}%`;

/** Reads `read` until it satisfies `ok`, as a render or a backfill arrives, up to `tries` reads `ms` apart, and returns the last value read. */
export async function pollUntil<T>(page: Page, read: () => Promise<T>, ok: (v: T) => boolean, tries: number, ms: number): Promise<T> {
	let v = await read();
	for (let i = 1; i < tries && !ok(v); i++) {
		await page.waitForTimeout(ms);
		v = await read();
	}
	return v;
}

/** Whether an error is Playwright's timeout, which a bounded wait reads as the page not reaching the state it awaited. */
const isTimeout = (e: unknown): boolean => e instanceof Error && e.name === "TimeoutError";

/**
 * Whether `test` comes to hold of the element `locator` finds within `timeout`, running it in the page on each frame. An
 * error other than the timeout, such as one the test throws, is thrown.
 */
export async function comesToHold<E extends HTMLElement, A>(locator: Locator, test: (on: { el: E; arg: A }) => boolean, arg: A, timeout: number): Promise<boolean> {
	const el = await locator.evaluateHandle((found: E) => found);
	// The page receives the handle as the element it names, which Playwright's types can't state for a generic element.
	return locator
		.page()
		.waitForFunction(test as (on: unknown) => boolean, { el, arg } as unknown, { timeout })
		.then(
			() => true,
			(e: unknown) => {
				if (isTimeout(e)) return false;
				throw e;
			},
		);
}

/** Waits until `test` holds of the element `locator` finds. A wait that times out is refused naming `state`, so a failure
 *  names which of a step's waits the page didn't reach. */
export async function until<E extends HTMLElement, A>(locator: Locator, state: string, test: (on: { el: E; arg: A }) => boolean, arg: A, timeout: number): Promise<void> {
	if (!(await comesToHold(locator, test, arg, timeout))) throw new Error(`waited ${timeout}ms for ${state}, and the page didn't reach it`);
}

/** Waits until `locator` finds an element in the page, shown or not. */
export const attached = (locator: Locator, timeout: number): Promise<void> => locator.waitFor({ state: "attached", timeout });

/** Whether `locator` comes to find at least `count` elements within `timeout`. */
export function findsAtLeast(locator: Locator, count: number, timeout: number): Promise<boolean> {
	return attached(locator.nth(count - 1), timeout).then(
		() => true,
		() => false,
	);
}

/** The actions bar's history. */
export const historyOf = (page: Page): Locator => page.locator(SHU_TAG.ACTIVITY_HISTORY).first();

/** How many pixels above its newest turn the history is scrolled. */
export const historyShortOfNewest = (history: Locator): Promise<number> => history.evaluate((el) => el.scrollHeight - (el.scrollTop + el.clientHeight));

/** Scrolls the history to its first turn as a reader does, with the wheel event that pauses the follow. Returns true, or
 *  why the history didn't scroll. */
export const scrollHistoryToStart = (history: Locator): Promise<true | string> =>
	history.evaluate((el, wheel) => {
		if (el.scrollHeight <= el.clientHeight) return `the history holds one screen: ${el.scrollHeight} of ${el.clientHeight}`;
		el.dispatchEvent(new WheelEvent(wheel, { deltaY: -100, bubbles: true }));
		el.scrollTop = 0;
		return el.scrollTop === 0 ? true : "the history didn't scroll";
	}, INPUT_EVENT.wheel);

/** The panes whose column key holds `match`, and are active where `active` states it. */
export const panesMatching = (page: Page, match: string, active: boolean): Locator =>
	page.locator(`${SHU_TAG.COLUMN_PANE}${active ? "[active]" : ""}[data-column-key*=${JSON.stringify(match)}]`);

/** Every pane's column key, the active one marked, for a refusal to state. */
export const columnKeys = (page: Page): Promise<string[]> =>
	page.locator(SHU_TAG.COLUMN_PANE).evaluateAll((panes) => panes.map((p) => `${(p as HTMLElement).dataset.columnKey}${p.hasAttribute("active") ? " (active)" : ""}`));

/** How an element scrolls: its overflow, and the width of a native scrollbar's gutter. */
export const scrollingOf = (region: Locator): Promise<{ overflowY: string; gutter: number }> =>
	region.evaluate((el: HTMLElement) => ({ overflowY: getComputedStyle(el).overflowY, gutter: el.offsetWidth - el.clientWidth }));

/** The monitor's scroll rail. */
export const monitorRail = (page: Page): Locator => page.locator(`${SHU_TAG.MONITOR_COLUMN} ${SHU_TAG.SCROLLBAR}`).first();

/** Actuality's document column. */
export const documentOf = (page: Page): Locator => page.locator(SHU_TAG.DOCUMENT_COLUMN).first();

/** A thumbnail frame of the document: its width, whether it is in a tile row, and its image's load and width. */
export type TThumbnailFrame = { w: number; inRow: boolean; imgLoaded: boolean; imgW: number };
/** The document's thumbnail frames, and the rows of the document that paint over the row before them. */
export type TThumbnails = { frames: TThumbnailFrame[]; overlapping: number; where: string[] };

/**
 * The document's thumbnails, and each row that paints over the row before it. A row is what the virtualizer positions, so
 * the rows are its own children that carry a record's identity; the virtualizer's sizing element is a child too.
 */
export const documentThumbnails = (page: Page, tags: { column: string; virtualizer: string; frame: string }): Promise<TThumbnails> =>
	documentOf(page).evaluate((doc, on) => {
		const root = doc.shadowRoot;
		if (!root) return { frames: [], overlapping: 0, where: [] };
		const frames = (Array.from(root.querySelectorAll(on.frame)) as HTMLElement[]).map((f) => {
			const img = f.querySelector("img");
			return {
				w: f.offsetWidth,
				inRow: f.parentElement?.classList.contains("thumb-row") === true,
				imgLoaded: img !== null && img.naturalWidth > 0,
				imgW: img === null ? 0 : img.offsetWidth,
			};
		});
		const virtualizer = root.querySelector(on.column)?.querySelector(on.virtualizer);
		const rows = (virtualizer ? (Array.from(virtualizer.children) as HTMLElement[]) : [])
			.filter((el) => el.hasAttribute("data-id"))
			.map((el) => el.getBoundingClientRect())
			.filter((r) => r.height > 0)
			.sort((a, b) => a.top - b.top);
		const where: string[] = [];
		let before: DOMRect | undefined;
		for (const row of rows) {
			if (before && row.top < before.bottom - 1) where.push(`a row ${Math.round(row.height)}px high over ${Math.round(before.bottom - row.top)}px of the row before it`);
			before = row;
		}
		return { frames, overlapping: where.length, where };
	}, tags);

/** An expanded thumbnail: whether it is open, the step it names and its caption, how it covers the column, and whether it paints on top. */
export type TExpandedThumbnail = { open: boolean; stepId: string; caption: string; dLeft: number; widthRatio: number; onTop: boolean };

/**
 * The document's expanded thumbnail. The element at the overlay's centre must be within the expanded frame: in a
 * virtualized column the rows are stacking contexts, and without the top layer a later row's tiles paint over it.
 */
export const expandedThumbnail = (page: Page, frame: string): Promise<TExpandedThumbnail> =>
	documentOf(page).evaluate((doc, selector) => {
		const f = doc.shadowRoot?.querySelector(selector);
		const fr = f?.getBoundingClientRect();
		const cr = doc.getBoundingClientRect();
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
		const stepId = f?.getAttribute("data-step-id");
		const caption = f?.shadowRoot?.querySelector(".step-caption")?.textContent;
		return {
			open: f !== null && f !== undefined,
			stepId: stepId === null || stepId === undefined ? "" : stepId,
			caption: caption === null || caption === undefined ? "" : caption.trim(),
			dLeft: fr ? Math.abs(fr.left - cr.left) : -1,
			widthRatio: fr && cr.width > 0 ? fr.width / cr.width : 0,
			onTop,
		};
	}, frame);

/** The scroll rail `host` holds. */
export const railIn = (page: Page, host: string): Locator => page.locator(`${host} ${SHU_TAG.SCROLLBAR}`).first();

/** One reading of a rail's rendered thumb. */
export type TThumb = { heightPx: number; topPx: number };
/** How a rail's thumb is read across a scroll: the fractions of the scroll, and the frames a box stays the same before it is read. */
export type TThumbReading = { samples: number[]; steadyFrames: number; settleFrames: number };

const THUMB_ID = SHU_TEST_IDS.SCROLLBAR.THUMB;

/**
 * The rendered thumb of `host`'s rail at each fraction of its scroll. The scroller is whichever element under the host
 * has the most to scroll. Empty where the host, its rail or a scroll is absent.
 */
export async function thumbAcrossScroll(page: Page, host: string, reading: TThumbReading): Promise<TThumb[]> {
	const thumb = railIn(page, host).getByTestId(THUMB_ID);
	if ((await thumb.count()) === 0) return [];
	const handle = await thumb.elementHandle();
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
					// A reader's scroll starts with input, and the wheel event is that signal: it pauses the live-edge follow as it
					// does for a person, so the follow doesn't reclaim the pane before the reading.
					scroller.dispatchEvent(new WheelEvent(arg.wheel, { bubbles: true, composed: true }));
					scroller.scrollTop = over * at;
					let last = "";
					let steady = 0;
					for (let frame = 0; frame < arg.settleFrames && steady < arg.steadyFrames; frame++) {
						await new Promise((r) => requestAnimationFrame(r));
						const box = arg.thumb?.getBoundingClientRect();
						const now = box ? `${Math.round(box.top)}:${Math.round(box.height)}` : "";
						steady = now === last ? steady + 1 : 0;
						last = now;
					}
				};
				// A first pass lets the virtualizer measure the rows at each position, so the readings compare the thumb across
				// content rather than across an estimate still refining itself.
				for (const at of arg.samples) await scrollTo(at);
				const readings: { heightPx: number; topPx: number }[] = [];
				for (const at of arg.samples) {
					await scrollTo(at);
					const box = arg.thumb.getBoundingClientRect();
					readings.push({ heightPx: Math.round(box.height), topPx: Math.round(box.top) });
				}
				return readings;
			},
			{ thumb: handle, samples: reading.samples, steadyFrames: reading.steadyFrames, settleFrames: reading.settleFrames, wheel: INPUT_EVENT.wheel },
		);
}

/** What a press at the middle of `host`'s rail thumb reaches: the thumb's test id where it can be grabbed, else what covers
 *  it, or null where the host doesn't hold a rail thumb. Read inside the rail's shadow root, where both are drawn. */
export async function thumbPressReaches(page: Page, host: string): Promise<string | null> {
	const rail = railIn(page, host);
	if ((await rail.getByTestId(THUMB_ID).count()) === 0) return null;
	return rail.evaluate(
		(el, a) => {
			const box = el.shadowRoot?.querySelector(`[data-testid="${a.thumbId}"]`)?.getBoundingClientRect();
			if (!box) return null;
			const at = el.shadowRoot?.elementFromPoint(Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2));
			if (at === null || at === undefined) return a.empty;
			const id = at.getAttribute("data-testid");
			return id === null ? at.tagName.toLowerCase() : id;
		},
		{ thumbId: THUMB_ID, empty: NO_ELEMENT },
	);
}

/** A node of a graph as a control reads it: its id, its type, and its name where it has one. */
export type TNodeRead = { id: string; type: string; name?: string };

/** The node that `match` names: by its handle `type:id`, by its bare id, or by a part of its name. */
export const nodeMatching = (nodes: TNodeRead[], match: string): TNodeRead | undefined =>
	nodes.find((n) => objectId(n.type, n.id) === match || n.id === match || (n.name !== undefined && n.name.includes(match)));
