// @vitest-environment jsdom
/**
 * The actions bar's step mode, held apart from the bar: the step options with those for the selected type first, a
 * caller opened in the history or the last one retargeted, the Ask mode offered only with the step an ask runs, and the
 * newest output kept in view as a step settles. A statement typed in the selector opens the step it states, holding its terms.
 * A waypoint's head is offered beside the steps, marked with the library that states it, and opens the step that ensures it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { SHOW_STEP_DEFINITIONS_METHOD, VALIDATE_STEP_METHOD, type TPredicate, type TStepDefinition } from "@haibun/core/lib/step-discovery.js";
import { html, render } from "lit";
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";
import { CHAT_DECLARED, CHAT_DOMAINS, CHAT_STEP, CHAT_STEPPER } from "../ask/components/chat-pane.test-fake.js";
import { ActionsBarSteps, stepDetails, stepOptions, stepSecondary, waypointOptions } from "./actions-bar-steps.js";
import type { ShuStepCaller } from "./shu-step-caller.js";
import { provideLayout } from "../../test/jsdom-layout.js";
import { aControllerHost } from "./controller-host.test-fake.js";
import { SHU_EVENT, SHU_TAG } from "../../domains/elements.js";
import { declaringSteps, setupShuTest, stepsChanged, stepsReadAgain, stepsShown, type TShuTestHandle } from "../../test/setup.js";

/** The steps actuality offers. */
const offered: TStepDefinition[] = [];
/** A page on a run that offers the steps `offered` holds when the page reads them. */
const anActuality = () => setupShuTest({ dispatch: declaringSteps(() => stepsShown(offered, CHAT_DOMAINS)) });

const step = (method: string, pattern: string, extra: Partial<TStepDefinition> = {}) => {
	const [stepperName, stepName] = method.split("-");
	return { method, stepperName, stepName, pattern, paramDomains: {}, ...extra } as TStepDefinition;
};
const SHOW = step("GraphStepper-showGraph", "show graph {name}", { paramDomains: { name: "string" }, productsDomain: "graph" });
const LIST = step("GraphStepper-listTypes", "list types");
const ASK = step(stepMethodName(CHAT_STEPPER, CHAT_STEP.ask), "ask {prompt}", CHAT_DECLARED[CHAT_STEP.ask]);

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
/** A caller already in the history, which has called its step or not. A call this page's run refuses is still a call. */
async function aCaller(history: HTMLElement, method: string, executed: boolean): Promise<ShuStepCaller> {
	const caller = document.createElement(SHU_TAG.STEP_CALLER) as ShuStepCaller;
	caller.setAttribute("step", method);
	caller.setAttribute("method", method);
	history.append(caller);
	await new Promise((resolve) => setTimeout(resolve, 0));
	if (executed) await caller.callStep({ name: "all" });
	expect(caller.executed).toBe(executed);
	return caller;
}

