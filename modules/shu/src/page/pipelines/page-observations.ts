/**
 * Reports what the browser observes of the page to actuality: each script the page's policy refuses, as a failure that
 * states what was refused and how a script runs here, and each long animation frame, as `PAGE_LONG_FRAME_BLIP`
 * attributed to its longest script.
 */
import { reportFailure } from "../../client-log.js";
import { recordClientBlip } from "../../client-blips.js";
import { PAGE_LONG_FRAME_BLIP, scriptOf } from "../../domains/blips.js";
import { HOW_SCRIPTS_RUN, refusal } from "../derivations/refused-script.js";
import type { TPageObservers } from "../ports.js";

/** The source a refused script is reported under. */
const REFUSED_SCRIPTS_SOURCE = "content-security-policy";

/** Reports each script the page's policy refuses after the call. */
export function reportRefusedScripts(observers: TPageObservers): void {
	observers.refusedScripts((event) => reportFailure(REFUSED_SCRIPTS_SOURCE, refusal(event), new Error(HOW_SCRIPTS_RUN)));
}

/** Records each long animation frame of the page, including the frames before the call. Returns whether the browser
 *  reports long frames. */
export function recordLongFrames(observers: TPageObservers): boolean {
	return observers.longFrames((frame) => {
		const render = frame.renderStart > 0 ? frame.startTime + frame.duration - frame.renderStart : 0;
		recordClientBlip(PAGE_LONG_FRAME_BLIP, frame.duration, { blocking: frame.blockingDuration, render, script: scriptOf(frame) });
	});
}
