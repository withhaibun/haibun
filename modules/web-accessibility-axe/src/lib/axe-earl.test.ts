import { describe, it, expect } from "vitest";
import { EARL_MODE, EARL_OUTCOME } from "./earl.js";
import { axeAssertions } from "./axe-earl.js";
import { axeResults, axeRule } from "./axe-results.test-fake.js";

const STEP = "1791034142780-1.0.1.2";
const SUMMARY = "Fix any of the following:\n  Element does not have an alt attribute";

const WCAG = ["wcag2a"];
const at = (target: string, failureSummary?: string) => ({ target, html: "<img>", ...(failureSummary ? { failureSummary } : {}) });
const results = axeResults("https://example.com/page", {
	violations: [axeRule("image-alt", "critical", WCAG, [at("#hero", SUMMARY), at("#logo", SUMMARY)])],
	incomplete: [axeRule("color-contrast", "serious", WCAG, [at("p")])],
	passes: [axeRule("document-title", null, WCAG, [at("html")]), axeRule("image-alt", null, WCAG, [at("#footer")])],
	inapplicable: [axeRule("video-caption", null, WCAG, [])],
});

describe("axeAssertions", () => {
	const earl = axeAssertions(results, STEP);
	it("states the assertor at its version, the page as the subject, and the step that made them", () => {
		expect(earl.assertor).toEqual({ id: "https://github.com/dequelabs/axe-core/releases/tag/v4.13.0", name: "axe-core 4.13.0" });
		expect(earl.subject).toEqual({ id: results.url, url: results.url });
		expect([earl.mode, earl.step]).toEqual([EARL_MODE.automatic, STEP]);
	});
	it("states each rule's outcome as EARL defines it, a rule that needs review as one it can't tell, and doesn't record a rule that doesn't apply", () => {
		expect(earl.results.map(({ test, result }) => [test.name, result.outcome])).toEqual([
			["image-alt help", EARL_OUTCOME.failed],
			["color-contrast help", EARL_OUTCOME.cantTell],
			["document-title help", EARL_OUTCOME.passed],
		]);
	});
	it("states one result for a rule axe lists under several outcomes, the most severe, at the elements it has that outcome at", () => {
		expect(earl.results.filter(({ test }) => test.name === "image-alt help")).toEqual([earl.results[0]]);
		expect(earl.results[0].result.pointers).toEqual(["#hero", "#logo"]);
	});
	it("doesn't record an address of a scheme other than the web's as a link, since the checked page supplies it", () => {
		const SCRIPT = "javascript:alert(1)";
		const scripted = axeAssertions(axeResults(SCRIPT, { violations: [{ ...axeRule("image-alt", "serious", WCAG, [at("#hero")]), helpUrl: SCRIPT }], incomplete: [], passes: [], inapplicable: [] }), STEP);
		expect(scripted.subject).toEqual({ id: SCRIPT });
		expect(scripted.results[0].test.url).toBeUndefined();
	});
	it("names a rule by its guidance's address without the query, and keeps the guidance's own link", () => {
		expect(earl.results[0].test).toEqual({
			id: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
			name: "image-alt help",
			description: "image-alt description",
			url: "https://dequeuniversity.com/rules/axe/4.13/image-alt?application=axeAPI",
			tags: ["wcag2a"],
		});
	});
	it("points at each element a rule found, and states what fails there once", () => {
		expect(earl.results[0].result).toEqual({ outcome: EARL_OUTCOME.failed, info: SUMMARY, pointers: ["#hero", "#logo"], impact: "critical" });
		expect(earl.results[2].result).toEqual({ outcome: EARL_OUTCOME.passed, pointers: ["html"] });
	});
});
