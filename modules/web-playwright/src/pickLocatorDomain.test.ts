import { describe, it, expect } from "vitest";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { domainParts } from "@haibun/core/lib/domains.js";
import { OK, type TStepValue } from "@haibun/core/schema/protocol.js";
import { failWithDefaults, passWithDefaults } from "@haibun/core/lib/test/lib.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import { locatorDomainOf, pickLocatorDomain } from "./web-playwright.js";
import { DOMAIN_PAGE_LOCATOR, DOMAIN_PAGE_TARGET, DOMAIN_PAGE_TEST_ID, DOMAIN_PAGE_TEXT, WebPlaywrightDomains } from "./domains.js";

const aimed: unknown[] = [];

class Targets extends AStepper implements IHasCycles {
	cycles: IStepperCycles = { getConcerns: () => ({ domains: WebPlaywrightDomains }) };
	steps: TStepperSteps = {
		aim: {
			gwta: `aim at {target: ${DOMAIN_PAGE_TARGET}}`,
			action: async ({ target }: { target: TStepValue }) => {
				await Promise.resolve();
				aimed.push(target);
				return OK;
			},
		},
	};
}

describe("how a place on a page is found", () => {
	it("selects page text for a literal's union domain, and the specific locator domain a union contains otherwise", () => {
		expect(pickLocatorDomain(domainParts(DOMAIN_PAGE_TARGET))).toBe(DOMAIN_PAGE_TEXT);
		expect(pickLocatorDomain([DOMAIN_PAGE_TEST_ID, DOMAIN_PAGE_LOCATOR])).toBe(DOMAIN_PAGE_TEST_ID);
		expect(pickLocatorDomain([DOMAIN_PAGE_LOCATOR])).toBe(DOMAIN_PAGE_LOCATOR);
	});

	it("passes a page target as a TStepValue with its locator domain, and refuses a value of another domain", async () => {
		aimed.length = 0;
		const found = await passWithDefaults(
			[{ path: "/features/f.feature", content: 'set save as page-test-id to "save-button"\naim at save\naim at "Save"' }],
			[Targets, VariablesStepper],
		);
		expect(found.ok).toBe(true);
		expect(aimed.map((target) => ({ value: (target as TStepValue).value, locatorDomain: locatorDomainOf(target as TStepValue) }))).toEqual([
			{ value: "save-button", locatorDomain: DOMAIN_PAGE_TEST_ID },
			{ value: "Save", locatorDomain: DOMAIN_PAGE_TEXT },
		]);
		const refused = await failWithDefaults([{ path: "/features/f.feature", content: "set count as number to 3\naim at count" }], [Targets, VariablesStepper]);
		expect(refused.failure?.error.message).toMatch(/refuses count/);
	});
});
