/**
 * The provenance every store states for each record a unit writes: the time of the unit's write, and the step in progress. A
 * record's first write links the step that generated it through `prov:wasGeneratedBy`. A record of a type whose time is the
 * time of its write takes that time as its `generatedAtTime` where it doesn't state one. A type that declares a domain time
 * field, such as a message's time of receipt, places its records in time by that field, and its records state their own
 * `generatedAtTime`.
 */
import { LinkRelations, SEQ_PATH_LABEL } from "../../domains/resources.js";
import { EDGE_TARGET, isWholeRecord, type TUnit, type TUnitEdge } from "../domains/unit.js";

/** The provenance of one unit's write: the time of the write, and the record name of the step in progress, undefined outside a step. */
export type TProvenance = { readonly generatedAtTime: string; readonly step: string | undefined };

const GENERATED_AT = LinkRelations.GENERATED_AT_TIME.rel;

/** Returns a record written whole with the time of its write, where its type's time field is `generatedAtTime` and the record
 *  doesn't state it. A type that declares a domain time field, and a type a store holds without a declaration, isn't stamped. */
export function stampedRecord(record: Readonly<Record<string, unknown>>, validTimeField: string | undefined, { generatedAtTime }: TProvenance): Readonly<Record<string, unknown>> {
	if (validTimeField !== GENERATED_AT || record[GENERATED_AT] !== undefined) return record;
	return { ...record, [GENERATED_AT]: generatedAtTime };
}

/** Returns the edge from a record's first write to the step that generated it. A write outside a step, and a step's own record,
 *  doesn't link one. */
export const generatedByEdges = (label: string, { step }: TProvenance): TUnitEdge[] =>
	step === undefined || label === SEQ_PATH_LABEL ? [] : [{ rel: LinkRelations.WAS_GENERATED_BY.rel, label: SEQ_PATH_LABEL, id: step, target: EDGE_TARGET.reference }];

/** Returns a part of a unit with its provenance: a record written whole with the time of its write, as `stampedRecord` states it,
 *  and on its first write, where `held` is false, the edge to the step that generated it. A record that states its own
 *  `wasGeneratedBy`, as a fact and a variable do, links its steps itself. */
export function withProvenance(part: TUnit, held: boolean, validTimeField: string | undefined, provenance: TProvenance): TUnit {
	if (!isWholeRecord(part)) return part;
	const record = stampedRecord(part.record, validTimeField, provenance);
	const stated = part.edges === undefined ? [] : part.edges;
	const generatedBy =
		held || LinkRelations.WAS_GENERATED_BY.rel in record || stated.some(({ rel }) => rel === LinkRelations.WAS_GENERATED_BY.rel) ? [] : generatedByEdges(part.label, provenance);
	return { ...part, record, edges: [...stated, ...generatedBy] };
}
