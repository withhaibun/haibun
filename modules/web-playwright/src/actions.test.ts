/**
 * What a delegation names to let another party use the browser: one action for reading the page, one for acting on it,
 * and one for running `fetch` inside it, so a party given one of them can't do what the others cover.
 */
import { describe, expect, it } from "vitest";
import { mayCall, readAction, requiredAction } from "@haibun/core/lib/actions.js";
import { Access } from "@haibun/core/lib/resources.js";
import WebPlaywright from "./web-playwright.js";
import { READS_THE_PAGE, WEB_PLAYWRIGHT, WEB_PLAYWRIGHT_ACTIONS } from "./actions.js";

const wp = new WebPlaywright();
const step = (name: string) => ({ capability: requiredAction(WEB_PLAYWRIGHT, name, wp.steps[name]), readsAt: wp.steps[name].readsAt });

describe("what a delegation names to use the browser", () => {
	it("groups reading the page, acting on it and fetching from it, each under one action", () => {
		expect(wp.constructor.name, "the name its steps' methods begin with").toBe(WEB_PLAYWRIGHT);
		for (const name of [READS_THE_PAGE, "takeScreenshot", "saveTextFrom", "seeText", "getPageContents"]) expect(step(name).capability, name).toBe(WEB_PLAYWRIGHT_ACTIONS.read);
		for (const name of ["click", "gotoPage", "setValue", "onNewTab"]) expect(step(name).capability, name).toBe(WEB_PLAYWRIGHT_ACTIONS.act);
		for (const name of ["restEndpointRequest", "addAuthBearerToken", "restResponseIs"]) expect(step(name).capability, name).toBe(WEB_PLAYWRIGHT_ACTIONS.fetch);
	});

	it("lets a party that may read the page do only that with it, and doesn't let a read of records reach it", () => {
		expect(mayCall([WEB_PLAYWRIGHT_ACTIONS.read], step("click"))).toBe(false);
		expect(mayCall([WEB_PLAYWRIGHT_ACTIONS.act], step("restEndpointRequest"))).toBe(false);
		expect(mayCall(["Read:private"], step(READS_THE_PAGE)), "a snapshot of the page is the page's, not a record").toBe(false);
	});

	it("reads the page as a private read, since the page is the person's own", () => {
		expect(mayCall([WEB_PLAYWRIGHT_ACTIONS.read, readAction(Access.public)], step(READS_THE_PAGE)), "a caller reading at public").toBe(false);
		expect(mayCall([WEB_PLAYWRIGHT_ACTIONS.read, readAction(Access.private)], step(READS_THE_PAGE))).toBe(true);
		expect(step("takeScreenshot").readsAt).toBe(Access.private);
	});
});
