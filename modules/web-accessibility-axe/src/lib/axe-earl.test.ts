import { describe, it, expect } from "vitest";
import type { AxeResults, Result } from "axe-core";
import { EARL_MODE, EARL_OUTCOME } from "./earl.js";
import { axeAssertions } from "./axe-earl.js";

const STEP = "1791034142780-1.0.1.2";
const SUMMARY = "Fix any of the following:\n  Element does not have an alt attribute";

const rule = (id: string, impact: Result["impact"], nodes: { target: string; failureSummary?: string }[]): Result => ({
	id,
	impact,
	tags: ["wcag2a"],
	description: `${id} description`,
	help: `${id} help`,
	helpUrl: `https://dequeuniversity.com/rules/axe/4.13/${id}?application=axeAPI`,
	nodes: nodes.map(({ target, failureSummary }) => ({ html: "<img>", target: [target], failureSummary, impact, any: [], all: [], none: [] })),
});

const results: AxeResults = {
	toolOptions: {},
	testEngine: { name: "axe-core", version: "4.13.0" },
	testRunner: { name: "axe" },
	testEnvironment: { userAgent: "test", windowWidth: 800, windowHeight: 600 },
	url: "https://example.com/page",
	timestamp: "2026-10-03T00:00:00.000Z",
	violations: [
		rule("image-alt", "critical", [
			{ target: "#hero", failureSummary: SUMMARY },
			{ target: "#logo", failureSummary: SUMMARY },
		]),
	],
	incomplete: [rule("color-contrast", "serious", [{ target: "p" }])],
	passes: [rule("document-title", null, [{ target: "html" }]), rule("image-alt", null, [{ target: "#footer" }])],
	inapplicable: [rule("video-caption", null, [])],
};

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
