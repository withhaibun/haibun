import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { registerContext, clearKeyDocuments } from "../../domains/jsonld-loader.js";
import { Access, CLASS_LABEL, LinkRelations, PROPERTY_LABEL } from "../../domains/resources.js";
import { mapDefinitionsToDomains } from "../../domains/domains.js";
import { ontologyToQuads, withStandardTerms } from "../derivations/ontology.js";
import { ONTOLOGY_FIELD } from "../domains/ontology.js";
import { enumerateStandardVocab } from "./standard-vocabulary.js";

const CTX_URL = "urn:test:widget-context";
const UNREGISTERED = "urn:test:unresolvable";
/** A standard context whose Widget scope declares `id` as a keyword alias, and the terms color and size. */
const CTX_DOC = { "@context": { Widget: { "@context": { id: { "@id": "@id" }, color: { "@id": "http://example.org/color" }, size: { "@id": "http://example.org/size" } } } } };
const WIDGET = "Widget";

/** Widget declares `id` and `size`, and conforms to the standard contexts it names, which declare `color` too. */
const widget = (standardContexts?: string[]) =>
	mapDefinitionsToDomains([
		{
			selectors: ["widget"],
			schema: z.object({ id: z.string(), size: z.string() }),
			description: "A widget",
			topology: {
				persistedAs: WIDGET,
				accessLevel: Access.private,
				id: "id",
				properties: { id: LinkRelations.IDENTIFIER.rel, size: LinkRelations.TAG.rel },
				...(standardContexts ? { standardContexts } : {}),
			},
		},
	]);

const warnings: string[] = [];
const warn = (message: string) => warnings.push(message);

describe("enumerateStandardVocab", () => {
	beforeEach(() => {
		clearKeyDocuments();
		registerContext(CTX_URL, CTX_DOC);
		warnings.length = 0;
	});

	it("returns the standard terms a type doesn't model, and leaves out the terms its fields name", async () => {
		expect((await enumerateStandardVocab(widget([CTX_URL]), warn)).get(WIDGET)).toEqual([{ term: "color", iri: "http://example.org/color" }]);
		expect(await enumerateStandardVocab(widget(), warn)).toEqual(new Map());
	});

	it("doesn't return a term for a context the loader doesn't hold, and reports why", async () => {
		expect((await enumerateStandardVocab(widget([UNREGISTERED]), warn)).size).toBe(0);
		expect(warnings.join()).toContain(UNREGISTERED);
	});

	it("doesn't return a term for a type scope that names a context rather than stating one", async () => {
		registerContext("urn:test:string-scoped", { "@context": { Widget: { "@context": "urn:test:unresolvable-inner" } } });
		expect((await enumerateStandardVocab(widget(["urn:test:string-scoped"]), warn)).size).toBe(0);
	});

	it("adds each term to the ontology as a Property that the data doesn't hold, with a domain edge to its type", async () => {
		const domains = widget([CTX_URL]);
		const ontology = withStandardTerms(ontologyToQuads(domains), await enumerateStandardVocab(domains, warn));
		const quadOf = (subject: string, predicate: string) => ontology.quads.find((q) => q.subject === subject && q.predicate === predicate && q.namedGraph === PROPERTY_LABEL);
		expect(quadOf("color", ONTOLOGY_FIELD.uri)?.object).toBe("http://example.org/color");
		expect(quadOf("color", ONTOLOGY_FIELD.inData)?.object).toBe(false);
		expect(quadOf("color", ONTOLOGY_FIELD.domain)?.object).toBe(WIDGET);
		expect(quadOf("size", ONTOLOGY_FIELD.inData)).toBeUndefined();
		expect(ontology.clusters.find((c) => c.type === CLASS_LABEL)?.sampledSubjects).toContain(WIDGET);
	});
});
