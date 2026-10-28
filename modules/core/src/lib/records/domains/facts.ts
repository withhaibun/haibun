/**
 * Declares a fact: one product of a step, a typed record held where the steps' records are. Dispatch writes a fact of each
 * product whose domain the step declares. The fact links the step that produced it through `prov:wasGeneratedBy`, and it is
 * instrumentation, so a store's retention removes it with the steps' records of its time.
 */
import { PROV_ENTITY } from "../../domains/vocabularies.js";
import { z } from "zod";
import { Access, EDGE, FACT_LABEL, LinkRelations, PersistedVertexSchema, SEQ_PATH_LABEL, type TDomainDefinition } from "../../domains/resources.js";

const FACT_DOMAIN = "fact";

/** The fields of a fact's record. */
export const FACT_FIELD = { id: "id", domain: "domain", value: "value", generatedAtTime: "generatedAtTime", accessLevel: "accessLevel" } as const;

export const FactSchema = PersistedVertexSchema.extend({
	[FACT_FIELD.id]: z.string(),
	[FACT_FIELD.domain]: z.string(),
	[FACT_FIELD.value]: z.unknown(),
	[FACT_FIELD.generatedAtTime]: z.string(),
});

/** A fact as a reader of facts reads it: its id, its domain and its value. */
export type TFact = { id: string; domain: string; value: unknown };

export const factDomainDefinition: TDomainDefinition = {
	selectors: [FACT_DOMAIN],
	schema: FactSchema,
	description: "A product of a step, by its domain. It links the step that produced it.",
	topology: {
		persistedAs: FACT_LABEL,
		type: PROV_ENTITY,
		id: FACT_FIELD.id,
		instrumentation: true,
		accessLevel: Access.private,
		displayLabel: FACT_FIELD.domain,
		properties: {
			[FACT_FIELD.id]: LinkRelations.IDENTIFIER.rel,
			// Grouped-as, so a filter reads the facts of one domain.
			[FACT_FIELD.domain]: LinkRelations.CONTEXT.rel,
			[FACT_FIELD.value]: LinkRelations.VALUE.rel,
			[FACT_FIELD.generatedAtTime]: LinkRelations.GENERATED_AT_TIME.rel,
			[FACT_FIELD.accessLevel]: LinkRelations.ACCESS_LEVEL.rel,
		},
		edges: { [EDGE.wasGeneratedBy]: { rel: LinkRelations.WAS_GENERATED_BY.rel, range: SEQ_PATH_LABEL } },
	},
};
