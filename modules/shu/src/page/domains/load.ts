/**
 * A read a view shows: pending before it starts, running, completed with what it read, or failed with its refusal.
 * `machines/load.ts` moves it.
 */
import { STATUS } from "@haibun/core/schema/protocol.js";
import type { TPageRefusal } from "./refusal.js";

/** A read's statuses, a subset of the status vocabulary. */
export const LOAD_STATUS = { PENDING: STATUS.pending, RUNNING: STATUS.running, COMPLETED: STATUS.completed, FAILED: STATUS.failed } as const;
export type TLoadStatus = (typeof LOAD_STATUS)[keyof typeof LOAD_STATUS];

export type TLoadState<T> =
	| { status: typeof LOAD_STATUS.PENDING }
	| { status: typeof LOAD_STATUS.RUNNING }
	| { status: typeof LOAD_STATUS.COMPLETED; page: T }
	| { status: typeof LOAD_STATUS.FAILED; refusal: TPageRefusal };

export const LOAD_EVENT = { START: "start", COMPLETE: "complete", FAIL: "fail" } as const;

export type TLoadEvent<T> = { type: typeof LOAD_EVENT.START } | { type: typeof LOAD_EVENT.COMPLETE; page: T } | { type: typeof LOAD_EVENT.FAIL; refusal: TPageRefusal };

export const INITIAL_LOAD = { status: LOAD_STATUS.PENDING } as const satisfies TLoadState<never>;
