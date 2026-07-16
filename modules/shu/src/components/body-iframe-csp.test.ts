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

	it("html bodies (the original message) allow network: no CSP restricting remote assets", () => {
		const doc = buildBodyIframeDoc("<p>hi</p>", "text/html");
		expect(doc).not.toContain("Content-Security-Policy");
	});

	// A body's `#` links (a view: `#?col=...`; a record: `#Type:id`) must reach the app, not the sandboxed data:
	// document they render in. The base re-roots them against the app's address and targets the top frame, and the
	// CSP's base-uri admits exactly that origin, so the base is honoured while no other base could be injected.
	it("with a page URL, links re-root against the app and open in the top frame", () => {
		const doc = buildBodyIframeDoc("<p>hi</p>", "text/markdown", "http://localhost:8235/credentials?x=1");
		expect(doc).toContain('<base href="http://localhost:8235/credentials?x=1" target="_top">');
		expect(doc).toContain("base-uri http://localhost:8235;");
		expect(doc).not.toContain("base-uri 'none'");
	});

	it("without a page URL there is no base and base-uri stays 'none'", () => {
		const doc = buildBodyIframeDoc("<p>hi</p>", "text/markdown");
		expect(doc).not.toContain("<base");
		expect(doc).toContain("base-uri 'none'");
	});

	it("escapes the page URL it embeds, so a crafted address cannot break out of the base attribute", () => {
		const doc = buildBodyIframeDoc("<p>hi</p>", "text/markdown", 'http://localhost:8235/a?q="><script>1</script>');
		expect(doc).not.toContain('"><script>');
	});
});
