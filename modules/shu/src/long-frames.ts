/**
 * The page's recorder of long animation frames: each frame the browser reports as holding the main thread is recorded
 * under `PAGE_LONG_FRAME_BLIP`, attributed to its longest script (see `page-blips.ts`).
 */
import { recordClientBlip } from "./client-blips.js";
import { pagePinned } from "./page-pinned.js";
import { PAGE_LONG_FRAME_BLIP, scriptOf, type TLongFrame } from "./page-blips.js";

/** Record every long animation frame this page has, from the ones before the call on. Once per page, whatever bundles
 *  load this module. A browser that doesn't report such frames doesn't have a frame to record. */
export function observeLongFrames(): void {
	if (!globalThis.PerformanceObserver?.supportedEntryTypes?.includes("long-animation-frame")) return;
	pagePinned("__SHU_LONG_FRAMES__", () => {
		const observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries() as TLongFrame[]) {
				const render = entry.renderStart > 0 ? entry.startTime + entry.duration - entry.renderStart : 0;
				recordClientBlip(PAGE_LONG_FRAME_BLIP, entry.duration, { blocking: entry.blockingDuration, render, script: scriptOf(entry) });
			}
		});
		observer.observe({ type: "long-animation-frame", buffered: true });
		return observer;
	});
}
