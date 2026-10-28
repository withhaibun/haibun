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
const owl = ontologyOwl(ontologyToQuads(domains), context);
const ref = (term: string): string => `<${iriIn(context, term)}>`;
const [note, memo, entity, agent, content] = [ref("Note"), ref("Memo"), ref("prov:Entity"), ref("prov:Agent"), ref(LinkRelations.CONTENT.uri)];

describe("ontologyOwl", () => {
	it("states the classes that declare a property as the union that is its domain", () => {
		expect(owl).toContain(`${content} rdfs:domain [ a owl:Class ; owl:unionOf ( ${note} ${memo} ) ] .`);
	});

	it("states a class's declared @type IRI as its superclass, apart from its other superclasses", () => {
		expect(owl).toContain(`${note} rdfs:subClassOf ${entity} .`);
		expect(owl).toContain(`${memo} rdfs:subClassOf ${entity} .`);
		expect(owl).toContain(`${memo} rdfs:subClassOf ${agent} .`);
		expect(owl).not.toContain(`${entity} rdfs:subClassOf`);
	});

	it("refuses a CURIE whose prefix the context doesn't bind", () => {
		expect(() => iriIn(context, "cred:Thing")).toThrow(/the prefix cred of cred:Thing isn't bound/);
	});
});
