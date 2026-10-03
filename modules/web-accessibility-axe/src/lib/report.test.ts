import { describe, it, expect } from "vitest";
import type { AxeResults, Result } from "axe-core";
import { axeReportHtml } from "./report.js";

/** Markup the checked page supplies, which the report shows as text. */
const HOSTILE = `<img src=x onerror="alert(1)"><script src="https://example.com/x.js"></script>`;

const rule = (id: string, impact: Result["impact"]): Result => ({
	id,
	impact,
	tags: [],
	description: `${id} description`,
	help: `${id} help`,
	helpUrl: `https://dequeuniversity.com/rules/axe/4.13/${id}`,
	nodes: [{ html: HOSTILE, target: [`#${id}`], failureSummary: `Fix ${HOSTILE}`, impact, any: [], all: [], none: [] }],
});

const results: AxeResults = {
	toolOptions: {},
	testEngine: { name: "axe-core", version: "4.13.0" },
	testRunner: { name: "axe" },
	testEnvironment: { userAgent: "test", windowWidth: 800, windowHeight: 600 },
	url: "https://example.com/?q=<b>",
	timestamp: "2026-10-03T00:00:00.000Z",
	violations: [rule("image-alt", "serious")],
	incomplete: [rule("color-contrast", "moderate")],
	passes: [rule("document-title", null)],
	inapplicable: [],
};

describe("axeReportHtml", () => {
	const html = axeReportHtml(results);
	it("shows what the checked page supplies as text", () => {
		expect(html).not.toContain(HOSTILE);
		expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
		expect(html).toContain("https://example.com/?q=&lt;b&gt;");
	});
	it("holds no script and loads nothing", () => {
		expect(html).not.toMatch(/<(script|link)\b/i);
		expect(html).not.toMatch(/<[a-z][^>]*\s(src|srcset)=/i);
	});
	it("opens the violations and keeps the other outcomes closed", () => {
		expect(html).toMatch(/<details open><summary>Violations \(1\)<\/summary><details open><summary>serious: image-alt help/);
		expect(html).toMatch(/<details><summary>Needs review \(1\)<\/summary><details><summary>moderate: color-contrast help/);
		expect(html).toMatch(/<details><summary>Passes \(1\)<\/summary><details><summary>document-title help/);
		expect(html).toContain("<details><summary>Inapplicable (0)</summary></details>");
	});
	it("links each rule to its guidance in a tab of its own", () => {
		expect(html).toContain(`<a href="https://dequeuniversity.com/rules/axe/4.13/image-alt" target="_blank" rel="noopener noreferrer">Guidance</a>`);
	});
});
