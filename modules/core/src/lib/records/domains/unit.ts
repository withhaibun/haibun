/**
 * Declares a unit: a record and the records it owns, which a store writes in one operation. A type's topology marks an edge
 * `owns` where its target is part of the record, such as a Comment's Body, so a unit is a record and what it owns,
 * transitively. A store's `write` writes a unit whole or refuses it, and its `remove` removes a record with what it owns.
 */

/** How an edge of a unit reaches its target: a record the store holds, a record the store may not hold yet, or the record's
 *  one target of the relation, which replaces its edge to any other. */
export const EDGE_TARGET = { held: "held", reference: "reference", only: "only" } as const;
export type TEdgeTarget = (typeof EDGE_TARGET)[keyof typeof EDGE_TARGET];

/** An edge a unit writes from its record, beyond the edge fields its type declares: the relation, and the type and the id of
 *  the record it reaches. */
export type TUnitEdge = { readonly rel: string; readonly label: string; readonly id: string; readonly target: TEdgeTarget };

/** A record a unit writes whole, by the id its fields state. `merge` keeps each field the store holds that the write doesn't
 *  state. `namedBy` names the record whose level a record takes, and the store writes such a record only where it doesn't hold
 *  it. */
export type TWholeRecord = { readonly label: string; readonly record: Readonly<Record<string, unknown>>; readonly merge?: true; readonly namedBy?: TRecordName };

/** Fields of the record `id` names, which the store holds: a value replaces the field, and a null removes it. */
export type TRecordFields = { readonly label: string; readonly id: string; readonly fields: Readonly<Record<string, unknown>> };

/** The record `id` names, which the store may not hold, as the source of edges. A store that keeps edges strictly holds a
 *  reference in place of an absent record until a write of the record replaces it. */
export type TReferencedRecord = { readonly label: string; readonly id: string; readonly referenced: true };

/** The version of a record that a caller read: the version a store returned for it, or null where the store didn't hold it. */
export type TReadVersion = string | null;

/** A unit: a record, the edges it writes beyond its declared edge fields, and the units it owns. `version` is the version of
 *  the record that the caller read, and the store refuses the unit where the record's fields changed since that read. */
export type TUnit = (TWholeRecord | TRecordFields | TReferencedRecord) & {
	readonly edges?: readonly TUnitEdge[];
	readonly owns?: readonly TUnit[];
	readonly version?: TReadVersion;
};

/** A record a caller read with its version, which a unit written from the record states. */
export type TVersionedRead<T> = { readonly record: T | undefined; readonly version: TReadVersion };

/** Returns the version a write states, and the version the store holds, as a refusal names them. */
const statedText = (version: TReadVersion): string => (version === null ? "that the store didn't hold the record" : `version ${version}`);
const heldText = (version: TReadVersion): string => (version === null ? "the store doesn't hold it" : `the store holds version ${version}`);

/** The refusal of a unit whose record changed since its caller read it. The caller reads the record again and writes from
 *  what the store holds. */
export class ChangedSinceRead extends Error {
	constructor(
		readonly record: TRecordName,
		readonly read: TReadVersion,
		readonly held: TReadVersion,
	) {
		super(
			`${record.label} "${record.id}" changed since it was read: the write states ${statedText(read)}, and ${heldText(held)}. Read the record again and write from what the store holds`,
		);
	}
}

/** Refuses the unit whose record `record` names where the version its caller read isn't the version the store holds. */
export function assertReadVersion(record: TRecordName, read: TReadVersion | undefined, held: TReadVersion): void {
	if (read !== undefined && read !== held) throw new ChangedSinceRead(record, read, held);
}

/** A record by its type and its id. */
export type TRecordName = { readonly label: string; readonly id: string };

/** What `remove` removes from the record a name names: the record with what it owns, one of its fields, or its edge of a
 *  relation to the record `to` names, which keeps both records. */
export type TRemoval = TRecordName &
	(
		| { readonly field?: undefined; readonly edge?: undefined }
		| { readonly field: string; readonly edge?: undefined }
		| { readonly field?: undefined; readonly edge: { readonly rel: string; readonly to: string } }
	);

/** Returns whether a unit writes its record whole. */
export const isWholeRecord = (unit: TUnit): unit is TWholeRecord & TUnit => "record" in unit;

/** Returns whether a unit names a record the store may not hold, as the source of its edges. */
export const isReferenced = (unit: TUnit): unit is TReferencedRecord & TUnit => "referenced" in unit;

/** Returns whether a unit writes fields of its record, which gives the record its next version. */
export const writesFields = (unit: TUnit): boolean => isWholeRecord(unit) || (!isReferenced(unit) && Object.keys(unit.fields).length > 0);

/** Returns the unit that writes edges from the record `label` and `id` name, which the store holds, and doesn't change its fields. */
export const edgesFrom = (label: string, id: string, ...edges: TUnitEdge[]): TUnit => ({ label, id, fields: {}, edges });

/** Returns each unit a unit holds: the unit, then each unit it owns, transitively. */
export const unitsOf = (unit: TUnit): TUnit[] => [unit, ...(unit.owns === undefined ? [] : unit.owns.flatMap(unitsOf))];
