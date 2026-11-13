/** Declares what a write reads of a type's declaration. A store derives a unit's parts from it. */
import { RESOURCE_LABEL, type TRecordKey } from "../../domains/resources.js";

/** Whether an edge's target is a record the store holds or the unit writes, or a record the store may not hold yet. A store
 *  refuses a unit whose edge to a held target reaches a record the store doesn't hold and the unit doesn't write. */
export const EDGE_TARGET = { held: "held", reference: "reference" } as const;
export type TEdgeTarget = (typeof EDGE_TARGET)[keyof typeof EDGE_TARGET];

/** How a write states an edge it reaches through a declaration: whether its target is held or a reference, and whether the edge
 *  replaces the record's earlier edges of its relation. Every store reads it from the edge's declaration. */
export type TEdgeWrite = { readonly target: TEdgeTarget; readonly replaces: boolean };

/** Returns how a write states an edge its type declares: an edge declared `reference` reaches a record the store may not hold,
 *  another reaches a held record, and an edge declared `functional` replaces the record's edge to any other. */
export const edgeWriteOf = ({ reference, functional }: Pick<TEdgeDeclaration, "reference" | "functional">): TEdgeWrite => ({
	target: reference ? EDGE_TARGET.reference : EDGE_TARGET.held,
	replaces: functional,
});

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
	/** The keys a record's id is derived from, where the type declares them. */
	readonly keys?: readonly TRecordKey[];
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
