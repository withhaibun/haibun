/**
 * What a delegation names to let another party use the browser: one action for reading the page, one for acting on it,
 * and one for running `fetch` inside it, so a party given one of them can do nothing the others cover.
 */
import { describe, expect, it } from "vitest";
import { mayCall, requiredAction } from "@haibun/core/lib/actions.js";
import WebPlaywright, { WEB_PLAYWRIGHT_ACTIONS } from "./web-playwright.js";

const wp = new WebPlaywright();
const step = (name: string) => ({ capability: requiredAction("WebPlaywright", name, wp.steps[name]) });

describe("what a delegation names to use the browser", () => {
	it("groups reading the page, acting on it and fetching from it, each under one action", () => {
		for (const name of ["takeAccessibilitySnapshot", "takeScreenshot", "saveTextFrom", "seeText", "getPageContents"])
			expect(step(name).capability, name).toBe(WEB_PLAYWRIGHT_ACTIONS.read);
		for (const name of ["click", "gotoPage", "setValue", "onNewTab"]) expect(step(name).capability, name).toBe(WEB_PLAYWRIGHT_ACTIONS.act);
		for (const name of ["restEndpointRequest", "addAuthBearerToken", "restResponseIs"]) expect(step(name).capability, name).toBe(WEB_PLAYWRIGHT_ACTIONS.fetch);
	});

	it("lets a party that may read the page do nothing else with it, and no read of records reach it", () => {
		expect(mayCall([WEB_PLAYWRIGHT_ACTIONS.read], step("click"))).toBe(false);
		expect(mayCall([WEB_PLAYWRIGHT_ACTIONS.act], step("restEndpointRequest"))).toBe(false);
		expect(mayCall(["Read:private"], step("takeAccessibilitySnapshot")), "a snapshot of the page is the page's, not a record").toBe(false);
	});
});
