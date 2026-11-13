/**
 * The provenance every store states for each record a unit writes: the time of the unit's write on actuality's clock, and the step
 * in progress. A record's first write links the step that generated it through `prov:wasGeneratedBy`, and a record of a type whose
 * time is the time of its write takes that time as its `generatedAtTime`. A writer doesn't state either. A type that declares a
 * domain time field, such as a message's time of receipt, places its records in time by that field, and its records state their
 * own `generatedAtTime`, as an imported or a moved record does.
 */
import { LinkRelations, SEQ_PATH_LABEL } from "../../domains/resources.js";
import { EDGE_TARGET } from "./edge-declarations.js";
import { generatingStep, statesOnlyId, type TPart, type TUnitEdge } from "./unit-parts.js";

/** The provenance of one unit's write: the time of the write, and the record name of the step in progress, undefined outside a step. */
export type TProvenance = { readonly generatedAtTime: string; readonly step: string | undefined };

const GENERATED_AT = LinkRelations.GENERATED_AT_TIME.rel;
const GENERATED_BY = LinkRelations.WAS_GENERATED_BY.rel;

/** Returns the edge from a record's first write to the step that generated it. A write outside a step, and a step's own record,
 *  doesn't link one. */
export function generatedByEdges(label: string, { step }: TProvenance): TUnitEdge[] {
	const generating = generatingStep(label, step);
	return generating === undefined ? [] : [{ rel: GENERATED_BY, label: SEQ_PATH_LABEL, id: generating, target: EDGE_TARGET.reference, replaces: false }];
}

/** Returns a part with its provenance where `held` is false, its first write: the time of the write as its `generatedAtTime`,
 *  where its type's time field is `generatedAtTime` and the part doesn't state one, and the edge to the step that generated it,
 *  where the part doesn't state its own `wasGeneratedBy`, as a fact and a variable do. A part the store holds keeps its provenance,
 *  and a part that names a record the store doesn't hold by its id alone is a reference, which doesn't take provenance. */
export function withProvenance(part: TPart, held: boolean, validTimeField: string | undefined, provenance: TProvenance): TPart {
	if (held || statesOnlyId(part)) return part;
	const stamped = validTimeField === GENERATED_AT && part.fields[GENERATED_AT] === undefined ? { ...part.fields, [GENERATED_AT]: provenance.generatedAtTime } : part.fields;
	const linked = GENERATED_BY in part.fields || part.edges.some(({ rel }) => rel === GENERATED_BY);
	return { ...part, fields: stamped, edges: linked ? part.edges : [...part.edges, ...generatedByEdges(part.label, provenance)] };
}
