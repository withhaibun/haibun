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

export const GRAPH_BLIPS: TBlipDeclaration[] = [
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
