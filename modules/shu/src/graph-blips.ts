/**
 * What a graph scene may record, declared once for both sides of the bridge, as the view vocabulary is.
 *
 * A scene draws frames, and what a frame takes the renderer is not visible from the page: the work is done in another
 * process, and the main thread uses half a millisecond where a software rasterizer uses sixteen. The scene
 * measures the time with a fence and records it here, and records the regulation it applies to itself on that
 * measurement, so a run can observe a page rest its decorative motion and read the time that decided it.
 */
import { z } from "zod";
import { declareBlips, type TBlipDeclaration } from "@haibun/core/lib/blips.js";
import { viewAttributes } from "./view-blips.js";
import { REGULATION_KINDS } from "./graph/polymorphic/polymorphic-regulator.js";

/** A scene measured one drawn frame: `value` is what the renderer took to complete it, in milliseconds, read from a
 *  fence placed after the draw. The attributes state how much was drawn, so a time can be read against a size. */
export const GRAPH_FRAME_BLIP = "haibun.shu.graph.frame";

/** A scene regulated its own decorative motion: `signal` states whether the breath rested (over its limit) or resumed
 *  (within its limit), `value` is the median frame time compared with the limit, and `share` the breath's share of wall
 *  time. */
export const GRAPH_REGULATION_BLIP = "haibun.shu.graph.regulation";

/** What wakes a scene for a discrete change: the visible model changed, the camera moved, the arrangement changed, the
 *  container or canvas resized, the theme changed, the active node's breath, a focus to apply, the pointer moved over
 *  the canvas, a label's text was laid out, or particles travel a fresh link. */
export const WAKE_CAUSES = ["data", "camera", "arrange", "resize", "theme", "breath", "focus", "pointer", "label", "particles"] as const;
export type TWakeCause = (typeof WAKE_CAUSES)[number];

/** Why a scene draws: nothing (it rests), a motion in progress (a drag, a tween, the engine settling, a magnify
 *  easing), or a discrete change within its grace, named by what caused it. Bounded, so it is a dimension. */
export const DRAWING_REASONS = ["rest", "drag", "tween", "settle", "magnify", ...WAKE_CAUSES] as const;
export type TDrawingReason = (typeof DRAWING_REASONS)[number];

/** A scene's reason to draw changed: `reason` is why it draws from now, `was` why it drew before, and `value` how long it
 *  drew for that, over `frames` of its frames, woken `wakes` times by a change meanwhile. The drawing time of a page
 *  divides by reason, so what kept a scene drawing is read rather than guessed, and one long motion reads apart from
 *  many short changes. */
export const GRAPH_DRAWING_BLIP = "haibun.shu.graph.drawing";

export const GRAPH_BLIPS: TBlipDeclaration[] = [
	{
		name: GRAPH_DRAWING_BLIP,
		instrument: "span-event",
		description:
			"A graph scene's reason to draw changed. `reason` is why it draws from now, or rest where nothing keeps it drawing; `was` is why it drew before, and `value` how long it drew for that, over `frames` frames, during which a change woke it `wakes` times. A scene that never rests draws every frame, and this names what kept it drawing.",
		unit: "ms",
		attributes: viewAttributes.extend({ reason: z.enum(DRAWING_REASONS), was: z.enum(DRAWING_REASONS), frames: z.number(), wakes: z.number() }),
		dimensions: ["view", "reason"],
		origin: true,
	},
	{
		name: GRAPH_FRAME_BLIP,
		instrument: "histogram",
		description:
			"A graph scene measured what one drawn frame took the renderer, from the draw to the fence after it signalling. A software rasterizer reads as tens of milliseconds where a GPU reads as one or two.",
		unit: "ms",
		attributes: viewAttributes.extend({ drawCalls: z.number(), nodes: z.number() }),
		dimensions: ["view"],
		origin: true,
	},
	{
		name: GRAPH_REGULATION_BLIP,
		instrument: "span-event",
		description:
			"A graph scene regulated its own decorative motion on the measured frame time: the active node's breath rested because it was over its share of wall time, or breathed again because it was within it.",
		unit: "ms",
		attributes: viewAttributes.extend({ signal: z.enum(REGULATION_KINDS), share: z.number() }),
		dimensions: ["view", "signal"],
		origin: true,
	},
];

// Declared where the vocabulary lives, as the view vocabulary is: the run side imports this module and the declarations
// are in place before any batch arrives.
declareBlips(...GRAPH_BLIPS);
