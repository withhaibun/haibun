/** The event stream's statuses, held to their table, and over seeded random sequences of events. */
import { describe, expect, it } from "vitest";
import { assertTable, pickWith, runSequences, staying } from "@haibun/core/lib/test/machine-table.js";
import { STREAM_EVENT, STREAM_STATUS, streamTransition, type TStreamEvent, type TStreamStatus } from "./event-stream.js";

const EVENTS = Object.values(STREAM_EVENT);
type TType = TStreamEvent["type"];
const { UNCONNECTED, OPEN, RECONNECTING, CLOSED } = STREAM_STATUS;

const TABLE: Record<TStreamStatus, Record<TType, TStreamStatus>> = {
	[UNCONNECTED]: staying(EVENTS, UNCONNECTED, { opened: OPEN, close: CLOSED }),
	[OPEN]: staying(EVENTS, OPEN, { broke: RECONNECTING, close: CLOSED }),
	[RECONNECTING]: staying(EVENTS, RECONNECTING, { opened: OPEN, close: CLOSED }),
	[CLOSED]: staying(EVENTS, CLOSED, {}),
};

describe("the event stream's statuses", () => {
	it("move as the table states", () => {
		const at = { [UNCONNECTED]: UNCONNECTED, [OPEN]: OPEN, [RECONNECTING]: RECONNECTING, [CLOSED]: CLOSED };
		assertTable(TABLE, at, { events: EVENTS, statusOf: (status) => status, event: (type) => ({ type }), transition: streamTransition });
	});

	it("are open after each opening until a break, and closed for good once closed", () => {
		runSequences(
			() => ({ status: UNCONNECTED as TStreamStatus, closed: false }),
			(context, random, label) => {
				const type = pickWith(random, EVENTS);
				const before = context.status;
				context.status = streamTransition(context.status, { type });
				context.closed ||= type === STREAM_EVENT.CLOSE;
				if (context.closed) expect(context.status, label(type)).toBe(CLOSED);
				else if (type === STREAM_EVENT.OPENED) expect(context.status, label(type)).toBe(OPEN);
				else if (type === STREAM_EVENT.BROKE) expect(context.status, label(type)).toBe(before === OPEN ? RECONNECTING : before);
			},
		);
	});
});
