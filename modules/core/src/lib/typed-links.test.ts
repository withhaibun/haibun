import { describe, it, expect } from "vitest";
import {
	classifyLinkText,
	markdownRef,
	parseRefHref,
	parseTextDirective,
	resolveLinkTarget,
	textDirectiveFor,
	splitPart,
	partDirectiveFor,
	PART_DIRECTIVE,
	typedHref,
	typedLinkFacts,
	type TLinkVocabulary,
} from "./typed-links.js";
import { LinkRelations } from "./resources.js";
import { FRAGMENT_SPEC, assertFragmentReads } from "./media-fragments.js";

const TYPES = new Set(["Document", "Comment", "FieldReport"]);
/** The declared ontology as a consumer's registration would supply it: core rels plus one consumer edge. */
const vocab: TLinkVocabulary = {
	relRange: (rel) => (rel === "credentialSubject" ? "iri" : Object.values(LinkRelations).find((e) => e.rel === rel && !(e as { abstract?: boolean }).abstract)?.range),
	isType: (name) => TYPES.has(name),
};
const isType = vocab.isType;

describe("parseTextDirective", () => {
	it("reads a bare quote", () => {
		expect(parseTextDirective("holder%20binding")).toEqual({ exact: "holder binding" });
	});
	it("reads prefix and suffix markers", () => {
		expect(parseTextDirective("before-,exact%2C%20quote,-after")).toEqual({ exact: "exact, quote", prefix: "before", suffix: "after" });
	});
	it("yields undefined for a range form, which doesn't quote a single passage", () => {
		expect(parseTextDirective("start,end")).toBeUndefined();
	});
	it("reads back the directive written for a quote, whose dashes and commas are text, not markers", () => {
		const anchor = { exact: "a well-formed, signed claim", prefix: "holds-", suffix: "-, then" };
		expect(parseTextDirective(textDirectiveFor(anchor))).toEqual(anchor);
		expect(parseTextDirective(textDirectiveFor({ exact: "-" }))).toEqual({ exact: "-" });
	});
});

describe("resolveLinkTarget", () => {
	it("resolves a type", () => {
		expect(resolveLinkTarget("#Document", isType)).toEqual({ kind: "type", persistedAs: "Document" });
	});
	it("resolves an individual, splitting on the first colon so a DID id survives", () => {
		expect(resolveLinkTarget("#FieldReport:did:example:r1", isType)).toEqual({ kind: "individual", persistedAs: "FieldReport", id: "did:example:r1" });
	});
	it("resolves a passage inside an individual", () => {
		expect(resolveLinkTarget("#Document:docs/a.md:~:text=holder%20binding", isType)).toEqual({
			kind: "individual",
			persistedAs: "Document",
			id: "docs/a.md",
			anchor: { exact: "holder binding" },
		});
	});
	it("resolves a fragment of an individual's media: a PDF's page, a span of audio or video, a region of an image", () => {
		for (const [value, conformsTo] of [
			["page=2", FRAGMENT_SPEC.pdf],
			["t=30,60", FRAGMENT_SPEC.media],
			["t=,60", FRAGMENT_SPEC.media],
			["xywh=percent:0,0,50,50", FRAGMENT_SPEC.media],
		] as const)
			expect(resolveLinkTarget(`#Document:docs/a.pdf:~:${value}`, isType), value).toEqual({ kind: "individual", persistedAs: "Document", id: "docs/a.pdf", anchor: { conformsTo, value } });
	});
	it("refuses a part it doesn't locate: a fragment not in its key's form, or a key a part isn't written with", () => {
		expect(() => resolveLinkTarget("#Document:docs/a.pdf:~:page=0", isType)).toThrow('"page=0" isn\'t a page fragment of a PDF');
		expect(() => resolveLinkTarget("#Document:docs/a.pdf:~:line=3", isType)).toThrow("a part is written as text=, page=, t=, xywh=");
	});
	it("doesn't read the directive of an address on the web, which may carry one of its own", () => {
		expect(resolveLinkTarget("https://example.com/page#:~:selector(type=CssSelector)", isType)).toBeNull();
	});
	it("doesn't name a target for a path, an address on the web, an in-page anchor, an unknown type, or an empty href", () => {
		expect(resolveLinkTarget("./architecture.md", isType)).toBeNull();
		expect(resolveLinkTarget("https://www.w3.org/TR/annotation-model/", isType)).toBeNull();
		expect(resolveLinkTarget("#introduction", isType)).toBeNull();
		expect(resolveLinkTarget("#Unknown:x", isType)).toBeNull();
		expect(resolveLinkTarget("", isType)).toBeNull();
	});
});

describe("a part of a record", () => {
	it("is written as the directive it is read from", () => {
		for (const part of [{ exact: "holder binding", prefix: "the" }, { conformsTo: FRAGMENT_SPEC.pdf, value: "page=12" }])
			expect(splitPart(`#Document:a${PART_DIRECTIVE}${partDirectiveFor(part)}`).anchor).toEqual(part);
	});
	it("is a fragment read only for its kind of media, so a reader isn't shown the whole file as the part", () => {
		expect(() => assertFragmentReads({ conformsTo: FRAGMENT_SPEC.pdf, value: "page=2" }, "application/pdf")).not.toThrow();
		expect(() => assertFragmentReads({ conformsTo: FRAGMENT_SPEC.media, value: "xywh=0,0,1,1" }, "image/png")).not.toThrow();
		expect(() => assertFragmentReads({ conformsTo: FRAGMENT_SPEC.pdf, value: "page=2" }, "image/png")).toThrow('"page=2" is a fragment of a PDF, and the file is image/png');
	});
});

