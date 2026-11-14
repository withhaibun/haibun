import { describe, it, expect } from "vitest";
import { AStepper, type IHasCycles, type IStepperCycles } from "@haibun/core/lib/astepper.js";
import { domainParts } from "@haibun/core/lib/domains/domains.js";
import { OK, type TStepValue } from "@haibun/core/lib/domains/protocol.js";
import { failWithDefaults, passWithDefaults } from "@haibun/core/lib/test/lib.js";
import LogicStepper from "@haibun/logic/logic-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import { locatorOf, pickLocator, wayLocator } from "./locators.js";
import { DOMAIN_PAGE_LOCATOR, DOMAIN_PAGE_TARGET, DOMAIN_PAGE_TEST_ID, DOMAIN_PAGE_TEXT, WebPlaywrightDomains } from "../domains/web-playwright.js";
import { TEST_STEP } from "@haibun/core/lib/test/test-step.js";
import { declareSteps } from "@haibun/core/lib/steps/domains/stepper.js";

const aimed: unknown[] = [];

class Targets extends AStepper implements IHasCycles {
	description = "A step that aims at a page target and records the value it receives.";
	cycles: IStepperCycles = { getConcerns: () => ({ domains: WebPlaywrightDomains }) };
	steps = declareSteps({
		aim: {
			description: TEST_STEP,
			gwta: `aim at {target: ${DOMAIN_PAGE_TARGET}}`,
			action: async ({ target }) => {
				await Promise.resolve();
				aimed.push(target);
				return OK;
			},
		},
	});
}

describe("how a place on a page is found", () => {
	it("selects page text for a literal's union domain, and the specific locator domain a union contains otherwise", () => {
		expect(pickLocator(domainParts(DOMAIN_PAGE_TARGET)).domain).toBe(DOMAIN_PAGE_TEXT);
		expect(pickLocator([DOMAIN_PAGE_TEST_ID, DOMAIN_PAGE_LOCATOR]).domain).toBe(DOMAIN_PAGE_TEST_ID);
		expect(pickLocator([DOMAIN_PAGE_LOCATOR]).domain).toBe(DOMAIN_PAGE_LOCATOR);
		expect(() => pickLocator(["number"])).toThrow(/doesn't contain a locator domain/);
	});

	it("names a Playwright method and prefix for each way a click finds, and only an accessibility snapshot's reference takes a prefix", () => {
		expect(wayLocator("reference")).toMatchObject({ method: "locator", prefix: "aria-ref=" });
		expect(wayLocator("test id")).toMatchObject({ domain: DOMAIN_PAGE_TEST_ID, method: "getByTestId", prefix: "" });
	});

	it("passes a page target as a TStepValue with its locator domain, and refuses a value of another domain", async () => {
		aimed.length = 0;
		const found = await passWithDefaults(
			[{ path: "/features/f.feature", content: 'set save as page-test-id to "save-button"\nset s as string to "Saved"\naim at save\naim at "Save"\naim at s' }],
			[Targets, VariablesStepper, LogicStepper],
		);
		expect(found.ok).toBe(true);
		expect(aimed.map((target) => ({ value: (target as TStepValue).value, locatorDomain: locatorOf(target as TStepValue).domain }))).toEqual([
			{ value: "save-button", locatorDomain: DOMAIN_PAGE_TEST_ID },
			{ value: "Save", locatorDomain: DOMAIN_PAGE_TEXT },
			{ value: "Saved", locatorDomain: DOMAIN_PAGE_TEXT },
		]);
		const refused = await failWithDefaults([{ path: "/features/f.feature", content: "set count as number to 3\naim at count" }], [Targets, VariablesStepper, LogicStepper]);
		expect(refused.failure?.error.message).toMatch(/refuses count/);
	});
});
