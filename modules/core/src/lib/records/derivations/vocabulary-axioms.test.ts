/**
 * The registered vocabularies over an ontology's classes: a type's standard superclass leads up its vocabulary's chain, a class
 * a vocabulary defines names the vocabulary's published file, and two of the ontology's classes the vocabulary states disjoint
 * are linked as disjoint.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mapDefinitionsToDomains } from "../../domains/domains.js";
import { Access, CLASS_LABEL, LinkRelations } from "../../domains/resources.js";
import { NAMESPACE } from "../../domains/vocabularies.js";
import { registerVocabulary, vocabularyEntry } from "../../domains/vocabulary-registry.js";
import { ONTOLOGY_FIELD } from "../domains/ontology.js";
import { ontologyToQuads } from "./ontology.js";
import { withVocabularyAxioms } from "./vocabulary-axioms.js";

const PROV = NAMESPACE.prov;
const typeOf = (persistedAs: string, subClassOf: string) => ({
	selectors: [persistedAs.toLowerCase()],
	schema: z.object({ id: z.string() }),
	description: persistedAs,
	topology: { persistedAs, subClassOf, id: "id", accessLevel: Access.private, properties: { id: LinkRelations.IDENTIFIER.rel } },
});
const entry = vocabularyEntry("prov");
registerVocabulary({ entry, subClassOf: [[`${PROV}Plan`, `${PROV}Entity`]], disjointWith: [[`${PROV}Activity`, `${PROV}Entity`]], stated: 3 });
const ontology = withVocabularyAxioms(ontologyToQuads(mapDefinitionsToDomains([typeOf("Step", "prov:Activity"), typeOf("Recipe", "prov:Plan")])));
const stated = (subject: string, predicate: string) =>
	ontology.quads.filter((q) => q.namedGraph === CLASS_LABEL && q.subject === subject && q.predicate === predicate).map((q) => q.object);

describe("withVocabularyAxioms", () => {
	it("leads a type's standard superclass up its vocabulary's chain, as classes of the ontology", () => {
		expect(stated("prov:Plan", ONTOLOGY_FIELD.subClassOf)).toEqual(["prov:Entity"]);
		expect(ontology.clusters.find((c) => c.type === CLASS_LABEL)?.sampledSubjects).toContain("prov:Entity");
		expect(stated("prov:Entity", ONTOLOGY_FIELD.category)).toHaveLength(1);
	});

	it("names the vocabulary that defines a class, and links two of the ontology's classes it states disjoint", () => {
		expect(stated("prov:Activity", ONTOLOGY_FIELD.definedBy)).toEqual([entry.source]);
		expect(stated("Step", ONTOLOGY_FIELD.definedBy)).toEqual([]);
		expect(stated("prov:Activity", ONTOLOGY_FIELD.disjointWith)).toEqual(["prov:Entity"]);
	});
});
