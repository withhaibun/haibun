/**
 * The one way a lifecycle event of a level leaves actuality: as a move of the actuality machine. The machine takes the
 * event, the record of the level it starts or ends is written, then the events hub emits it, so a reader of the stream
 * holds the levels the machine holds and a reader of the store holds their records. An actuality that a phase stopped before
 * it started doesn't hold a record, so its end is taken and emitted without one.
 */
import type { TLifecycleEvent } from "../../domains/protocol.js";
import type { TWorld } from "../domains/world.js";
import type { IQuadStore } from "../../steps/ports.js";
import { SEQ_PATH_LABEL } from "../../domains/resources.js";
import { writtenLevel } from "../../domains/capability-context.js";
import { SEQ_PATH_ACCESS } from "../domains/seq-path.js";
import type { TActuality, TActualityMove } from "../machines/actuality.js";
import { levelRecord, type TLevelNaming, type TStepRecord } from "../derivations/step-records.js";
import { phaseFailureEvent } from "../derivations/lifecycle-events.js";

/** The records of actuality's levels by their events' id: a level's start writes its record, and its end extends it. */
export type TLevelRecords = Map<string, TStepRecord>;

/** A move of the actuality machine, the state after it and when it happened, from which a level's record is written. */
export type TLevelMoved = { move: TActualityMove; after: TActuality; timestamp: number };

/** Writes the record of the level a move starts or ends, with the fields `stated` adds to it, at the level the call in progress
 *  writes a SeqPath record at, and returns it. A step's move doesn't write a record here, since dispatchStep writes a step's record. */
export async function writeLevelRecord(store: IQuadStore, levels: TLevelRecords, { move, after, timestamp }: TLevelMoved, naming: TLevelNaming, stated?: TStepRecord) {
	const record = levelRecord(move, after, naming, move.stage === "end" ? levels.get(move.id) : undefined, timestamp, writtenLevel(SEQ_PATH_ACCESS));
	if (record === undefined) return undefined;
	const written = { ...record, ...stated };
	levels.set(move.id, written);
	await store.upsertIndividual(SEQ_PATH_LABEL, written);
	return written;
}

/** Moves the actuality machine with a level's event, writes the level's record with the fields `stated` adds, and emits the
 *  event. Throws where the machine refuses it: the Executor moves each level in order, so a refused move is a fault. */
export async function moveActuality(world: TWorld, event: TLifecycleEvent, stated?: TStepRecord): Promise<void> {
	const held = world.runtime.actuality;
	const before = held.state.get();
	const after = held.dispatch(event);
	if (after === before)
		throw new Error(`actuality refused the ${event.type} ${event.stage} of ${event.id} while the actuality is ${before.status}; start a level before its end, and end it once`);
	await writeLevelRecord(world.shared.getStore(), world.runtime.levels, { move: event, after, timestamp: event.timestamp }, world.tag, stated);
	world.eventLogger.emit(event);
}

/** Ends actuality as failed where a phase failed before the features ended, stating the phase and why it failed, so a reader of
 *  its events, such as the launcher of an instance that stays, reads the failure while the process stays. Actuality that started
 *  extends the record of its start; actuality that a phase stopped before it started doesn't hold a record, so the machine takes
 *  its end and the events hub emits it. */
export async function endAtPhaseFailure(world: TWorld, phase: string, error: string): Promise<void> {
	const event = phaseFailureEvent(phase, error, world.clock.now());
	if (world.runtime.levels.has(event.id)) return await moveActuality(world, event);
	world.runtime.actuality.dispatch(event);
	world.eventLogger.emit(event);
}
