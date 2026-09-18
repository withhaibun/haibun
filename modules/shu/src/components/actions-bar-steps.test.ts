// @vitest-environment jsdom
/**
 * The actions bar's step mode, held apart from the bar: the step options with those for the selected type first, a
 * caller opened in the history or the last one retargeted, the Ask mode offered only with the step an ask runs, and the
 * newest output kept in view as a step settles.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TStepDefinition } from "@haibun/core/lib/step-discovery.js";

/** The steps the run offers, and those it offers for the selected type. */
const offered: TStepDefinition[] = [];
const forTheType: TStepDefinition[] = [];
/** What is told when the page has read the run's steps again. */
const toldOfChanges = new Set<() => Promise<void> | void>();
vi.mock("../rpc-registry.js", async (actual) => ({
	...(await actual<Record<string, unknown>>()),
	getAvailableSteps: () => Promise.resolve(offered),
	onStepsChanged: (listener: () => Promise<void> | void) => {
		toldOfChanges.add(listener);
		return () => toldOfChanges.delete(listener);
	},
	stepsForContext: () => forTheType,
}));

const { ActionsBarSteps, stepDetails, stepOptions, stepSecondary } = await import("./actions-bar-steps.js");
const { aControllerHost } = await import("./controller-host.test-fake.js");
const { SHU_EVENT, SHU_TAG } = await import("../consts.js");

const step = (method: string, pattern: string, extra: Partial<TStepDefinition> = {}) =>
	({ method, stepName: method.split("-")[1], pattern, paramDomains: {}, ...extra }) as TStepDefinition;
const SHOW = step("GraphStepper-showGraph", "show graph {name}", { paramDomains: { name: "string" }, productsDomain: "graph" });
const LIST = step("GraphStepper-listTypes", "list types");
const ASK = step("LlmStepper-chatWithContext", "ask {prompt}");

/** The history callers open in, as the steps address it. */
type THistory = HTMLElement & { keepNewestInView: ReturnType<typeof vi.fn>; append: ReturnType<typeof vi.fn> };

async function aStepsPage(selectedLabel = "") {
	const host = aControllerHost();
	const held = document.createElement("div");
	// The history places an entry and keeps the newest in view through one method, as the element states it.
	const history = Object.assign(held, { keepNewestInView: vi.fn(), append: vi.fn((entry: HTMLElement) => held.appendChild(entry)) }) as THistory;
	host.append(history);
	const steps = new ActionsBarSteps(host, { testIdPrefix: () => "app-", selectedLabel: () => selectedLabel, history: history as never });
	host.connect();
	await steps.load();
	return { host, history, steps };
}

const callers = (history: HTMLElement) => Array.from(history.querySelectorAll(SHU_TAG.STEP_CALLER));
/** A caller already in the history, which has run its step or not. */
const aCaller = (history: HTMLElement, method: string, executed: boolean) => {
	const caller = Object.assign(document.createElement(SHU_TAG.STEP_CALLER), { executed });
	caller.setAttribute("method", method);
	history.append(caller);
	return caller;
};

describe("the actions bar's step mode", () => {
	beforeEach(() => {
		offered.splice(0, offered.length, SHOW, LIST);
		forTheType.length = 0;
	});

	it("offers the steps the run holds once the page has read them again", async () => {
		const { host, steps } = await aStepsPage();
		expect(steps.offersAsk).toBe(false);
		offered.push(ASK);
		const asked = host.updatesAsked;
		for (const told of toldOfChanges) await told();
		expect(host.updatesAsked).toBeGreaterThan(asked);
		expect(steps.offersAsk, "the step the run added is one the bar offers").toBe(true);
		host.disconnect();
		expect(toldOfChanges.size, "and a bar no longer shown is not told").toBe(0);
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
		expect(history.append, "the caller is placed by the history, which keeps the newest in view").toHaveBeenCalled();
	});

	it("replaces the last caller that has not run rather than adding a second, and adds one for fixed arguments or a step run at once", async () => {
		const { history, steps } = await aStepsPage();
		const waiting = aCaller(history, LIST.method, false);
		waiting.setAttribute("params", JSON.stringify({ name: "fixed" }));
		steps.open(LIST.method);
		expect(callers(history)).toHaveLength(1);
		expect(waiting.isConnected, "the caller that had not run is gone, with what was fixed for it").toBe(false);
		expect(callers(history)[0].getAttribute("method")).toBe(LIST.method);
		expect(callers(history)[0].hasAttribute("params")).toBe(false);
		expect(callers(history)[0].getAttribute("call-index"), "numbered among the callers left").toBe("0");
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
		expect(history.keepNewestInView).toHaveBeenCalledTimes(2);
	});
});
