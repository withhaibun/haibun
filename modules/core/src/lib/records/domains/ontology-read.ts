/**
 * What a read of the ontology lists: each class and each property the declarations state, as a counted list of terms. A
 * server reads it, and the page reads the ontology's records, so this module stays apart from the ontology's types.
 */
import { z } from "zod";
import { CountedFields } from "../../domains/hypermedia.js";

/** The two kinds of term a read of the ontology lists. */
export const ONTOLOGY_TERM = { class: "class", property: "property" } as const;
/** A class as a read of the ontology states it: its IRI where a type names one, its designation, its superclasses, each
 *  field of the type with the link relation it declares, and each edge with its relation and the classes in its range. */
const OntologyClassSchema = z
	.object({
		kind: z.literal(ONTOLOGY_TERM.class),
		name: z.string(),
		iri: z.string().optional(),
		category: z.string(),
		subClassOf: z.array(z.string()),
		properties: z.record(z.string(), z.string()),
		edges: z.record(z.string(), z.object({ rel: z.string(), range: z.array(z.string()) }).strict()),
	})
	.strict();
/** A link relation, or a term of a standard vocabulary a type conforms to, as a read of the ontology states it: its IRI,
 *  whether it is abstract, whether a type's data holds it, its superproperties and the classes it connects. */
const OntologyPropertySchema = z
	.object({
		kind: z.literal(ONTOLOGY_TERM.property),
		name: z.string(),
		uri: z.string().optional(),
		abstract: z.boolean(),
		inData: z.boolean(),
		subPropertyOf: z.array(z.string()),
		domain: z.array(z.string()),
		range: z.array(z.string()),
	})
	.strict();
/** What a read of the ontology returns: a counted list of its terms, each class and then each property. Its products open a
 *  view, so dispatch adds the view's markers beside them, which the schema doesn't state. */
export const OntologyReadSchema = z.object({ terms: z.array(z.discriminatedUnion("kind", [OntologyClassSchema, OntologyPropertySchema])), ...CountedFields });
export type TOntologyRead = z.infer<typeof OntologyReadSchema>;
/** The list a read of the ontology holds: its terms. */
export const ONTOLOGY_LIST = { items: "terms" } as const;
