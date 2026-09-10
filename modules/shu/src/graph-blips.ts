/**
 * What a graph scene may record, declared once for both sides of the bridge, as the view vocabulary is.
 *
 * A scene draws frames, and what a frame costs is not visible from the page: the renderer's work is done in another
 * process, and the main thread sees half a millisecond where a software rasterizer spends sixteen. The scene measures
 * the cost with a fence and records it here, and records the regulation it applies to itself on that measurement, so
 * a run can watch a page find that its frames are expensive and rest its decorative motion, and read why.
 */
import { z } from "zod";
import { declareBlips, type TBlipDeclaration } from "@haibun/core/lib/blips.js";
import { viewAttributes } from "./view-blips.js";

/** A scene measured one drawn frame: `value` is what the renderer took to complete it, in milliseconds, read from a
 *  fence placed after the draw. The attributes say how much was drawn, so a cost can be read against a size. */
export const GRAPH_FRAME_BLIP = "haibun.shu.graph.frame";

/** A scene regulated its own decorative motion: `signal` says whether the breath rested (over budget) or resumed
 *  (within budget), `value` is the median frame cost that decided it, and `share` the breath's share of wall time. */
export const GRAPH_REGULATION_BLIP = "haibun.shu.graph.regulation";

export const REGULATION_SIGNALS = ["decorativeOverBudget", "decorativeWithinBudget"] as const;

export const GRAPH_BLIPS: TBlipDeclaration[] = [
	{
		name: GRAPH_FRAME_BLIP,
		instrument: "histogram",
		description:
			"A graph scene measured what one drawn frame cost the renderer, from the draw to the fence after it signalling. A software rasterizer reads as tens of milliseconds where a GPU reads as one or two.",
		unit: "ms",
		attributes: viewAttributes.extend({ drawCalls: z.number(), triangles: z.number(), nodes: z.number() }),
		dimensions: ["view"],
		origin: true,
	},
	{
		name: GRAPH_REGULATION_BLIP,
		instrument: "span-event",
		description:
			"A graph scene regulated its own decorative motion on the measured frame cost: the active node's breath rested because it was over its share of wall time, or breathed again because it was within it.",
		unit: "ms",
		attributes: viewAttributes.extend({ signal: z.enum(REGULATION_SIGNALS), share: z.number() }),
		dimensions: ["view", "signal"],
		origin: true,
	},
];

// Declared where the vocabulary lives, as the view vocabulary is: the run side imports this module and the declarations
// are in place before any batch arrives.
declareBlips(...GRAPH_BLIPS);
