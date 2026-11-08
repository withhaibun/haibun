/**
 * The check a store makes of a unit's parts against the writes the contract of the step in progress allows. A refused write is
 * added to the step's refused writes, which the step's record lists, and the unit isn't written.
 */
import type { TStepWrites } from "../../steps/domains/contract.js";
import { writesOutside, type TPartChanges } from "../derivations/contract-writes.js";
import { WriteOutsideContract } from "../domains/unit.js";

/** Refuses a unit whose parts change what `writes` doesn't allow, and adds each change outside them to the step's refused writes.
 *  A write outside a step, or in a step on the contracts baseline, isn't checked. */
export function assertWritesWithin(parts: readonly TPartChanges[], writes: TStepWrites | undefined): void {
	if (writes === undefined) return;
	const outside = parts.flatMap((part) => writesOutside(part, writes));
	if (outside.length === 0) return;
	writes.refused.push(...outside);
	throw new WriteOutsideContract(writes.step, outside);
}
