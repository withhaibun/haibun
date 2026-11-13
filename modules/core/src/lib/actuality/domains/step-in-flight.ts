/**
 * The record name of the step in progress, which a store links each record's first write to through `prov:wasGeneratedBy`.
 */
import { inCall } from "../../domains/capability-context.js";
import { formatRecordName, parseSeqPath } from "./seq-path.js";

/** Returns the record name of the step this call is part of in the actuality feature `actuality` names, or undefined outside a
 *  dispatch. A step path repeats in every actuality of a feature, so the name holds the actuality feature as well as the path. */
export function stepRecordInFlight(actuality: string): string | undefined {
	const step = inCall()?.step;
	const path = step === undefined ? null : parseSeqPath(step.seqPath);
	return path === null ? undefined : formatRecordName({ actuality, path });
}

/** Returns the record name of the step in progress in the actuality feature `actuality` names. Throws outside a dispatch, naming
 *  what `writes` writes, since that record is identified by the step that writes it. */
export function stepRecordWriting(actuality: string, writes: string): string {
	const step = stepRecordInFlight(actuality);
	if (step === undefined) throw new Error(`${writes} is written within the step that writes it, and a step isn't in progress`);
	return step;
}