describe("writing a reference", () => {
	const [DOCUMENT, DID] = ["Document", "did:key:z6Mk(test)"];

	it("writes the href resolveLinkTarget reads back, an id with colons and parentheses whole", () => {
		expect(resolveLinkTarget(typedHref(DOCUMENT, DID), isType)).toEqual({ kind: "individual", persistedAs: DOCUMENT, id: DID });
		expect(resolveLinkTarget(typedHref(DOCUMENT), isType), "and a type's").toEqual({ kind: "type", persistedAs: DOCUMENT });
	});

	it("writes a markdown link whose text keeps its brackets and whose destination is that href", () => {
		expect(markdownRef("the [draft]", DOCUMENT, "d-1")).toBe(`[the \\[draft\\]](${typedHref(DOCUMENT, "d-1")})`);
	});
});

describe("parseRefHref", () => {
	it("shapes a type and an individual as in-app references", () => {
		expect(parseRefHref("#FieldReport", isType)).toEqual({ kind: "domain", target: { domain: "FieldReport" } });
		expect(parseRefHref("#FieldReport:r1:~:text=start", isType)).toEqual({ kind: "entity", target: { persistedAs: "FieldReport", id: "r1", selector: { exact: "start" } } });
	});
	it("is not a reference for a path or an IRI, which the SPA does not open as a column", () => {
		expect(parseRefHref("./architecture.md", isType)).toBeNull();
		expect(parseRefHref("https://example.com", isType)).toBeNull();
	});
});

describe("classifyLinkText", () => {
	it("reads the link text and the rel after it", () => {
		expect(classifyLinkText("the design it exercises:cites", vocab)).toEqual({ rel: "cites", linkText: "the design it exercises" });
	});
	it("states a consumer's own property type, so a consumer vocabulary is writable in prose", () => {
		expect(classifyLinkText("the person it is about:credentialSubject", vocab)).toEqual({ rel: "credentialSubject", linkText: "the person it is about" });
	});
	it("reads a leading colon as a property type without words of its own", () => {
		expect(classifyLinkText(":cites", vocab)).toEqual({ rel: "cites" });
	});
	it("doesn't state a rel for ordinary prose, including a word that happens to be a term", () => {
		expect(classifyLinkText("the design document", vocab)).toBeNull();
		expect(classifyLinkText("Section 3: Overview", vocab)).toBeNull();
		expect(classifyLinkText("cites", vocab)).toBeNull();
		expect(classifyLinkText("credentialSubject", vocab)).toBeNull();
	});
	it("fails on a rel the ontology does not declare", () => {
		expect(() => classifyLinkText("a task:notARel", vocab)).toThrow(/not a declared rel/);
	});
	it("rejects an abstract upper concept, which is never a written rel", () => {
		expect(() => classifyLinkText("a role:inRoleOf", vocab)).toThrow(/not a declared rel/);
	});
});

describe("typedLinkFacts", () => {
	it("states an untyped link to a record as a mentions edge", () => {
		expect(typedLinkFacts("See [the design](#Document:docs/a.md).", vocab)).toEqual([
			{ rel: LinkRelations.MENTIONS.rel, target: { kind: "individual", persistedAs: "Document", id: "docs/a.md" } },
		]);
	});
	it("keeps a typed link's rel and link text; the link text is what the passage was cited for", () => {
		expect(typedLinkFacts("This scenario [the clause it exercises:citesAsEvidence](#Document:docs/a.md:~:text=a%20clause).", vocab)).toEqual([
			{
				rel: "citesAsEvidence",
				typed: true,
				linkText: "the clause it exercises",
				target: { kind: "individual", persistedAs: "Document", id: "docs/a.md", anchor: { exact: "a clause" } },
			},
		]);
	});
	it("doesn't state a fact for a link inside a code fence or inline code", () => {
		expect(typedLinkFacts("```\n[cites](./a.md)\n```\n\n`[cites](./b.md)`\n", vocab)).toEqual([]);
	});
	it("doesn't state a fact for an untyped link that doesn't name an addressable target", () => {
		expect(typedLinkFacts("See [the introduction](#introduction).", vocab)).toEqual([]);
	});
	it("fails when a typed link doesn't name a record here", () => {
		expect(() => typedLinkFacts("[that section:cites](#introduction)", vocab)).toThrow(/a record here, named #Type:id/);
	});
	it("doesn't state a fact when a word that happens to be a term points at a page anchor", () => {
		expect(typedLinkFacts("as [verified](#dfn-verify) defines it", vocab)).toEqual([]);
	});
	it("fails when a link's rel holds a container", () => {
		expect(() => typedLinkFacts("[the set it is in:groupedAs](./a.md)", vocab)).toThrow(/cannot be a link's rel/);
	});
	it("reads several links in one text, in document order", () => {
		const facts = typedLinkFacts("[the design:cites](#Document:docs/a.md) then [the plan:mentions](#Document:docs/b.md)", vocab);
		expect(facts.map((f) => f.rel)).toEqual(["cites", "mentions"]);
		expect(facts[0]).toMatchObject({ linkText: "the design" });
		expect(facts[1]).toEqual({ rel: "mentions", typed: true, linkText: "the plan", target: { kind: "individual", persistedAs: "Document", id: "docs/b.md" } });
	});

	it("doesn't state a fact for a path or a web address; a typed link to one fails", () => {
		expect(typedLinkFacts("as [the W3C model](https://www.w3.org/TR/annotation-model/) puts it", vocab)).toEqual([]);
		expect(typedLinkFacts("see [the design](./architecture.md) beside it", vocab)).toEqual([]);
		expect(() => typedLinkFacts("[the W3C model:cites](https://www.w3.org/TR/annotation-model/)", vocab)).toThrow(/a record here, named #Type:id/);
	});
});
