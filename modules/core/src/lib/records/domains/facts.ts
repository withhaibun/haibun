/**
 * Declares a fact: one product of a step, a typed record held where the steps' records are. Dispatch writes a fact of each
 * product whose domain the step declares. The fact links the step that produced it through `prov:wasGeneratedBy`, and it is
 * instrumentation, so a store's retention removes it with the steps' records of its time.
 */
import { PROV_ENTITY } from "../../domains/vocabularies.js";
import { ACTUALITY_FIELD } from "../../actuality/domains/seq-path.js";
import { z } from "zod";
import { ACCESS_BROADEST_FIRST, EDGE, FACT_LABEL, LinkRelations, PersistedVertexSchema, SEQ_PATH_LABEL, type TDomainDefinition } from "../../domains/resources.js";

const FACT_DOMAIN = "fact";

/** The fields of a fact's record. */
export const FACT_FIELD = { id: "id", domain: "domain", value: "value", generatedAtTime: "generatedAtTime", accessLevel: "accessLevel", actuality: ACTUALITY_FIELD } as const;

export const FactSchema = PersistedVertexSchema.extend({
	[FACT_FIELD.id]: z.string(),
	[FACT_FIELD.domain]: z.string(),
	[FACT_FIELD.value]: z.unknown(),
	[FACT_FIELD.generatedAtTime]: z.string(),
	[FACT_FIELD.actuality]: z.string(),
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
		observesActuality: true,
		// A fact is written at the read ceiling of the step that produced it, which can be any level.
		accessLevel: ACCESS_BROADEST_FIRST,
		displayLabel: FACT_FIELD.domain,
		properties: {
			[FACT_FIELD.id]: LinkRelations.IDENTIFIER.rel,
			// Grouped-as, so a filter reads the facts of one domain.
			[FACT_FIELD.domain]: LinkRelations.CONTEXT.rel,
			[FACT_FIELD.value]: LinkRelations.VALUE.rel,
			[FACT_FIELD.generatedAtTime]: LinkRelations.GENERATED_AT_TIME.rel,
			[FACT_FIELD.accessLevel]: LinkRelations.ACCESS_LEVEL.rel,
			// Grouped-as, so a reader reads the facts of one actuality feature.
			[FACT_FIELD.actuality]: LinkRelations.CONTEXT.rel,
		},
		// A step's caller may not hold a read action, so its write of a fact doesn't read whether the store holds the step's record.
		edges: { [EDGE.wasGeneratedBy]: { rel: LinkRelations.WAS_GENERATED_BY.rel, range: SEQ_PATH_LABEL, reference: true } },
	},
};
