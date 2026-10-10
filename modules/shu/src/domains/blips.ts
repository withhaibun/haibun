/**
 * The blips a page and its views record, each declared once. The browser records under these names, and actuality accepts
 * them under the same names. A page records each long animation frame, which holds the main thread and delays input
 * behind it, with the longest script that ran in it (`long-frames.ts`). A view records its scroll position, its rail
 * thumb's size and its visible row window on each change, and states whether the reader or the page moved it.
 */
import { z } from "zod";
import { declareBlips, type TBlipDeclaration } from "@haibun/core/lib/blips.js";

/** A frame held the page's main thread past the browser's long-frame threshold: `value` is the frame's duration. */
export const PAGE_LONG_FRAME_BLIP = "haibun.shu.page.long_frame";

/** The script a frame is attributed to where a script didn't run in it: the browser's own rendering held it. */
export const RENDERING_ONLY = "(rendering)";

/** A view measured its scroll geometry, and the viewport's share of the column changed. `value` is the thumb's size as a
 *  share of the rail. `rendered` states whether the change redraws the thumb, so a change the rounding absorbs is
 *  recorded too. */
export const VIEW_THUMB_BLIP = "haibun.shu.view.thumb_resize";

/** A view's scroll position changed. `value` is the distance in pixels, signed, so a correction reads as one. */
export const VIEW_SCROLL_BLIP = "haibun.shu.view.scroll";

/** The virtualizer reported which rows are visible. `value` is how many rows the window is short of the last. The
 *  attributes state the virtualizer's report and whether the view follows the last row. */
export const VIEW_WINDOW_BLIP = "haibun.shu.view.window";

/** What moved a view: the reader (wheel, touch, a rail seek) or the page (a follow, an estimate's correction, a scroll to
 *  a row). */
const SCROLL_REASONS = ["reader", "system"] as const;

/** How long after wheel, touch or a rail seek a scroll counts as the reader's. A later move is the page's. */
export const READER_INPUT_WINDOW_MS = 150;

/** The view a recording came from: the tag of its column, so the document column and the monitor column read apart. */
export const viewAttributes = z.object({ view: z.string(), at: z.number().optional() });

const BLIPS: TBlipDeclaration[] = [
	{
		name: PAGE_LONG_FRAME_BLIP,
		instrument: "histogram",
		description:
			"A frame held the page's main thread past the browser's long-frame threshold. `value` is its duration, `blocking` how long it held input back, `render` how much of it the browser spent rendering, and `script` the longest script that ran in it, or (rendering) where a script didn't run.",
		unit: "ms",
		attributes: z.object({ blocking: z.number(), render: z.number(), script: z.string(), at: z.number().optional() }),
		origin: true,
	},
	{
		name: VIEW_WINDOW_BLIP,
		instrument: "span-event",
		description: "A virtualized view reported its visible row window: how many rows short of the last it is, and whether it follows the last row.",
		unit: "1",
		attributes: viewAttributes.extend({ first: z.number(), visible: z.number(), count: z.number(), following: z.boolean() }),
		dimensions: ["view"],
		origin: true,
	},
	{
		name: VIEW_THUMB_BLIP,
		instrument: "span-event",
		description:
			"A view measured its scroll geometry and the viewport's share of the column changed. `rendered` marks a change that redraws the thumb; the other changes are absorbed by rounding. A thumb that resizes during a scroll moves every rail mark.",
		unit: "1",
		attributes: viewAttributes.extend({ visible: z.number(), total: z.number(), rendered: z.boolean() }),
		dimensions: ["view"],
		origin: true,
	},
	{
		name: VIEW_SCROLL_BLIP,
		instrument: "span-event",
		description:
			"A view's scroll position moved by `value` pixels, signed. `reason` states whether the reader or the page moved it, so a move the reader didn't request reads as one, in order with the other blips.",
		unit: "px",
		attributes: viewAttributes.extend({ reason: z.enum(SCROLL_REASONS) }),
		dimensions: ["view", "reason"],
		origin: true,
	},
];

// The module declares its blips as it loads, so a blip's origin names this module. Actuality imports it, and the
// declarations exist before a batch of blips arrives.
declareBlips(...BLIPS);

/** A long animation frame as the browser reports it: the fields the page reads. */
export type TLongFrame = PerformanceEntry & {
	blockingDuration: number;
	renderStart: number;
	scripts: Array<{ duration: number; invoker: string; sourceFunctionName: string; sourceURL: string }>;
};

/** Returns the script a frame is attributed to: its longest, by its function's name where the browser states one and by
 *  its invoker otherwise, then by its file where the browser states one. */
export function scriptOf(frame: Pick<TLongFrame, "scripts">): string {
	const longest = frame.scripts.reduce<TLongFrame["scripts"][number] | undefined>((held, script) => (held && held.duration >= script.duration ? held : script), undefined);
	if (!longest) return RENDERING_ONLY;
	const file = longest.sourceURL.split("/").pop();
	const named = longest.sourceFunctionName.length > 0 ? longest.sourceFunctionName : longest.invoker;
	return file ? `${named} ${file}` : named;
}
