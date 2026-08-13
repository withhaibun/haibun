// @vitest-environment jsdom
// jsdom: refLinksPlugin imports renderRef from shu-ref, which defines a custom element (extends HTMLElement).
import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import { refLinksPlugin, renderRefProse } from "./markdown-refs.js";
import { parseRefHref } from "@haibun/core/lib/typed-links.js";

const isType = (name: string) => name === "FieldReport" || name === "SiteSurvey";

describe("parseRefHref", () => {
	it("reads #Type as a domain reference when Type is known", () => {
		expect(parseRefHref("#FieldReport", isType)).toEqual({ kind: "domain", target: { domain: "FieldReport" } });
	});

	it("reads #Type:id as an individual, splitting on the FIRST colon so a DID id survives", () => {
		expect(parseRefHref("#FieldReport:did:example:report-1", isType)).toEqual({ kind: "entity", target: { persistedAs: "FieldReport", id: "did:example:report-1" } });
	});

	it("leaves an ordinary in-page anchor alone (unknown type) and ignores non-# hrefs", () => {
		expect(parseRefHref("#introduction", isType)).toBeNull();
		expect(parseRefHref("#Unknown:x", isType)).toBeNull();
		expect(parseRefHref("https://example.com", isType)).toBeNull();
		expect(parseRefHref("#", isType)).toBeNull();
	});

	it("reads a Text Fragment directive on an individual ref as a quote selector", () => {
		expect(parseRefHref("#FieldReport:r1:~:text=11.1.29%20The%20Verifier", isType)).toEqual({
			kind: "entity",
			target: { persistedAs: "FieldReport", id: "r1", selector: { exact: "11.1.29 The Verifier" } },
		});
	});

	it("reads prefix- and -suffix parts, classifying marker dashes before percent-decoding", () => {
		expect(parseRefHref("#FieldReport:r1:~:text=before-,exact%2C%20quote,-after", isType)).toEqual({
			kind: "entity",
			target: { persistedAs: "FieldReport", id: "r1", selector: { exact: "exact, quote", prefix: "before", suffix: "after" } },
		});
	});

	it("keeps the individual ref but drops the selector for a range directive (no TextQuoteSelector form)", () => {
		expect(parseRefHref("#FieldReport:r1:~:text=start,end", isType)).toEqual({ kind: "entity", target: { persistedAs: "FieldReport", id: "r1" } });
	});

	it("splits the id before the directive so a DID id with a selector survives", () => {
		expect(parseRefHref("#FieldReport:did:example:r1:~:text=quoted", isType)).toEqual({
			kind: "entity",
			target: { persistedAs: "FieldReport", id: "did:example:r1", selector: { exact: "quoted" } },
		});
	});
});

describe("refLinksPlugin", () => {
	const md = new MarkdownIt();
	refLinksPlugin(md, isType);

	it("rewrites a type-reference link into a shu-ref carrying the link text, leaving plain links untouched", () => {
		const html = md.renderInline("A [Field Report](#FieldReport) and [an anchor](#intro) and [ext](https://x.test).");
		expect(html).toContain('<shu-ref kind="domain"');
		expect(html).toContain('text="Field Report"');
		expect(html).toContain("&quot;domain&quot;:&quot;FieldReport&quot;"); // the linkTarget JSON, attribute-escaped
		expect(html).toContain('<a href="#intro">an anchor</a>'); // ordinary anchor preserved
		expect(html).toContain('<a href="https://x.test">ext</a>');
	});

	it("rewrites an individual reference to an entity shu-ref", () => {
		const html = md.renderInline("[this report](#FieldReport:did:example:report-1)");
		expect(html).toContain('<shu-ref kind="entity"');
		expect(html).toContain("&quot;persistedAs&quot;:&quot;FieldReport&quot;");
		expect(html).toContain("&quot;id&quot;:&quot;did:example:report-1&quot;");
	});
});

describe("renderRefProse", () => {
	const isType = (name: string) => name === "Principal";

	it("turns a type link in a description into a live reference, so a description names a type rather than re-explaining it", () => {
		const html = renderRefProse("The document a [party](#Principal)’s DID resolves to.", isType);
		expect(html).toContain("<shu-ref");
		expect(html).toContain("Principal");
		expect(html).toContain("party"); // the author's words, not the type name, are what the reader reads
	});

	it("leaves an ordinary anchor and a link to no known type as plain text", () => {
		expect(renderRefProse("see [below](#notes)", isType)).not.toContain("shu-ref");
		expect(renderRefProse("see [that](#Nonesuch)", isType)).not.toContain("shu-ref");
	});

	it("renders a description as one sentence — no paragraph wrapper to break the line it sits on", () => {
		expect(renderRefProse("A plain description.", isType)).toBe("A plain description.");
	});

	it("renders markup a description carries as text — a description is prose, not a document body", () => {
		const html = renderRefProse('<img src=x onerror="alert(1)"> plain', isType);
		expect(html).not.toContain("<img"); // escaped, so nothing of it is live
		expect(html).toContain("&lt;img");
	});
});
