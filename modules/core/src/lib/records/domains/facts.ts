/**
 * Declares a fact: one product of a step, held in core's in-memory store. Dispatch writes a fact of each product whose domain
 * the step declares. The fact links the step that produced it through `prov:wasGeneratedBy`.
 */
import { z } from "zod";
import { Access, EDGE, FACT_LABEL, HELD_BY, LinkRelations, PersistedVertexSchema, SEQ_PATH_LABEL, type TDomainDefinition } from "../../domains/resources.js";

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
		type: "prov:Entity",
		id: FACT_FIELD.id,
		heldBy: HELD_BY.inMemoryStore,
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
