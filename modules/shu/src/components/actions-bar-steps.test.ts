// @vitest-environment jsdom
/**
 * The actions bar's step mode, held apart from the bar: the step options with those for the selected type first, a
 * caller opened in the history or the last one retargeted, the Ask mode offered only with the step an ask runs, and the
 * newest output kept in view as a step settles.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StepDescriptor } from "../rpc-registry.js";

/** The steps the run offers, and those it offers for the selected type. */
const offered: StepDescriptor[] = [];
const forTheType: StepDescriptor[] = [];
vi.mock("../rpc-registry.js", async (actual) => ({
	...(await actual<Record<string, unknown>>()),
	getAvailableSteps: () => Promise.resolve(offered),
	stepsForContext: () => forTheType,
}));

const { ActionsBarSteps, stepDetails, stepOptions, stepSecondary } = await import("./actions-bar-steps.js");
const { aControllerHost } = await import("./actions-bar-host.test-fake.js");
const { SHU_EVENT, SHU_TAG } = await import("../consts.js");

const step = (method: string, pattern: string, extra: Partial<StepDescriptor> = {}) => ({ method, pattern, ...extra }) as StepDescriptor;
const SHOW = step("GraphStepper-showGraph", "show graph {name}", { paramDomains: { name: "string" }, productsDomain: "graph" });
const LIST = step("GraphStepper-listTypes", "list types");
const ASK = step("LlmStepper-chatWithContext", "ask {prompt}");

/** The history callers open in, as the steps address it. */
type THistory = HTMLElement & { scrollToBottom: ReturnType<typeof vi.fn> };

async function aStepsPage(selectedLabel = "") {
	const host = aControllerHost();
	const history = Object.assign(document.createElement("div"), { scrollToBottom: vi.fn() }) as THistory;
	host.append(history);
	const steps = new ActionsBarSteps(host, { testIdPrefix: () => "app-", selectedLabel: () => selectedLabel, history: () => history as never, combo: () => null });
	steps.hostConnected();
	await steps.load();
	return { host, history, steps };
}

const callers = (history: HTMLElement) => Array.from(history.querySelectorAll(SHU_TAG.STEP_CALLER));
/** A caller already in the history, which has run its step or not. */
const aCaller = (history: HTMLElement, method: string, executed: boolean) => {
	const caller = Object.assign(document.createElement(SHU_TAG.STEP_CALLER), { executed, reset: vi.fn() });
	caller.setAttribute("method", method);
	history.append(caller);
	return caller;
};

describe("the actions bar's step mode", () => {
	beforeEach(() => {
		offered.splice(0, offered.length, SHOW, LIST);
		forTheType.length = 0;
	});

	it("says what a step takes and gives, by domain", () => {
		expect(stepSecondary(SHOW)).toBe("string → graph");
		expect(stepSecondary(LIST)).toBe("");
		expect(stepDetails(SHOW)).toBe("inputs:\n  name: string\noutputs: graph");
	});

	it("offers the steps for the selected type first and marked, then every other step once, each by its method", () => {
		const options = stepOptions([SHOW, LIST], [LIST]);
		expect(options.map((o) => [o.value, o.label])).toEqual([
			[LIST.method, "● list types"],
			[SHOW.method, "show graph {name}"],
		]);
	});

	it("offers the Ask mode only where the run offers the step an ask runs", async () => {
		expect((await aStepsPage()).steps.offersAsk).toBe(false);
		offered.push(ASK);
		expect((await aStepsPage()).steps.offersAsk).toBe(true);
	});

	it("opens a caller for a picked step in the history, numbered among the callers of its method, and keeps it in view", async () => {
		const { history, steps } = await aStepsPage();
		aCaller(history, SHOW.method, true);
		steps.open(SHOW.method);
		const opened = callers(history).at(-1);
		expect(opened?.getAttribute("method")).toBe(SHOW.method);
		expect(opened?.getAttribute("gwta")).toBe("show graph {name}");
		expect(opened?.getAttribute("call-index"), "the second caller of its method").toBe("1");
		expect(history.scrollToBottom).toHaveBeenCalled();
	});

	it("retargets the last caller that has not run rather than adding a second, and adds one for fixed arguments or a step run at once", async () => {
		const { history, steps } = await aStepsPage();
		const waiting = aCaller(history, SHOW.method, false);
		steps.open(LIST.method);
		expect(callers(history)).toHaveLength(1);
		expect(waiting.getAttribute("method")).toBe(LIST.method);
		expect(waiting.getAttribute("call-index")).toBe("0");
		expect(waiting.reset).toHaveBeenCalledWith(LIST.method);
		steps.open(SHOW.method, { name: "all" });
		steps.open(SHOW.method, undefined, true);
		expect(callers(history)).toHaveLength(3);
		expect(callers(history)[1].getAttribute("params")).toBe(JSON.stringify({ name: "all" }));
		expect(callers(history)[2].hasAttribute("auto")).toBe(true);
	});

	it("keeps the newest output in view when a caller's step succeeds or fails", async () => {
		const { host, history } = await aStepsPage();
		host.dispatchEvent(new CustomEvent(SHU_EVENT.STEP_SUCCESS));
		host.dispatchEvent(new CustomEvent(SHU_EVENT.STEP_ERROR));
		expect(history.scrollToBottom).toHaveBeenCalledTimes(2);
	});
});
