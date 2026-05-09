/**
 * SeqPath — the hierarchical step identifier reified as a graph vertex.
 *
 * Every dispatched step writes a SeqPath vertex into the shared quad store
 * via dispatchStep. Vertices form a tree via the `isPartOf` edge: a step
 * with seqPath `0.1.2.5` has parent `0.1.2`. Other emissions within a
 * step's run carry a `seqPath` quad pointing back at the step's id, so
 * the entire execution graph queryable from any vertex.
 *
 * The label and lifecycle status enum live in resources.ts (SEQ_PATH_LABEL,
 * SEQ_PATH_STATUS). This file owns the schema, domain selectors, and the
 * domain definition steppers register.
 */
import { z } from "zod";
import { LinkRelations, SEQ_PATH_LABEL, SEQ_PATH_STATUS, type TDomainDefinition } from "./resources.js";

export const SEQ_PATH_DOMAIN = "seq-path";

/** Format a hierarchical seqPath number array as the canonical string id (e.g. [0,1,2,5] → "0.1.2.5"). */
export function formatSeqPath(seqPath: number[]): string {
	return seqPath.join(".");
}

/** SeqPath vertex field names — single source of truth shared by schema, topology, and emission. */
export const SEQ_PATH_FIELD = {
	id: "id",
	stepText: "stepText",
	actionStatus: "actionStatus",
	startedAtTime: "startedAtTime",
	endedAtTime: "endedAtTime",
	path: "path",
} as const;

/** SeqPath edge names. */
export const SEQ_PATH_EDGE = {
	isPartOf: "isPartOf",
	precededBy: "precededBy",
} as const;

const STATUS_VALUES = Object.values(SEQ_PATH_STATUS) as [string, ...string[]];

export const SeqPathSchema = z.object({
	[SEQ_PATH_FIELD.id]: z.string(),
	[SEQ_PATH_FIELD.stepText]: z.string(),
	[SEQ_PATH_FIELD.actionStatus]: z.enum(STATUS_VALUES),
	[SEQ_PATH_FIELD.startedAtTime]: z.string(),
	[SEQ_PATH_FIELD.endedAtTime]: z.string().optional(),
	[SEQ_PATH_FIELD.path]: z.string().optional(),
});
export type TSeqPath = z.infer<typeof SeqPathSchema>;

export const seqPathDomainDefinition: TDomainDefinition = {
	selectors: [SEQ_PATH_DOMAIN],
	schema: SeqPathSchema,
	description: "Hierarchical step identifier reified as a graph vertex",
	topology: {
		vertexLabel: SEQ_PATH_LABEL,
		id: SEQ_PATH_FIELD.id,
		properties: {
			[SEQ_PATH_FIELD.id]: LinkRelations.IDENTIFIER.rel,
			[SEQ_PATH_FIELD.stepText]: LinkRelations.CONTENT.rel,
			[SEQ_PATH_FIELD.actionStatus]: LinkRelations.ACTION_STATUS.rel,
			[SEQ_PATH_FIELD.startedAtTime]: LinkRelations.PUBLISHED.rel,
			[SEQ_PATH_FIELD.endedAtTime]: LinkRelations.ENDED_AT_TIME.rel,
			[SEQ_PATH_FIELD.path]: LinkRelations.IDENTIFIER.rel,
		},
		edges: {
			[SEQ_PATH_EDGE.isPartOf]: { rel: LinkRelations.PART_OF.rel, range: SEQ_PATH_LABEL },
			[SEQ_PATH_EDGE.precededBy]: { rel: LinkRelations.PRECEDED_BY.rel, range: SEQ_PATH_LABEL },
		},
	},
};
