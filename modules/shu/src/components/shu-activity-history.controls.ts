/**
 * Controls for the actions bar's history: what a reader does to it that a test id doesn't address, kept beside the element
 * as every view's controls are.
 *
 * Steps never lead with the article "the", haibun treats such lines as narrative prose, not matchable steps.
 */
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK } from "@haibun/core/lib/util/index.js";
import { pollUntil, type EvalPage } from "./controls-util.js";
import { SHU_TAG } from "../consts.js";
import { FOLLOW_EDGE_SLACK_PX } from "../controllers/index.js";

export default class ShuActivityHistoryControls extends AStepper {
	description = "Actions bar history controls: read an earlier turn, which is a reader scrolling away from the end.";

	private page(): Promise<EvalPage> {
		const wp = this.getWorld().runtime.steppers?.find((s) => typeof (s as { getPage?: unknown }).getPage === "function") as { getPage(): Promise<EvalPage> } | undefined;
		if (!wp) throw new Error("ShuActivityHistoryControls: the world doesn't hold a page-providing stepper (web-playwright)");
		return wp.getPage();
	}

	steps: TStepperSteps = {
		chatIsAtItsNewestTurn: {
			gwta: "chat shows its newest turn",
			action: async () => {
				const short = await pollUntil(
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
							if (!history) return "the page doesn't render a history";
							return history.scrollHeight - (history.scrollTop + history.clientHeight);
						}, SHU_TAG.ACTIVITY_HISTORY),
					(read) => typeof read === "number" && read <= FOLLOW_EDGE_SLACK_PX,
				);
				return typeof short === "number" && short <= FOLLOW_EDGE_SLACK_PX ? actionOK() : actionNotOK(`the chat is ${String(short)} pixels short of its newest turn`);
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
							if (!history) return "the page doesn't render a history";
							if (history.scrollHeight <= history.clientHeight) return `the history holds one screen: ${history.scrollHeight} of ${history.clientHeight}`;
							// A reader's scroll starts with input, and the wheel event is that signal: it pauses the follow as it does
							// for a person.
							history.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
							history.scrollTop = 0;
							return history.scrollTop === 0 ? true : "the history didn't scroll";
						}, SHU_TAG.ACTIVITY_HISTORY),
					(read) => read === true,
				);
				return scrolled === true ? actionOK() : actionNotOK(`the chat's history was not scrolled: ${String(scrolled)}`);
			},
		},
	};
}
