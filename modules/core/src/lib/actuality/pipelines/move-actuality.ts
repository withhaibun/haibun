/**
 * The one way a lifecycle event of a level leaves actuality: as a move of the actuality machine. The machine takes the
 * event, then the events hub emits it, so a reader of the stream holds the levels the machine holds.
 */
import type { TLifecycleEvent } from "../../../schema/protocol.js";
import type { TWorld } from "../domains/world.js";
import { isActualityMove } from "../machines/actuality.js";

/** Moves the actuality machine with a level's event and emits the event. Throws where the event isn't a level's, or where
 *  the machine refuses it: the Executor moves each level in order, a start before its end, so a refused move is a fault. */
export function moveActuality(world: TWorld, event: TLifecycleEvent): void {
	if (!isActualityMove(event)) throw new Error(`a ${event.type} event isn't a move of actuality's levels; emit it through the events hub`);
	const held = world.runtime.actuality;
	const before = held.state.get();
	if (held.dispatch(event) === before)
		throw new Error(`actuality refused the ${event.type} ${event.stage} of ${event.id} while the execution is ${before.status}; start a level before its end, and end it once`);
	world.eventLogger.emit(event);
}