describe("the actions bar's step mode", () => {
	let t: TShuTestHandle;
	beforeEach(() => {
		provideLayout();
		offered.splice(0, offered.length, SHOW, LIST);
		t = anActuality();
	});
	afterEach(() => t.teardown());

	it("offers the steps actuality holds once the page has read them again", async () => {
		const { host, steps } = await aStepsPage();
		expect(steps.offersAsk).toBe(false);
		offered.push(ASK);
		const asked = host.updatesAsked;
		const added = stepsReadAgain();
		stepsChanged(t, 1);
		await added;
		expect(host.updatesAsked).toBeGreaterThan(asked);
		expect(steps.offersAsk, "the step actuality added is one the bar offers").toBe(true);
		host.disconnect();
		const shown = host.updatesAsked;
		offered.pop();
		const removed = stepsReadAgain();
		stepsChanged(t, 2);
		await removed;
		expect(host.updatesAsked, "and a bar no longer shown isn't updated").toBe(shown);
		expect(steps.offersAsk).toBe(true);
	});

	it("states what a step takes and gives, by domain", () => {
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

	it("offers the ask mode only where actuality offers the step an ask runs", async () => {
		expect((await aStepsPage()).steps.offersAsk).toBe(false);
		t.teardown();
		offered.push(ASK);
		t = anActuality();
		expect((await aStepsPage()).steps.offersAsk).toBe(true);
	});

	it("opens a caller for a picked step in the history, numbered among the callers of its method, and keeps it in view", async () => {
		const { history, steps } = await aStepsPage();
		await aCaller(history, SHOW.method, true);
		steps.open(SHOW.method, {});
		const opened = callers(history).at(-1);
		expect(opened?.getAttribute("method")).toBe(SHOW.method);
		expect(opened?.getAttribute("call-index"), "the second caller of its method").toBe("1");
		expect(history.append, "the caller is placed by the history, which keeps the newest in view").toHaveBeenCalled();
	});

	it("replaces the last caller that has not run rather than adding a second, and adds one for fixed arguments or a step run at once", async () => {
		const { history, steps } = await aStepsPage();
		const waiting = await aCaller(history, LIST.method, false);
		waiting.setAttribute("params", JSON.stringify({ name: "fixed" }));
		steps.open(LIST.method, {});
		expect(callers(history)).toHaveLength(1);
		expect(waiting.isConnected, "the caller that had not run is gone, with what was fixed for it").toBe(false);
		expect(itemAt(callers(history), 0).getAttribute("method")).toBe(LIST.method);
		expect(itemAt(callers(history), 0).hasAttribute("params")).toBe(false);
		expect(itemAt(callers(history), 0).getAttribute("call-index"), "numbered among the callers left").toBe("0");
		steps.open(SHOW.method, { args: { name: "all" } });
		steps.open(SHOW.method, { auto: true });
		expect(callers(history)).toHaveLength(3);
		expect(itemAt(callers(history), 1).getAttribute("params")).toBe(JSON.stringify({ name: "all" }));
		expect(itemAt(callers(history), 2).hasAttribute("auto")).toBe(true);
	});

	it("keeps the newest output in view when a caller's step succeeds or fails", async () => {
		const { host, history } = await aStepsPage();
		host.dispatchEvent(new CustomEvent(SHU_EVENT.STEP_SUCCESS));
		host.dispatchEvent(new CustomEvent(SHU_EVENT.STEP_ERROR));
		expect(history.keepNewestInView).toHaveBeenCalledTimes(2);
	});
});

describe("a statement typed in step mode", () => {
	const VALIDATE = step(VALIDATE_STEP_METHOD, "validate step {text}", { paramDomains: { text: "text" }, read: true, readsAt: "public" });
	const STATED = "show graph all";
	let t: TShuTestHandle;
	beforeEach(() => {
		provideLayout();
		offered.splice(0, offered.length, SHOW, VALIDATE);
		t = setupShuTest({
			dispatch: (method, params) => {
				if (method === SHOW_STEP_DEFINITIONS_METHOD) return stepsShown(offered, CHAT_DOMAINS);
				if (method !== VALIDATE_STEP_METHOD) throw new Error(`unexpected ${method}`);
				return params.text === STATED ? { valid: true, method: SHOW.method, values: { name: "all" } } : { valid: false, error: `"${String(params.text)}" doesn't match a step` };
			},
		});
	});
	afterEach(() => t.teardown());

	/** Types `text` in the step selector and picks it as the new value it offers. */
	async function typed(text: string) {
		const page = await aStepsPage();
		render(page.steps.template(html``), page.host);
		page.host.querySelector(".step-combo")?.dispatchEvent(new CustomEvent("combo-change", { detail: { value: text } }));
		await vi.waitFor(() => expect(page.history.children.length).toBe(1));
		return page;
	}

	it("opens a caller for the step the statement states, its inputs starting with the statement's terms", async () => {
		const { history } = await typed(STATED);
		const caller = itemAt(callers(history), 0) as ShuStepCaller;
		expect(caller.getAttribute("method")).toBe(SHOW.method);
		expect(caller.values).toEqual({ name: "all" });
	});

	it("states why in the history where the statement doesn't resolve to one step", async () => {
		const { history } = await typed("show nothing at all");
		expect(callers(history)).toEqual([]);
		expect(history.querySelector(SHU_TAG.REFUSAL)).not.toBeNull();
	});
});

describe("a waypoint's head in step mode", () => {
	const ENSURE = step("ActivitiesStepper-ensure", "ensure {outcome}", { paramDomains: { outcome: "statement" } });
	const HEAD = "view {view} is scrolled to its end";
	const RULE: TPredicate = { name: HEAD, parts: [{ name: "view", domain: "waypoint-argument" }], line: HEAD, method: "ActivitiesStepper-apply", waypoint: "@haibun/shu" };
	const STEP: TPredicate = { name: SHOW.method, parts: [{ name: "name", domain: "string" }], line: SHOW.pattern, method: SHOW.method };
	let t: TShuTestHandle;
	beforeEach(() => {
		provideLayout();
		offered.splice(0, offered.length, SHOW, ENSURE);
		t = setupShuTest({ dispatch: declaringSteps(() => ({ ...stepsShown(offered, CHAT_DOMAINS), predicates: [STEP, RULE] })) });
	});
	afterEach(() => t.teardown());

	it("offers each waypoint's head as a sentence, marked as a waypoint with the library that states it, and not a step's predicate", () => {
		expect(waypointOptions([STEP, RULE])).toEqual([{ value: HEAD, label: HEAD, secondary: "waypoint · @haibun/shu" }]);
	});

	it("offers the heads beside the steps, and opens a pick of one as the statement of the step that ensures it", async () => {
		const page = await aStepsPage();
		render(page.steps.template(html``), page.host);
		const selector = page.host.querySelector(".step-combo") as HTMLElement & { options: { value: string; secondary?: string }[] };
		expect(selector.options.map((o) => [o.value, o.secondary])).toContainEqual([HEAD, "waypoint · @haibun/shu"]);
		selector.dispatchEvent(new CustomEvent("combo-change", { detail: { value: HEAD } }));
		const caller = itemAt(callers(page.history), 0);
		expect(caller.getAttribute("method")).toBe(ENSURE.method);
		expect(caller.getAttribute("params")).toBe(JSON.stringify({ outcome: HEAD }));
	});
});
