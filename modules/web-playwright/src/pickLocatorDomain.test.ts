import { describe, it, expect } from "vitest";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { domainParts } from "@haibun/core/lib/domains.js";
import { OK } from "@haibun/core/schema/protocol.js";
import { failWithDefaults, passWithDefaults } from "@haibun/core/lib/test/lib.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import { pickLocatorDomain } from "./web-playwright.js";
import { DOMAIN_PAGE_LOCATOR, DOMAIN_PAGE_TARGET, DOMAIN_PAGE_TEST_ID, DOMAIN_PAGE_TEXT, WebPlaywrightDomains } from "./domains.js";

const aimed: unknown[] = [];

class Targets extends AStepper implements IHasCycles {
	cycles: IStepperCycles = { getConcerns: () => ({ domains: WebPlaywrightDomains }) };
	steps: TStepperSteps = {
		aim: {
			gwta: `aim at {target: ${DOMAIN_PAGE_TARGET}}`,
			action: async ({ target }: { target: string }) => {
				await Promise.resolve();
				aimed.push(target);
				return OK;
			},
		},
	};
}

describe("how a place on a page is found", () => {
	it("finds a line's own words as the text a page shows, and a value of one way by that way", () => {
		expect(pickLocatorDomain(domainParts(DOMAIN_PAGE_TARGET))).toBe(DOMAIN_PAGE_TEXT);
		expect(pickLocatorDomain([DOMAIN_PAGE_TEST_ID, DOMAIN_PAGE_LOCATOR])).toBe(DOMAIN_PAGE_TEST_ID);
		expect(pickLocatorDomain([DOMAIN_PAGE_LOCATOR])).toBe(DOMAIN_PAGE_LOCATOR);
	});

	it("takes a line's own words and a value of any way a page is searched, and refuses a value of another domain", async () => {
		aimed.length = 0;
		const found = await passWithDefaults(
			[{ path: "/features/f.feature", content: 'set save as page-test-id to "save-button"\naim at save\naim at "Save"' }],
			[Targets, VariablesStepper],
		);
		expect(found.ok).toBe(true);
		expect(aimed).toEqual(["save-button", "Save"]);
		const refused = await failWithDefaults([{ path: "/features/f.feature", content: "set count as number to 3\naim at count" }], [Targets, VariablesStepper]);
		expect(refused.failure?.error.message).toMatch(/refuses count/);
	});
});
