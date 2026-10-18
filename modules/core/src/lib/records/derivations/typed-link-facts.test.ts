import { describe, it, expect } from "vitest";
import { linkMentions, typedLinkFacts } from "./typed-link-facts.js";
import type { TLinkVocabulary } from "../../domains/typed-links.js";
import { LinkRelations } from "../../domains/resources.js";

const TYPES = new Set(["Document", "Comment", "FieldReport"]);
/** The declared ontology as a consumer's registration would supply it: core rels plus one consumer edge. */
const vocab: TLinkVocabulary = {
	relRange: (rel) => (rel === "permitHolder" ? "iri" : Object.values(LinkRelations).find((e) => e.rel === rel && !(e as { abstract?: boolean }).abstract)?.range),
	isType: (name) => TYPES.has(name),
};

describe("linkMentions", () => {
	it("reads each link as a mention and its text as text, a colon in it included", () => {
		expect(linkMentions("[LlmProvider:openai](#Document:a) and [a note](https://example.com/n) and [the type](#Document)", vocab)).toEqual([
			{ rel: LinkRelations.MENTIONS.rel, target: { kind: "individual", persistedAs: "Document", id: "a" } },
		]);
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
		expect(() => typedLinkFacts("[that section:cites](#introduction)", vocab)).toThrow(/a fact's target is a record\. Write the href as #Type:id/);
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
		expect(() => typedLinkFacts("[the W3C model:cites](https://www.w3.org/TR/annotation-model/)", vocab)).toThrow(/a fact's target is a record\. Write the href as #Type:id/);
	});
});
