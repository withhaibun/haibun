// @vitest-environment jsdom
// jsdom: refLinksPlugin imports renderRef from shu-ref, which defines a custom element (extends HTMLElement).
import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import { parseRefHref, refLinksPlugin } from "./markdown-refs.js";

const isType = (name: string) => name === "VerifiableCredential" || name === "VerifiablePresentation";

describe("parseRefHref", () => {
	it("reads #Type as a domain reference when Type is known", () => {
		expect(parseRefHref("#VerifiableCredential", isType)).toEqual({ kind: "domain", target: { domain: "VerifiableCredential" } });
	});

	it("reads #Type:id as an individual, splitting on the FIRST colon so a DID id survives", () => {
		expect(parseRefHref("#VerifiableCredential:did:example:vc-1", isType)).toEqual({ kind: "entity", target: { persistedAs: "VerifiableCredential", id: "did:example:vc-1" } });
	});

	it("leaves an ordinary in-page anchor alone (unknown type) and ignores non-# hrefs", () => {
		expect(parseRefHref("#introduction", isType)).toBeNull();
		expect(parseRefHref("#Unknown:x", isType)).toBeNull();
		expect(parseRefHref("https://example.com", isType)).toBeNull();
		expect(parseRefHref("#", isType)).toBeNull();
	});
});

describe("refLinksPlugin", () => {
	const md = new MarkdownIt();
	refLinksPlugin(md, isType);

	it("rewrites a type-reference link into a shu-ref carrying the link text, leaving plain links untouched", () => {
		const html = md.renderInline("A [Verifiable Credential](#VerifiableCredential) and [an anchor](#intro) and [ext](https://x.test).");
		expect(html).toContain('<shu-ref kind="domain"');
		expect(html).toContain('text="Verifiable Credential"');
		expect(html).toContain("&quot;domain&quot;:&quot;VerifiableCredential&quot;"); // the linkTarget JSON, attribute-escaped
		expect(html).toContain('<a href="#intro">an anchor</a>'); // ordinary anchor preserved
		expect(html).toContain('<a href="https://x.test">ext</a>');
	});

	it("rewrites an individual reference to an entity shu-ref", () => {
		const html = md.renderInline("[this VC](#VerifiableCredential:did:example:vc-1)");
		expect(html).toContain('<shu-ref kind="entity"');
		expect(html).toContain("&quot;persistedAs&quot;:&quot;VerifiableCredential&quot;");
		expect(html).toContain("&quot;id&quot;:&quot;did:example:vc-1&quot;");
	});
});
