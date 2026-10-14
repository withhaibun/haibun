/**
 * Declares a variable: a named value a feature sets, held in working memory. The variable's record links each step
 * that set it through `prov:wasGeneratedBy`. A secret's record holds the obscured value.
 */
import { z } from "zod";
import { Access, EDGE, HELD_BY, LinkRelations, PersistedVertexSchema, SEQ_PATH_LABEL, type TDomainDefinition } from "../../resources.js";
import { SHARED_GRAPH } from "../../steps/domains/quad-types.js";

const VARIABLE_DOMAIN = "variable";

/** The fields of a variable's record. */
export const VARIABLE_FIELD = {
	name: "name",
	domain: "domain",
	value: "value",
	origin: "origin",
	readonly: "readonly",
	secret: "secret",
	generatedAtTime: "generatedAtTime",
	accessLevel: "accessLevel",
} as const;

export const VariableSchema = PersistedVertexSchema.extend({
	[VARIABLE_FIELD.name]: z.string(),
	[VARIABLE_FIELD.domain]: z.string(),
	[VARIABLE_FIELD.value]: z.unknown(),
	[VARIABLE_FIELD.origin]: z.string(),
	[VARIABLE_FIELD.readonly]: z.boolean().optional(),
	[VARIABLE_FIELD.secret]: z.boolean().optional(),
	[VARIABLE_FIELD.generatedAtTime]: z.string(),
});

export const variableDomainDefinition: TDomainDefinition = {
	selectors: [VARIABLE_DOMAIN],
	schema: VariableSchema,
	description: "A named value a feature set, with its domain and origin. It links each step that set it.",
	topology: {
		persistedAs: SHARED_GRAPH,
		type: "prov:Entity",
		id: VARIABLE_FIELD.name,
		heldBy: HELD_BY.workingMemory,
		instrumentation: true,
		accessLevel: Access.private,
		displayLabel: VARIABLE_FIELD.name,
		properties: {
			[VARIABLE_FIELD.name]: LinkRelations.IDENTIFIER.rel,
			// Grouped-as, so a filter reads the variables of one domain.
			[VARIABLE_FIELD.domain]: LinkRelations.CONTEXT.rel,
			[VARIABLE_FIELD.value]: LinkRelations.VALUE.rel,
			[VARIABLE_FIELD.origin]: LinkRelations.TAG.rel,
			[VARIABLE_FIELD.readonly]: LinkRelations.TAG.rel,
			[VARIABLE_FIELD.secret]: LinkRelations.TAG.rel,
			[VARIABLE_FIELD.generatedAtTime]: LinkRelations.GENERATED_AT_TIME.rel,
			[VARIABLE_FIELD.accessLevel]: LinkRelations.ACCESS_LEVEL.rel,
		},
		edges: { [EDGE.wasGeneratedBy]: { rel: LinkRelations.WAS_GENERATED_BY.rel, range: SEQ_PATH_LABEL } },
	},
};
