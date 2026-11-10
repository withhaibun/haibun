/**
 * Writes and removes a batch of units through a store's verbs, one unit after another. A store without transactions writes and
 * removes a batch this way, and each unit it refuses is reported in its place while the others are written or removed.
 */
import { errorDetail } from "../../domains/util.js";
import { WRITE_VERB, type TRemoval, type TUnitRemoved, type TUnitWrite, type TUnitWritten, type TWritePort } from "../domains/unit.js";

/** The verbs that write a unit of a batch. */
type TUnitVerbs = Pick<TWritePort, "create" | "update" | "merge">;

/** Writes one unit of a batch through its verb, and returns the id of its record. */
export const writeUnitOf = (port: TUnitVerbs, unit: TUnitWrite): Promise<string> =>
	unit.verb === WRITE_VERB.update ? port.update(unit.node, unit.version) : port[unit.verb](unit.node);

/** Writes each unit in order, and returns the id of each unit's record, or why the store didn't write it. */
export async function writeEach(port: TUnitVerbs, units: readonly TUnitWrite[]): Promise<TUnitWritten[]> {
	const written: TUnitWritten[] = [];
	for (const unit of units)
		written.push(
			await writeUnitOf(port, unit).then(
				(id) => ({ id }),
				(caught: unknown) => ({ refused: errorDetail(caught) }),
			),
		);
	return written;
}

/** Makes each removal in order, and returns the record each removed, or why the store didn't make it. */
export async function removeEach(port: Pick<TWritePort, "remove">, removals: readonly TRemoval[]): Promise<TUnitRemoved[]> {
	const removed: TUnitRemoved[] = [];
	for (const removal of removals)
		removed.push(
			await port.remove(removal).then(
				() => ({ removed: { label: removal.label, id: removal.id } }),
				(caught: unknown) => ({ refused: errorDetail(caught) }),
			),
		);
	return removed;
}
