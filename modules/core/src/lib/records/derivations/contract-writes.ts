/**
 * The check of a unit's parts against the writes the contract of the step in progress allows. A record of a type the step's
 * products are written as is the step's product, and a record of another type changes only the fields the contract's `changes`
 * lists, an edge being a change of its relation. A relation that `changes` lists without a type is a change of any record. Every
 * part of a unit is checked, the records the unit owns included, and a Body that holds a record's content changes the record's
 * content fields. A record of a type, or an edge, whose declaration states that it records what actuality did isn't a change a
 * contract lists, since actuality writes it while any step is in progress.
 */
import type { TStepWrites } from "../../steps/domains/contract.js";
import type { TRecordName } from "../domains/unit.js";
import type { TPartDeclaration } from "./edge-declarations.js";

/** A part's changes, as the store holding it computes them: its record, and each field and relation that changes what it holds. */
export type TPartChanges = TRecordName & { readonly changed: readonly string[] };

/** Returns the changes of a part as a step's contract reads them, from the fields and relations `changed` names: a Body that holds
 *  a record's content changes the record's content fields `contentOf` names, where it changes at all, and another part changes its
 *  own. A record whose type records what actuality did doesn't change anything a contract lists, and nor does an edge whose
 *  declaration states it. */
export function contractChangesOf(
	part: TRecordName & { readonly contentOf?: TPartChanges },
	changed: readonly string[],
	declarationOf: (label: string) => TPartDeclaration | undefined,
): TPartChanges {
	const own = part.contentOf === undefined ? { label: part.label, id: part.id, changed } : { ...part.contentOf, changed: changed.length === 0 ? [] : part.contentOf.changed };
	const declaration = declarationOf(own.label);
	if (declaration?.observesActuality === true) return { ...own, changed: [] };
	return { ...own, changed: own.changed.filter((field) => declaration?.edges[field]?.observesActuality !== true) };
}

/** Returns each change of a part that `writes` doesn't allow, as `Type.field`. */
export function writesOutside({ label, changed }: TPartChanges, writes: TStepWrites): string[] {
	if (writes.products.includes(label)) return [];
	const listed = new Set(writes.changes.flatMap((change) => ("relation" in change ? [change.relation] : change.persistedAs === label ? [change.key] : [])));
	return [...new Set(changed)].filter((field) => !listed.has(field)).map((field) => `${label}.${field}`);
}
