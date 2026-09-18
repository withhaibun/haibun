/**
 * Controls for the actions bar's history: what a reader does to it that no test id addresses, kept beside the element
 * as every view's controls are.
 *
 * Steps never lead with the article "the", haibun treats such lines as narrative prose, not matchable steps.
 */
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK } from "@haibun/core/lib/util/index.js";
import { pollUntil, type EvalPage } from "./controls-util.js";
import { SHU_TAG } from "../consts.js";
import { FOLLOW_EDGE_SLACK_PX } from "../controllers/index.js";

/** How close to its end the history counts as showing its newest turn, which is what a followed view keeps. */
const AT_THE_END_PX = FOLLOW_EDGE_SLACK_PX;

export default class ShuActivityHistoryControls extends AStepper {
	description = "Actions bar history controls: read an earlier turn, which is a reader scrolling away from the end.";

	private page(): Promise<EvalPage> {
		const wp = this.getWorld().runtime.steppers?.find((s) => typeof (s as { getPage?: unknown }).getPage === "function") as { getPage(): Promise<EvalPage> } | undefined;
		if (!wp) throw new Error("ShuActivityHistoryControls: no page-providing stepper (web-playwright) in the world");
		return wp.getPage();
	}

	steps: TStepperSteps = {
		chatIsAtItsNewestTurn: {
			gwta: "chat shows its newest turn",
			action: async () => {
				const at = await pollUntil(
					await this.page(),
					(page) =>
						page.evaluate((tag: string) => {
							let history: HTMLElement | null = null;
							const roots: Array<Document | ShadowRoot> = [document];
							while (roots.length > 0 && !history) {
								const root = roots.pop();
								if (!root) break;
								history = root.querySelector(tag);
								for (const el of Array.from(root.querySelectorAll("*"))) if (el.shadowRoot) roots.push(el.shadowRoot);
							}
							if (!history) return "no history is rendered";
							return history.scrollHeight - (history.scrollTop + history.clientHeight);
						}, SHU_TAG.ACTIVITY_HISTORY),
					(read) => typeof read === "number" && read <= AT_THE_END_PX,
				);
				return typeof at === "number" && at <= AT_THE_END_PX ? actionOK() : actionNotOK(`the chat is ${String(at)} pixels short of its newest turn`);
			},
		},
		readAnEarlierTurn: {
			gwta: "read an earlier turn in the chat",
			action: async () => {
				const scrolled = await pollUntil(
					await this.page(),
					(page) =>
						page.evaluate((tag: string) => {
							// The history renders inside the bar's shadow root, so every root is searched, as the other views' controls do.
							let history: HTMLElement | null = null;
							const roots: Array<Document | ShadowRoot> = [document];
							while (roots.length > 0 && !history) {
								const root = roots.pop();
								if (!root) break;
								history = root.querySelector(tag);
								for (const el of Array.from(root.querySelectorAll("*"))) if (el.shadowRoot) roots.push(el.shadowRoot);
							}
							if (!history) return "no history is rendered";
							if (history.scrollHeight <= history.clientHeight) return `the history holds one screen: ${history.scrollHeight} of ${history.clientHeight}`;
							history.scrollTop = 0;
							history.dispatchEvent(new Event("scroll"));
							return history.scrollTop === 0 ? true : "the history did not scroll";
						}, SHU_TAG.ACTIVITY_HISTORY),
					(read) => read === true,
				);
				return scrolled === true ? actionOK() : actionNotOK(`the chat's history was not scrolled: ${String(scrolled)}`);
			},
		},
	};
}
