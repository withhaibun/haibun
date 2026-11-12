/**
 * The check of a unit's parts against the writes the contract of the step in progress allows. A record of a type the step's
 * products are written as is the step's product, and a record of another type changes only the fields the contract's `changes`
 * lists, an edge being a change of its relation. A relation that `changes` lists without a type is a change of any record. Every
 * part of a unit is checked, the records the unit owns included. A record of a type in `ACTUALITY_RECORDS` is actuality's record
 * of itself, and isn't checked.
 */
import type { TStepWrites } from "../../steps/domains/contract.js";
import { FACT_LABEL, SEQ_PATH_LABEL } from "../../domains/resources.js";
import { LOG_MESSAGE_LABEL } from "../../domains/log-message.js";
import { SHARED_GRAPH } from "../../steps/domains/quad-types.js";

/** The types whose records actuality writes of itself during a step: the step's own record, the facts it asserts, the variables it
 *  sets and the messages it logs. A step's contract doesn't hold them. */
export const ACTUALITY_RECORDS: ReadonlySet<string> = new Set([SEQ_PATH_LABEL, FACT_LABEL, SHARED_GRAPH, LOG_MESSAGE_LABEL]);

/** A part's changes, as the store holding it computes them: its type, and each field and relation that changes what it holds. */
export type TPartChanges = { readonly label: string; readonly changed: readonly string[] };

/** Returns each change of a part that `writes` doesn't allow, as `Type.field`. */
export function writesOutside({ label, changed }: TPartChanges, writes: TStepWrites): string[] {
	if (ACTUALITY_RECORDS.has(label) || writes.products.includes(label)) return [];
	const listed = new Set(writes.changes.flatMap((change) => ("relation" in change ? [change.relation] : change.persistedAs === label ? [change.key] : [])));
	return [...new Set(changed)].filter((field) => !listed.has(field)).map((field) => `${label}.${field}`);
}
