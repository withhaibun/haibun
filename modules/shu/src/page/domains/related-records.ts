/**
 * The records related to a record, as the step that reads them returns them: each record with the edges that reach it, and the
 * root record of their thread.
 */
import { z } from "zod";

/** An edge that reaches a related record: its relation, and the id of the record at its other end. */
export const ThreadEdgeSchema = z.object({ type: z.string(), targetId: z.string() });
export type TThreadEdge = z.infer<typeof ThreadEdgeSchema>;

/** A related record: its fields, with the edges that reach it. */
export const ThreadVertexSchema = z.looseObject({ _edges: z.array(ThreadEdgeSchema).optional() });
export type TThreadVertex = z.infer<typeof ThreadVertexSchema>;

/** The records related to a record, and the root record of their thread. */
export const RelatedRecordsSchema = z.object({ items: z.array(ThreadVertexSchema), contextRoot: z.string() });
