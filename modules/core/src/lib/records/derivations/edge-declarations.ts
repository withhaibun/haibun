/** Declares what a write reads of a type's declaration. A store derives a unit's parts from it. */
import { RESOURCE_LABEL } from "../../domains/resources.js";

/** How an edge of a part reaches its target: a record the store holds, a record the store may not hold yet, or the record's one
 *  target of the relation, which replaces its edge to any other. */
export const EDGE_TARGET = { held: "held", reference: "reference", only: "only" } as const;
export type TEdgeTarget = (typeof EDGE_TARGET)[keyof typeof EDGE_TARGET];

/** What a write reads of an edge's declaration: the types it reaches, and whether it owns its target, reaches a record the store
 *  may not hold, or reaches at most one record. */
export type TEdgeDeclaration = { readonly ranges: readonly string[]; readonly owns: boolean; readonly reference: boolean; readonly functional: boolean };

/** What a write reads of a type's declaration: the field that identifies a record, the fields its schema holds, the fields that
 *  hold a list, and its edges. A store reads the schema's fields to place a record in time by a field its schema holds. */
export type TPartDeclaration = {
	readonly id: string;
	readonly fields: ReadonlySet<string> | undefined;
	readonly lists: ReadonlySet<string>;
	readonly edges: Readonly<Record<string, TEdgeDeclaration>>;
	/** Each text field whose digest a write states, with the field that holds it. */
	readonly digests?: Readonly<Record<string, string>>;
};

/** Returns the edge declarations of a topology's edges, as a write reads them. A range of `Resource`, the root type, reaches a
 *  record of any type, which each target states. */
export function edgeDeclarationsOf(
	edges: Readonly<Record<string, { range: string | string[]; owns?: true; reference?: boolean; functional?: true }>> | undefined,
): Record<string, TEdgeDeclaration> {
	return Object.fromEntries(
		Object.entries(edges === undefined ? {} : edges).map(([key, { range, owns, reference, functional }]) => [
			key,
			{ ranges: [range].flat().includes(RESOURCE_LABEL) ? [] : [range].flat(), owns: owns === true, reference: reference === true, functional: functional === true },
		]),
	);
}
