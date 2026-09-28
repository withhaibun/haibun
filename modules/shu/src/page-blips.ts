/**
 * What a page may record about itself, declared once for both sides of the bridge, as the view vocabulary is.
 *
 * A page's main thread runs its scripts, its rendering and its input, one after another. A frame that holds it long
 * delays every keystroke and click behind it, and a profile of a slow page is mostly the browser's own work, which a
 * script's timing doesn't show. The browser reports each such frame as a long animation frame, with how long it blocked input,
 * how much of it went to rendering, and the scripts that ran in it. The page records each one here, attributed to its
 * longest script, so a run reads what held a page and where, without a profiler attached. `long-frames.ts` records them.
 */
import { z } from "zod";
import { declareBlips, type TBlipDeclaration } from "@haibun/core/lib/blips.js";

/** A frame held the page's main thread past the browser's long-frame threshold: `value` is the frame's duration. */
export const PAGE_LONG_FRAME_BLIP = "haibun.shu.page.long_frame";

/** The script a frame is attributed to where a script didn't run in it: the browser's own rendering held it. */
export const RENDERING_ONLY = "(rendering)";

const PAGE_BLIPS: TBlipDeclaration[] = [
	{
		name: PAGE_LONG_FRAME_BLIP,
		instrument: "histogram",
		description:
			"A frame held the page's main thread past the browser's long-frame threshold. `value` is its duration, `blocking` how long it held input back, `render` how much of it the browser spent rendering, and `script` the longest script that ran in it, or (rendering) where a script didn't run.",
		unit: "ms",
		attributes: z.object({ blocking: z.number(), render: z.number(), script: z.string(), at: z.number().optional() }),
		origin: true,
	},
];

// Declared where the vocabulary lives, so an origin names this module: the run side imports this module and the
// declarations are in place before any batch arrives.
declareBlips(...PAGE_BLIPS);

/** A long animation frame as the browser reports it: the fields read here. */
export type TLongFrame = PerformanceEntry & {
	blockingDuration: number;
	renderStart: number;
	scripts: Array<{ duration: number; invoker: string; sourceFunctionName: string; sourceURL: string }>;
};

/** The script a frame is attributed to: its longest, named by function where the browser names one, and by file. */
export function scriptOf(frame: Pick<TLongFrame, "scripts">): string {
	const longest = frame.scripts.reduce<TLongFrame["scripts"][number] | undefined>((held, script) => (held && held.duration >= script.duration ? held : script), undefined);
	if (!longest) return RENDERING_ONLY;
	const file = longest.sourceURL.split("/").pop() ?? "";
	return `${longest.sourceFunctionName || longest.invoker}${file ? ` ${file}` : ""}`;
}
