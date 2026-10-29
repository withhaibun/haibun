/**
 * The Domain type's fields and schema: a record for each registered domain, with its key, its description, its values where it
 * is a set, the component that draws it where it is a view, the type it is persisted as, and its topology. Core derives the
 * records from the declarations, as it derives the ontology's, and declares the type in its domains (`core-domains.ts`), so a
 * reader that parses a record doesn't hold the declaration.
 */
import { z } from "zod";
import { PersistedVertexSchema } from "../../domains/resources.js";

/** The label of the records that describe the registered domains. */
export const DOMAIN_LABEL = "Domain";
/** The domain of the Domain records, which core's declarations declare. */
export const DOMAIN_RECORD_DOMAIN = "domain-record";

/** The fields of a Domain record. The derivation that writes them and every reader that reads them use these names. */
export const DOMAIN_FIELD = {
	name: "name",
	description: "description",
	values: "values",
	component: "component",
	persisted: "persisted",
	topology: "topology",
	generatedAtTime: "generatedAtTime",
	accessLevel: "accessLevel",
} as const;

export const DomainRecordSchema = PersistedVertexSchema.extend({
	[DOMAIN_FIELD.name]: z.string(),
	[DOMAIN_FIELD.description]: z.string(),
	[DOMAIN_FIELD.values]: z.array(z.string()).optional(),
	[DOMAIN_FIELD.component]: z.string().optional(),
	[DOMAIN_FIELD.persisted]: z.string().optional(),
	[DOMAIN_FIELD.topology]: z.record(z.string(), z.unknown()).optional(),
	[DOMAIN_FIELD.generatedAtTime]: z.string(),
});
