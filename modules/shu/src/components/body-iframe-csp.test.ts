import { describe, it, expect } from "vitest";
import { buildBodyIframeDoc } from "./shu-entity-column.js";

describe("buildBodyIframeDoc network policy", () => {
	it("markdown bodies render network-free: strict CSP, no remote images/fonts/scripts/fetches", () => {
		const doc = buildBodyIframeDoc("<p>hi</p>", "text/markdown");
		expect(doc).toContain("Content-Security-Policy");
		expect(doc).toContain("default-src 'none'");
		expect(doc).toContain("img-src data:");
	});

	it("plain bodies are also network-free", () => {
		expect(buildBodyIframeDoc("<pre>x</pre>", "text/plain")).toContain("Content-Security-Policy");
	});

	it("html bodies (the original message) allow network — no CSP restricting remote assets", () => {
		const doc = buildBodyIframeDoc("<p>hi</p>", "text/html");
		expect(doc).not.toContain("Content-Security-Policy");
	});
});
