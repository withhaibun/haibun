/**
 * Declares the blips a graph scene records, once for both sides of the bridge, as view-blips.ts declares the view's.
 *
 * A scene draws frames. The page can't observe the renderer's time for a frame, because another process does the work.
 * The main thread measures half a millisecond for a frame that takes a software rasterizer sixteen. The scene measures
 * the renderer's time with a fence and records it as `GRAPH_FRAME_BLIP`. It records the regulation that measurement
 * determines as `GRAPH_REGULATION_BLIP`. Actuality's record then shows a page resting its decorative motion, with the
 * frame time that determined the rest.
 */
import { z } from "zod";
import { declareBlips, type TBlipDeclaration } from "@haibun/core/lib/blips.js";
import { viewAttributes } from "./view-blips.js";
import { REGULATION_KINDS } from "./graph/polymorphic/polymorphic-regulator.js";

/** A scene measured one drawn frame. `value` is the renderer's time to complete the frame in milliseconds. A fence
 *  placed after the draw provides that time. The attributes state how much the frame drew, so a reader can compare a
 *  time with a size. */
export const GRAPH_FRAME_BLIP = "haibun.shu.graph.frame";

/** A scene regulated its own decorative motion. `signal` states whether the breath rested (over its limit) or resumed
 *  (within its limit). `value` is the median frame time compared with the limit. `share` is the breath's share of wall
 *  time. */
export const GRAPH_REGULATION_BLIP = "haibun.shu.graph.regulation";

/** Lists the discrete changes that wake a scene: the visible model changed, the camera moved, the arrangement changed,
 *  the container or canvas resized, the theme changed, the active node's breath, a focus to apply, the pointer moved
 *  over the canvas, a label's text was laid out, or particles travel a new link. */
const WAKE_CAUSES = ["data", "camera", "arrange", "resize", "theme", "breath", "focus", "pointer", "label", "particles"] as const;
export type TWakeCause = (typeof WAKE_CAUSES)[number];

/** Lists the reasons a scene draws. `rest` means the scene doesn't draw. A motion in progress is a drag, a tween, the
 *  engine settling or a magnify easing. A discrete change draws within its grace and takes the name of its wake cause.
 *  The list is bounded, so it serves as a dimension. */
const DRAWING_REASONS = ["rest", "drag", "tween", "settle", "magnify", ...WAKE_CAUSES] as const;
export type TDrawingReason = (typeof DRAWING_REASONS)[number];

/** A scene's reason to draw changed. `reason` is the reason the scene draws from this point. `was` is the previous
 *  reason. `value` is how long the scene drew for the previous reason, over `frames` of its frames. `wakes` counts the
 *  changes that woke the scene in that time. A page's drawing time divides by reason, so a reader reads the reason that
 *  kept a scene drawing instead of guessing it. One long motion reads separately from many short changes. */
export const GRAPH_DRAWING_BLIP = "haibun.shu.graph.drawing";

const GRAPH_BLIPS: TBlipDeclaration[] = [
	{
		name: GRAPH_DRAWING_BLIP,
		instrument: "span-event",
		description:
			"A graph scene's reason to draw changed. `reason` is the reason the scene draws from this point, or rest where it doesn't have a reason to draw. `was` is the previous reason. `value` is how long the scene drew for the previous reason, over `frames` frames. `wakes` counts the changes that woke the scene in that time. A scene that never rests draws every frame, and this blip names the reason that kept it drawing.",
		unit: "ms",
		attributes: viewAttributes.extend({ reason: z.enum(DRAWING_REASONS), was: z.enum(DRAWING_REASONS), frames: z.number(), wakes: z.number() }),
		// `was` is the reason `value` measures, so a total by dimension is the drawing time of each reason.
		dimensions: ["view", "was"],
		origin: true,
	},
	{
		name: GRAPH_FRAME_BLIP,
		instrument: "histogram",
		description:
			"A graph scene measured the renderer's time for one drawn frame. The time runs from the draw to the signal of the fence placed after it. A software rasterizer reads as tens of milliseconds, and a GPU reads as one or two.",
		unit: "ms",
		attributes: viewAttributes.extend({ drawCalls: z.number(), nodes: z.number() }),
		dimensions: ["view"],
		origin: true,
	},
	{
		name: GRAPH_REGULATION_BLIP,
		instrument: "span-event",
		description:
			"A graph scene regulated its own decorative motion by the measured frame time. The active node's breath rested because it was over its share of wall time, or breathed again because it was within that share.",
		unit: "ms",
		attributes: viewAttributes.extend({ signal: z.enum(REGULATION_KINDS), share: z.number() }),
		dimensions: ["view", "signal"],
		origin: true,
	},
];

// This module declares its own vocabulary, as view-blips.ts does. The actuality side imports this module, so the
// declarations are in place before any batch arrives.
declareBlips(...GRAPH_BLIPS);
