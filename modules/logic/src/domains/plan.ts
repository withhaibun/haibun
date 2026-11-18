/**
 * Declares a plan: the record of a goal a principal works toward, as `prov:Plan` states one. A plan holds its goal, the
 * principal that began it, and the facts its calls asserted. The step that begins a plan and the step that advances it write
 * the record at the read ceiling of their caller, and list the type as their change.
 */
import { z } from "zod";
import { ACCESS_BROADEST_FIRST, LinkRelations, PersistedVertexSchema, type TDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import { recordChange } from "@haibun/core/lib/steps/domains/contract.js";

/** The type a plan is persisted as. */
export const PLAN_LABEL = "Plan";
const PLAN_DOMAIN = "plan";

/** The fields of a plan's record. */
export const PLAN_FIELD = { id: "id", goal: "goal", owner: "owner", factIds: "factIds", generatedAtTime: "generatedAtTime", accessLevel: "accessLevel" } as const;

export const PlanRecordSchema = PersistedVertexSchema.extend({
	[PLAN_FIELD.id]: z.string(),
	[PLAN_FIELD.goal]: z.string(),
	[PLAN_FIELD.owner]: z.string().optional(),
	[PLAN_FIELD.factIds]: z.array(z.string()),
	[PLAN_FIELD.generatedAtTime]: z.string(),
});
export type TPlanRecord = Pick<z.infer<typeof PlanRecordSchema>, "goal" | "owner" | "factIds">;

export const planDomainDefinition: TDomainDefinition = {
	selectors: [PLAN_DOMAIN],
	schema: PlanRecordSchema,
	description: "A plan toward a goal: the goal, the principal that began it, and the facts its calls asserted",
	topology: {
		persistedAs: PLAN_LABEL,
		type: "prov:Plan",
		id: PLAN_FIELD.id,
		// A plan is written at the read ceiling of the caller that begins or advances it, which can be any level.
		accessLevel: ACCESS_BROADEST_FIRST,
		displayLabel: PLAN_FIELD.goal,
		properties: {
			[PLAN_FIELD.id]: LinkRelations.IDENTIFIER.rel,
			[PLAN_FIELD.goal]: LinkRelations.SCHEMA_OBJECT.rel,
			[PLAN_FIELD.owner]: LinkRelations.WAS_ATTRIBUTED_TO.rel,
			[PLAN_FIELD.factIds]: LinkRelations.SCHEMA_RESULT.rel,
			[PLAN_FIELD.generatedAtTime]: LinkRelations.GENERATED_AT_TIME.rel,
			[PLAN_FIELD.accessLevel]: LinkRelations.ACCESS_LEVEL.rel,
		},
	},
};

/** The change of a step that begins or advances a plan: the plan's record. */
export const PLAN_CHANGES = [recordChange(PLAN_LABEL)];
