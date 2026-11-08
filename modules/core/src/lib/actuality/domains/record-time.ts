/** The time on actuality's clock, as a record states a time. */
import type { TWorld } from "./world.js";

/** Returns the time on `world`'s clock as an ISO 8601 text. A record's write states it as the record's time. */
export const recordTime = (world: Pick<TWorld, "clock">): string => new Date(world.clock.now()).toISOString();
