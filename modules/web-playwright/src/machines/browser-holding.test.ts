/** A browser holding's statuses, held to their table, and over seeded random sequences of events. */
import { describe, expect, it } from "vitest";
import { assertTable, pickWith, runSequences, staying } from "@haibun/core/lib/test/machine-table.js";
import { HOLDING_EVENT, HOLDING_STATUS, holdingTransition, INITIAL_HOLDING, type THoldingEvent, type THoldingStatus } from "./browser-holding.js";

const EVENTS = Object.values(HOLDING_EVENT);
type TType = THoldingEvent["type"];
const { UNOPENED, OPEN, ADOPTED, CLOSED } = HOLDING_STATUS;

const TABLE: Record<THoldingStatus, Record<TType, THoldingStatus>> = {
	[UNOPENED]: staying(EVENTS, UNOPENED, { opened: OPEN, adopted: ADOPTED }),
	[OPEN]: staying(EVENTS, OPEN, { closed: CLOSED }),
	[ADOPTED]: staying(EVENTS, ADOPTED, { closed: CLOSED }),
	[CLOSED]: staying(EVENTS, CLOSED, { opened: OPEN, adopted: ADOPTED }),
};

describe("a browser holding's statuses", () => {
	it("move as the table states", () => {
		const at = { [UNOPENED]: UNOPENED, [OPEN]: OPEN, [ADOPTED]: ADOPTED, [CLOSED]: CLOSED };
		assertTable(TABLE, at, { events: EVENTS, statusOf: (status) => status, event: (type) => ({ type }), transition: holdingTransition });
	});

	it("keep the way a holding was taken until it closes, so actuality closes only what it opened", () => {
		runSequences(
			() => ({ status: INITIAL_HOLDING, taken: undefined as THoldingStatus | undefined }),
			(context, random, label) => {
				const type = pickWith(random, EVENTS);
				context.status = holdingTransition(context.status, { type });
				if (type === HOLDING_EVENT.CLOSED) context.taken = undefined;
				else context.taken ??= type === HOLDING_EVENT.OPENED ? OPEN : ADOPTED;
				expect(context.status, label(type)).toBe(context.taken ?? (context.status === UNOPENED ? UNOPENED : CLOSED));
			},
		);
	});
});
