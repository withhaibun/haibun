/**
 * The ontology as OWL 2: the classes that declare a property are its domain as one union, a class's declared `@type` IRI
 * is its superclass where several classes declare it, and a CURIE's prefix comes from the served context.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mapDefinitionsToDomains } from "../../domains/domains.js";
import { getJsonLdContext } from "../../domains/hypermedia.js";
import { Access, LinkRelations } from "../../domains/resources.js";
import { ontologyToQuads } from "./ontology.js";
import { iriIn, ontologyOwl } from "./owl.js";
import { DataFactory, Parser, Store } from "n3";
import type { NamedNode, Quad_Object, Term } from "@rdfjs/types";
import { OWL, RDF, RDFS } from "../../domains/vocabularies.js";

const { namedNode, quad, literal } = DataFactory;

const typeOf = (persistedAs: string, extra: { subClassOf?: string }) => ({
	selectors: [persistedAs.toLowerCase()],
	schema: z.object({ id: z.string(), content: z.string(), generatedAtTime: z.string() }),
	description: persistedAs,
	topology: {
		persistedAs,
		type: "prov:Entity",
		id: "id",
		accessLevel: Access.private,
		properties: { id: LinkRelations.IDENTIFIER.rel, content: LinkRelations.CONTENT.rel },
		...extra,
	},
});
const domains = mapDefinitionsToDomains([typeOf("Note", {}), typeOf("Memo", { subClassOf: "prov:Agent" })]);
const context = getJsonLdContext(domains)["@context"];
const owl = new Store(new Parser().parse(ontologyOwl(ontologyToQuads(domains), context)));
const ref = (term: string) => namedNode(iriIn(context, term));
const [note, memo, entity, agent, content] = [ref("Note"), ref("Memo"), ref("prov:Entity"), ref("prov:Agent"), ref(LinkRelations.CONTENT.uri)];
const holds = (subject: Term, predicate: string, object: Term): boolean => owl.has(quad(subject as NamedNode, namedNode(predicate), object as Quad_Object));

describe("ontologyOwl", () => {
	it("states the classes that declare a property as the union that is its domain", () => {
		const [union] = owl.getObjects(content, namedNode(RDFS.domain), null);
		if (union === undefined) throw new Error("the export doesn't state the property's domain");
		expect(holds(union, RDF.type, namedNode(OWL.Class))).toBe(true);
		const [members] = owl.getObjects(union, namedNode(OWL.unionOf), null);
		const lists = owl.extractLists();
		expect(members === undefined ? undefined : lists[members.value]?.map((term) => term.value)).toEqual([note.value, memo.value]);
	});

	it("states each class of a union once, though several fields and types name it", () => {
		const replies = (persistedAs: string) => ({
			...typeOf(persistedAs, {}),
			topology: { ...typeOf(persistedAs, {}).topology, edges: { inReplyTo: { range: "Note" }, follows: { rel: LinkRelations.IN_REPLY_TO.rel, range: "Note" } } },
		});
		const declared = mapDefinitionsToDomains([replies("Note"), replies("Memo")]);
		const replyContext = getJsonLdContext(declared)["@context"];
		const exported = new Store(new Parser().parse(ontologyOwl(ontologyToQuads(declared), replyContext)));
		const inReplyTo = namedNode(iriIn(replyContext, LinkRelations.IN_REPLY_TO.uri));
		const lists = exported.extractLists();
		const [domain] = exported.getObjects(inReplyTo, namedNode(RDFS.domain), null);
		const [domainMembers] = domain === undefined ? [] : exported.getObjects(domain, namedNode(OWL.unionOf), null);
		expect(domainMembers === undefined ? undefined : lists[domainMembers.value]?.map((term) => term.value)).toEqual([note.value, memo.value]);
		expect(
			exported.getObjects(inReplyTo, namedNode(RDFS.range), null).map((term) => term.value),
			"a range of one class is the class",
		).toEqual([note.value]);
	});

	it("states a class's declared @type IRI as its superclass, apart from its other superclasses", () => {
		expect(holds(note, RDFS.subClassOf, entity)).toBe(true);
		expect(holds(memo, RDFS.subClassOf, entity)).toBe(true);
		expect(holds(memo, RDFS.subClassOf, agent)).toBe(true);
		expect(owl.getObjects(entity, namedNode(RDFS.subClassOf), null)).toEqual([]);
	});

	it("refuses a CURIE whose prefix the context doesn't bind", () => {
		expect(() => iriIn(context, "cred:Thing")).toThrow(/the prefix cred of cred:Thing isn't bound/);
	});

	it("writes a class the ontology record states a description for as its rdfs:comment, and leaves an undescribed class uncommented", () => {
		expect(holds(note, RDFS.comment, literal("Note"))).toBe(true);
		expect(holds(memo, RDFS.comment, literal("Memo"))).toBe(true);
		expect(owl.getObjects(entity, namedNode(RDFS.comment), null)).toEqual([]);
	});
});
