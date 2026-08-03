import { describe, it, expect } from "vitest";
import { classifyLinkText, parseRefHref, parseTextDirective, resolveLinkTarget, typedLinkFacts, type TLinkVocabulary } from "./typed-links.js";
import { LinkRelations } from "./resources.js";

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
	it("yields nothing for a range form, which quotes no single passage", () => {
		expect(parseTextDirective("start,end")).toBeUndefined();
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
	it("names nothing for a path, an address on the web, an in-page anchor, an unknown type, or an empty href", () => {
		expect(resolveLinkTarget("./architecture.md", isType)).toBeNull();
		expect(resolveLinkTarget("https://www.w3.org/TR/annotation-model/", isType)).toBeNull();
		expect(resolveLinkTarget("#introduction", isType)).toBeNull();
		expect(resolveLinkTarget("#Unknown:x", isType)).toBeNull();
		expect(resolveLinkTarget("", isType)).toBeNull();
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
	it("reads a leading colon as a property type with no words of its own", () => {
		expect(classifyLinkText(":cites", vocab)).toEqual({ rel: "cites" });
	});
	it("states nothing for ordinary prose, including a word that happens to be a term", () => {
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
	it("states nothing for a link inside a code fence or inline code", () => {
		expect(typedLinkFacts("```\n[cites](./a.md)\n```\n\n`[cites](./b.md)`\n", vocab)).toEqual([]);
	});
	it("states nothing for an untyped link that names nothing addressable", () => {
		expect(typedLinkFacts("See [the introduction](#introduction).", vocab)).toEqual([]);
	});
	it("fails when a typed link names no record here", () => {
		expect(() => typedLinkFacts("[that section:cites](#introduction)", vocab)).toThrow(/a record here, named #Type:id/);
	});
	it("states nothing when a word that happens to be a term points at a page anchor", () => {
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

	it("states nothing for a path or a web address; a typed link to one fails", () => {
		expect(typedLinkFacts("as [the W3C model](https://www.w3.org/TR/annotation-model/) puts it", vocab)).toEqual([]);
		expect(typedLinkFacts("see [the design](./architecture.md) beside it", vocab)).toEqual([]);
		expect(() => typedLinkFacts("[the W3C model:cites](https://www.w3.org/TR/annotation-model/)", vocab)).toThrow(/a record here, named #Type:id/);
	});
});
