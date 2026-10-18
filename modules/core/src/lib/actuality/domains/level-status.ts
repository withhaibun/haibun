/**
 * The status of a level of actuality, as the actuality machine moves it and a reader of a run's events states it.
 */
import { STATUS } from "../../domains/protocol.js";

/** The words of a level's status: pending until it starts, running until it ends, and how it ended. */
export const LEVEL_STATUS = { pending: STATUS.pending, running: STATUS.running, completed: STATUS.completed, failed: STATUS.failed, stopped: STATUS.stopped } as const;
export type TLevelStatus = (typeof LEVEL_STATUS)[keyof typeof LEVEL_STATUS];
