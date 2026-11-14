/**
 * The check a store makes of a unit's parts against the writes the contract of the step in progress allows. A refused write is
 * added to the step's refused writes, which the step's record lists, and the unit isn't written. Each part of a unit within the
 * contract is added to the step's written records.
 */
import type { TStepWrites } from "../../steps/domains/contract.js";
import { writesOutside, type TPartChanges } from "../derivations/contract-writes.js";
import { WriteOutsideContract } from "../domains/unit.js";

/** Refuses a unit whose parts change what `writes` doesn't allow, and adds each change outside them to the step's refused writes.
 *  A step that writes the types of the units it gives the store reads those types from the unit's parts. A unit within them adds
 *  each of its parts to the step's written records.
 *  A write outside a step, or in a step on the contracts baseline, isn't checked. */
export function assertWritesWithin(parts: readonly TPartChanges[], writes: TStepWrites | undefined): void {
	if (writes === undefined) return;
	// A step that writes the types of the units it gives the store writes each part's type whole, as it writes a product.
	const allowed = writes.unitsGiven ? { ...writes, products: [...writes.products, ...parts.map(({ label }) => label)] } : writes;
	const outside = parts.flatMap((part) => writesOutside(part, allowed));
	if (outside.length === 0) {
		writes.written.push(...parts.map(({ label, id }) => ({ label, id })));
		return;
	}
	writes.refused.push(...outside);
	throw new WriteOutsideContract(writes.step, outside);
}
