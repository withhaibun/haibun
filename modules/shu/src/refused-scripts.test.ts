import { describe, it, expect } from "vitest";
import { refusal } from "./refused-scripts.js";

describe("a script the page's policy refused", () => {
	it("is stated by what was refused, the directive that refused it, and where", () => {
		expect(refusal({ blockedURI: "inline", effectiveDirective: "script-src-elem", sourceFile: "https://example.com/shu", lineNumber: 3 })).toBe(
			"the page's Content-Security-Policy (script-src-elem) refused an inline script or event handler attribute in https://example.com/shu:3",
		);
		expect(refusal({ blockedURI: "https://cdn.example.com/x.js", effectiveDirective: "script-src-elem", sourceFile: "", lineNumber: 0 })).toBe(
			"the page's Content-Security-Policy (script-src-elem) refused the script at https://cdn.example.com/x.js",
		);
	});
});
