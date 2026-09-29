/**
 * Controls for the actions bar's history: what a reader does to it that a test id doesn't address, kept beside the element
 * as every view's controls are.
 *
 * Steps never lead with the article "the", haibun treats such lines as narrative prose, not matchable steps.
 */
import type { Locator } from "playwright";
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK } from "@haibun/core/lib/util/index.js";
import { INPUT_EVENT, STATE_MS, comesToHold, controlledPage, pollUntil } from "./controls-util.js";
import { SHU_TAG } from "../consts.js";
import { FOLLOW_EDGE_SLACK_PX } from "../controllers/index.js";

const NO_HISTORY = "the page doesn't render a history";

export default class ShuActivityHistoryControls extends AStepper {
	description = "Actions bar history controls: read an earlier turn, which is a reader scrolling away from the end.";

	/** The actions bar's history. */
	private async history(): Promise<Locator> {
		return (await controlledPage(this)).locator(SHU_TAG.ACTIVITY_HISTORY).first();
	}

	steps = {
		chatIsAtItsNewestTurn: {
			gwta: "chat shows its newest turn",
			action: async () => {
				const history = await this.history();
				if ((await history.count()) === 0) return actionNotOK(NO_HISTORY);
				if (await comesToHold(history, ({ el, arg }) => el.scrollHeight - (el.scrollTop + el.clientHeight) <= arg, FOLLOW_EDGE_SLACK_PX, STATE_MS)) return actionOK();
				const short = await history.evaluate((el) => el.scrollHeight - (el.scrollTop + el.clientHeight));
				return actionNotOK(`the chat is ${short} pixels short of its newest turn`);
			},
		},
		readAnEarlierTurn: {
			gwta: "read an earlier turn in the chat",
			action: async () => {
				const history = await this.history();
				if ((await history.count()) === 0) return actionNotOK(NO_HISTORY);
				const scrolled = await pollUntil(
					history.page(),
					() =>
						history.evaluate((el, wheel) => {
							if (el.scrollHeight <= el.clientHeight) return `the history holds one screen: ${el.scrollHeight} of ${el.clientHeight}`;
							// A reader's scroll starts with input, and the wheel event is that signal: it pauses the follow as it does
							// for a person.
							el.dispatchEvent(new WheelEvent(wheel, { deltaY: -100, bubbles: true }));
							el.scrollTop = 0;
							return el.scrollTop === 0 ? true : "the history didn't scroll";
						}, INPUT_EVENT.wheel),
					(read) => read === true,
				);
				return scrolled === true ? actionOK() : actionNotOK(`the chat's history was not scrolled: ${String(scrolled)}`);
			},
		},
	} as const satisfies TStepperSteps;
}
