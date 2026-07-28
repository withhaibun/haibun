/**
 * What a view may record, declared once for both sides of the bridge: the browser records under these names and the
 * run accepts them under the same ones. A name written in two places is a name that can drift.
 *
 * These are per-frame occurrences. They exist because the alternative is what actually happened: a rail thumb that
 * resized while a reader scrolled was diagnosed four times from descriptions, and every guess made it worse, because
 * nothing recorded what the view did between one frame and the next.
 */
import { z } from "zod";
import type { TBlipDeclaration } from "@haibun/core/lib/blips.js";

/** A view measured its own scroll geometry and the raw answer moved, before any quantisation. `value` is the thumb's
 *  size as a fraction of the rail; `rendered` says whether the change was big enough to redraw the thumb, so the
 *  revisions quantisation absorbs are visible too, which is exactly the micro-movement a smoothness problem is made of. */
export const VIEW_THUMB_BLIP = "haibun.shu.view.thumb_resize";

/** A view's scroll position changed. `value` is the distance in pixels, signed, so a correction reads as one. */
export const VIEW_SCROLL_BLIP = "haibun.shu.view.scroll";

/** What moved the view: the reader (wheel, touch, a rail seek), or the system (a follow, an estimate correction, a
 *  scroll-to). Bounded, which is what makes it a dimension; telling the two apart is the whole diagnosis. */
export const SCROLL_REASONS = ["reader", "system"] as const;

/** How long after wheel, touch or a rail seek a scroll still counts as the reader's. Past it, a move is the system's. */
export const READER_INPUT_WINDOW_MS = 150;

/** The view a recording came from: the hosting column's tag, so the document column and the monitor column read apart.
 *  Bounded, one per component tag on the page. */
const viewAttributes = z.object({ view: z.string(), at: z.number().optional() });

/** The virtualizer reported which rows are visible. `value` is how many rows the window is short of the last; the
 *  attributes carry the raw report and the follow's belief, which is what settles whether a follow that ended short
 *  was short in rows or only in pixels, and whether it still believed it was at the edge. */
export const VIEW_WINDOW_BLIP = "haibun.shu.view.window";

export const VIEW_BLIPS: TBlipDeclaration[] = [
	{
		name: VIEW_WINDOW_BLIP,
		instrument: "span-event",
		description: "A virtualized view reported its visible row window: how many rows short of the last it sits, with the follow's own belief alongside.",
		unit: "1",
		attributes: viewAttributes.extend({ first: z.number(), visible: z.number(), count: z.number(), following: z.boolean() }),
		dimensions: ["view"],
	},
	{
		name: VIEW_THUMB_BLIP,
		instrument: "span-event",
		description:
			"A view remeasured its scroll geometry and the raw viewport fraction changed. `rendered` marks the changes big enough to redraw the thumb; the rest are the revisions quantisation absorbs, which is where a jitter hides. A thumb that resizes while a reader scrolls drags every rail mark with it.",
		unit: "1",
		attributes: viewAttributes.extend({ visible: z.number(), total: z.number(), rendered: z.boolean() }),
		dimensions: ["view"],
	},
	{
		name: VIEW_SCROLL_BLIP,
		instrument: "span-event",
		description: "A view's scroll position moved, by `value` pixels, signed. `reason` says whether the reader moved it or the system did, so a move nobody asked for can be read as one and placed in order against what else happened.",
		unit: "px",
		attributes: viewAttributes.extend({ reason: z.enum(SCROLL_REASONS) }),
		dimensions: ["view", "reason"],
	},
];
