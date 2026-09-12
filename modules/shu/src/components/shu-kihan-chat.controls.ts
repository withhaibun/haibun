/**
 * Assertions for the ask pane, kept beside shu-kihan-chat the way each view's controls stay with the view. What the
 * transcript holds is what a reader sees, so a turn is counted, and what it states is read, where it is rendered rather
 * than where it was recorded.
 */
import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionOK, actionNotOK } from "@haibun/core/lib/util/index.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { countMatching, hasText, pollUntil, type EvalPage } from "./controls-util.js";

// How many reads a witness gives a turn to answer, at pollUntil's interval. A turn crosses the server, a model and the
// stream that carries the reply back.
const ANSWERED_TRIES = 150;

export default class ShuKihanChatControls extends AStepper {
	description = "Ask pane controls: assert how many turns the transcript holds, and what a turn states it was made of.";

	/** The page a web-playwright-like stepper provides, duck-typed so shu keeps no dependency on it. */
	private page(): Promise<EvalPage> {
		const wp = this.getWorld().runtime.steppers?.find((s) => typeof (s as { getPage?: unknown }).getPage === "function") as { getPage(): Promise<EvalPage> } | undefined;
		if (!wp) throw new Error("ShuKihanChatControls: no page-providing stepper (web-playwright) in the world");
		return wp.getPage();
	}

	steps: TStepperSteps = {
		askStates: {
			// Each turn states what it was made of: the context it sent, the conversation it followed from, and each call
			// it dispatched. A feature reads one of those statements to say a turn carried what the reader is owed.
			gwta: "ask states {statement}",
			action: async ({ statement }: { statement: string }) => {
				const page = await this.page();
				const stated = await pollUntil(page, (p) => hasText(p, `[data-testid="${SHU_TEST_IDS.APP.CHAT_ACTIVITY}"]`, statement), (found) => found, ANSWERED_TRIES);
				return stated ? actionOK() : actionNotOK(`no turn stated "${statement}"`);
			},
		},
		askHasAnswered: {
			// A conversation continues for as long as a reader asks. One answer proves a turn ran; this states how many
			// the transcript holds, which is what a pane that stops taking messages fails.
			gwta: "ask has answered {count} times",
			action: async ({ count }: { count: string }) => {
				const wanted = Number.parseInt(count, 10);
				if (!Number.isFinite(wanted) || wanted < 1) return actionNotOK(`ask has answered: "${count}" is not a number of turns`);
				const page = await this.page();
				const answered = await pollUntil(page, (p) => countMatching(p, `[data-testid="${SHU_TEST_IDS.APP.CHAT_TEXT}"]`), (n) => n >= wanted, ANSWERED_TRIES);
				return answered >= wanted ? actionOK() : actionNotOK(`the ask pane answered ${answered} of ${wanted} turns`);
			},
		},
	};
}
