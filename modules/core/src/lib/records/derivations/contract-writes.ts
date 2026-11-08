/**
 * The check of a unit against the writes the contract of the step in progress allows. A record of a type the step's products
 * are written as is the step's product, and a record of another type is written only in the fields the contract's `changes`
 * lists, an edge being a write of its relation. The records a unit owns are part of its record. A record of a type that
 * records actuality itself, such as a step's record, a fact or a log message, is actuality's write and isn't checked.
 */
import type { TStepWrites } from "../../steps/domains/contract.js";
import { isReferenced, isWholeRecord, type TUnit } from "../domains/unit.js";

/** Returns each write of a unit's record that `writes` doesn't allow, as `Type.field`. */
export function writesOutside(unit: TUnit, writes: TStepWrites, recordsActuality: (label: string) => boolean): string[] {
	const { label } = unit;
	if (recordsActuality(label) || writes.products.includes(label)) return [];
	const listed = new Set(writes.changes.flatMap(({ persistedAs, key }) => (persistedAs === label ? [key] : [])));
	const fields = isWholeRecord(unit) ? Object.keys(unit.record) : isReferenced(unit) ? [] : Object.keys(unit.fields);
	const relations = unit.edges === undefined ? [] : unit.edges.map(({ rel }) => rel);
	return [...new Set([...fields, ...relations])].filter((field) => !listed.has(field)).map((field) => `${label}.${field}`);
}

/** The refusal of a unit that writes outside the contract of the step in progress. */
export class WriteOutsideContract extends Error {
	constructor(
		readonly step: string,
		readonly outside: readonly string[],
	) {
		super(
			`${step} writes ${outside.join(", ")}, which its contract's products and changes don't list, so the store doesn't write the unit. List each field in the step's contract's changes, or write it from a step whose contract lists it`,
		);
	}
}
