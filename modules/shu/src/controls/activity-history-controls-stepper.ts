/**
 * Controls for the actions bar's history: what a reader does to it that a test id doesn't address.
 *
 * A step doesn't lead with the article "the", since haibun reads such a line as narrative prose and not as a step.
 */
import type { Page } from "playwright";
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK } from "@haibun/core/lib/domains/util.js";
import { FOLLOW_EDGE_SLACK_PX } from "../page/domains/scroll-follow.js";
import { STATE_MS } from "./domains/waits.js";
import { comesToHold, historyOf, historyShortOfNewest, pollUntil, scrollHistoryToStart } from "./pipelines/page-reads.js";
import { controlled } from "./root.js";

const NO_HISTORY = "the page doesn't render a history";
/** How many times the history's scroll is read, and how far apart, while it comes to rest at its first turn. */
const SCROLL_POLL = { tries: 25, ms: 200 };

export default class ShuActivityHistoryControls extends AStepper {
	description = "Actions bar history controls: read an earlier turn, which is a reader scrolling away from the end.";

	/** The page this control drives. */
	private page(): Promise<Page> {
		return controlled(this).page();
	}

	steps = {
		chatIsAtItsNewestTurn: {
			gwta: "chat shows its newest turn",
			action: async () => {
				const history = historyOf(await this.page());
				if ((await history.count()) === 0) return actionNotOK(NO_HISTORY);
				if (await comesToHold(history, ({ el, arg }) => el.scrollHeight - (el.scrollTop + el.clientHeight) <= arg, FOLLOW_EDGE_SLACK_PX, STATE_MS)) return actionOK();
				return actionNotOK(`the chat is ${await historyShortOfNewest(history)} pixels short of its newest turn`);
			},
		},
		readAnEarlierTurn: {
			gwta: "read an earlier turn in the chat",
			action: async () => {
				const history = historyOf(await this.page());
				if ((await history.count()) === 0) return actionNotOK(NO_HISTORY);
				const scrolled = await pollUntil(
					history.page(),
					() => scrollHistoryToStart(history),
					(read) => read === true,
					SCROLL_POLL.tries,
					SCROLL_POLL.ms,
				);
				return scrolled === true ? actionOK() : actionNotOK(`the chat's history was not scrolled: ${String(scrolled)}`);
			},
		},
	} as const satisfies TStepperSteps;
}
