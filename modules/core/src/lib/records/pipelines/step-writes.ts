/**
 * The check a store makes of each unit against the writes the contract of the step in progress allows. A refused write is
 * added to the step's refused writes, which the step's record lists, and the unit isn't written.
 */
import type { TStepWrites } from "../../steps/domains/contract.js";
import { WriteOutsideContract, writesOutside } from "../derivations/contract-writes.js";
import type { TUnit } from "../domains/unit.js";

/** Refuses a unit that writes outside `writes`, and adds each write outside them to the step's refused writes. A write outside a
 *  step, or in a step whose contract doesn't declare `changes`, isn't checked. */
export function assertWritesWithin(unit: TUnit, writes: TStepWrites | undefined, recordsActuality: (label: string) => boolean): void {
	if (writes === undefined) return;
	const outside = writesOutside(unit, writes, recordsActuality);
	if (outside.length === 0) return;
	writes.refused.push(...outside);
	throw new WriteOutsideContract(writes.step, outside);
}
