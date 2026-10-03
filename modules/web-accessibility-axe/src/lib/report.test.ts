import { describe, it, expect } from "vitest";
import { axeReportHtml } from "./report.js";
import { axeResults, axeRule } from "./axe-results.test-fake.js";

/** Markup the checked page supplies, which the report shows as text. */
const HOSTILE = `<img src=x onerror="alert(1)"><script src="https://example.com/x.js"></script>`;

const found = (id: string) => [{ target: `#${id}`, html: HOSTILE, failureSummary: `Fix ${HOSTILE}` }];
const results = axeResults("https://example.com/?q=<b>", {
	violations: [axeRule("image-alt", "serious", [], found("image-alt"))],
	incomplete: [axeRule("color-contrast", "moderate", [], found("color-contrast"))],
	passes: [axeRule("document-title", null, [], found("document-title"))],
	inapplicable: [],
});

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
	it("shows an address of a scheme other than the web's as text, since the checked page supplies it", () => {
		const SCRIPT = "javascript:alert(1)";
		const scripted = axeReportHtml(axeResults(SCRIPT, { violations: [{ ...axeRule("image-alt", "serious", [], found("image-alt")), helpUrl: SCRIPT }], incomplete: [], passes: [], inapplicable: [] }));
		expect(scripted).not.toContain(`href="${SCRIPT}`);
		expect(scripted).toContain(SCRIPT);
	});
	it("links each rule to its guidance in a tab of its own", () => {
		expect(html).toContain(`<a href="https://dequeuniversity.com/rules/axe/4.13/image-alt?application=axeAPI" target="_blank" rel="noopener noreferrer">Guidance</a>`);
	});
});
