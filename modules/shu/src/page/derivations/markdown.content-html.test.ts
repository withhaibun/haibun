import { describe, it, expect } from "vitest";
import { renderContentHtml, type TRefContext } from "./markdown.js";

/** A reference context that doesn't name a type or a relation. */
const REFS: TRefContext = { isType: () => false, propertyDefinition: () => undefined };

describe("renderContentHtml", () => {
	it("renders markdown inline HTML (e.g. <br> from HTML-derived email markdown) instead of escaping it", () => {
		const out = renderContentHtml("line one<br>line two", "text/markdown", REFS);
		expect(out).toContain("<br>");
		expect(out).not.toContain("&lt;br&gt;");
	});

	it("renders markdown emphasis and links, and linkifies bare URLs", () => {
		const out = renderContentHtml("**bold** and [text](https://example.com) and https://bare.example", "text/markdown", REFS);
		expect(out).toContain("<strong>bold</strong>");
		expect(out).toContain('href="https://example.com"');
		expect(out).toContain('href="https://bare.example"');
	});

	it("passes text/html through unchanged", () => {
		expect(renderContentHtml("<p>hi</p>", "text/html", REFS)).toBe("<p>hi</p>");
	});

	it("escapes text/plain inside a pre block", () => {
		const out = renderContentHtml("<not a tag>", "text/plain", REFS);
		expect(out).toContain("&lt;not a tag&gt;");
		expect(out).toContain("<pre");
	});

	it("pretty-prints application/ld+json (credential claims) with indentation", () => {
		const out = renderContentHtml('{"sector":"unlicensed","commune":"Sledge"}', "application/ld+json", REFS);
		expect(out).toMatch(/\{\n {2}/); // opening brace then a newline + 2-space indent, not the compact single line
		expect(out).toContain("sector");
		expect(out).not.toContain('{"sector"');
	});

	it("shows malformed JSON verbatim rather than throwing", () => {
		const out = renderContentHtml("{not valid json", "application/json", REFS);
		expect(out).toContain("{not valid json");
	});
});
