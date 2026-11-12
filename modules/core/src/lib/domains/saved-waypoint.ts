/** The saved waypoint type: the head of a waypoint and the lines of its activity, which ActivitiesStepper states again after a
 *  restart. */
import { z } from "zod";
import { PROV_PLAN } from "./vocabularies.js";
import { Access, LinkRelations, PersistedVertexSchema, type TDomainDefinition } from "./resources.js";

export const SAVED_WAYPOINT_LABEL = "SavedWaypoint";
export const SAVED_WAYPOINT_DOMAIN = "saved-waypoint";
export const SavedWaypointSchema = PersistedVertexSchema.extend({
	/** The waypoint's head. */
	id: z.string(),
	lines: z.array(z.string()),
	source: z.string(),
	generatedAtTime: z.string(),
});
export type TSavedWaypoint = z.infer<typeof SavedWaypointSchema>;
/** A saved waypoint's record. It holds the head, the lines of the activity in order, and the source path. ActivitiesStepper
 *  reads these records as each feature starts, so a waypoint saved before a restart applies again. The type is a schema.org
 *  HowTo whose steps are the lines. */
export const savedWaypointDomainDefinition: TDomainDefinition = {
	selectors: [SAVED_WAYPOINT_DOMAIN],
	schema: SavedWaypointSchema,
	description: "A saved waypoint's head and the lines its activity runs. Its rule is stated again as each feature starts after a restart.",
	topology: {
		persistedAs: SAVED_WAYPOINT_LABEL,
		accessLevel: Access.private,
		type: "schema:HowTo",
		// A waypoint's lines are the steps its activity takes: a PROV plan.
		subClassOf: PROV_PLAN,
		id: "id",
		properties: { id: LinkRelations.IDENTIFIER.rel, lines: LinkRelations.STEP.rel, source: LinkRelations.SOURCE_PATH.rel },
		displayLabel: "id",
		sortColumns: { generatedAtTime: "TIMESTAMPTZ" },
	},
};
