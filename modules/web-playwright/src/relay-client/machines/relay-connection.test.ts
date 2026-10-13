/** The relay connection's tab statuses, held to their table, its close by its tabs, and seeded random sequences of events. */
import { describe, expect, it } from "vitest";
import { assertTable, pickWith, runSequences, staying } from "@haibun/core/lib/test/machine-table.js";
import {
	CLOSE,
	CLOSED_BECAUSE,
	INITIAL_RELAY_CONNECTION,
	RELAY_TAB_EVENT,
	relayConnectionTransition,
	TAB_STATUS,
	tabStatusOf,
	type TRelayConnectionEvent,
	type TRelayConnectionState,
	type TTabStatus,
} from "./relay-connection.js";

const TAB_EVENTS = Object.values(RELAY_TAB_EVENT);
type TTabEventType = (typeof TAB_EVENTS)[number];
const { ABSENT, PERMITTED, ATTACHED, REATTACHING, CLOSING } = TAB_STATUS;
const TAB = 1;
/** Another tab the debugger is on, which keeps the connection open while the table moves the first. */
const OTHER = 2;

const TABLE: Record<TTabStatus, Record<TTabEventType, TTabStatus>> = {
	[ABSENT]: staying(TAB_EVENTS, ABSENT, { permitted: PERMITTED }),
	[PERMITTED]: staying(TAB_EVENTS, PERMITTED, { attached: ATTACHED, removed: ABSENT }),
	[ATTACHED]: staying(TAB_EVENTS, ATTACHED, { released: PERMITTED, detached: PERMITTED, lost: REATTACHING, removed: CLOSING }),
	[REATTACHING]: staying(TAB_EVENTS, REATTACHING, { attached: ATTACHED, released: PERMITTED, detached: PERMITTED, "reattach-ended": PERMITTED, removed: ABSENT }),
	[CLOSING]: staying(TAB_EVENTS, CLOSING, { released: ABSENT, detached: ABSENT, lost: ABSENT }),
};

/** A state with the first tab at `status` and the other tab attached. */
const withTab = (status: TTabStatus): TRelayConnectionState => ({
	tabs: new Map<number, TTabStatus>([...(status === ABSENT ? [] : ([[TAB, status]] as const)), [OTHER, ATTACHED]]),
	cooling: new Set(),
	everAttached: true,
});

const run = (events: TRelayConnectionEvent[], from = INITIAL_RELAY_CONNECTION) => events.reduce(relayConnectionTransition, from);
const on = (type: TTabEventType, tabId = TAB): TRelayConnectionEvent => ({ type, tabId });

describe("a relay connection's tab statuses", () => {
	it("move as the table states", () => {
		const at = { [ABSENT]: withTab(ABSENT), [PERMITTED]: withTab(PERMITTED), [ATTACHED]: withTab(ATTACHED), [REATTACHING]: withTab(REATTACHING), [CLOSING]: withTab(CLOSING) };
		assertTable(TABLE, at, { events: TAB_EVENTS, statusOf: (state) => tabStatusOf(state, TAB), event: (type) => on(type), transition: relayConnectionTransition });
	});

	it("don't reattach a tab whose debugger detached again within its cooldown, and reattach it once the cooldown passed", () => {
		const lostOnce = run([on("permitted"), on("attached"), on("lost"), on("attached"), on("lost")]);
		expect(tabStatusOf(lostOnce, TAB)).toBe(PERMITTED);
		const cooled = run([on("permitted"), on("attached"), on("lost"), on("cooled"), on("attached"), on("lost")]);
		expect(tabStatusOf(cooled, TAB)).toBe(REATTACHING);
	});
});

describe("a relay connection's close", () => {
	it("follows the browser's detachment of the last attached tab, and not the relay's own release of it", () => {
		expect(run([on("permitted"), on("attached"), on("released")]).closedBecause).toBeUndefined();
		expect(run([on("permitted"), on("attached"), on("detached")]).closedBecause).toBe(CLOSED_BECAUSE.allDetached);
		expect(run([on("permitted"), on("attached"), on("lost")]).closedBecause, "a reattachment holds it open").toBeUndefined();
		expect(run([on("permitted"), on("attached"), on("lost"), on("reattach-ended")]).closedBecause).toBe(CLOSED_BECAUSE.allDetached);
	});

	it("follows the person's close of the last tab the relay may use, and not of a tab it doesn't follow", () => {
		expect(run([on("permitted"), on("removed", OTHER)]).closedBecause).toBeUndefined();
		expect(run([on("permitted"), on("permitted", OTHER), on("removed")]).closedBecause).toBeUndefined();
		expect(run([on("permitted"), on("removed")]).closedBecause).toBe(CLOSED_BECAUSE.tabsClosed);
	});

	it("keeps the first cause of its close", () => {
		const closed = run([on("permitted"), { type: CLOSE, reason: "the person detached" }, on("removed")]);
		expect(closed.closedBecause).toBe("the person detached");
		expect(relayConnectionTransition(closed, on("permitted", OTHER))).toBe(closed);
	});

	it("stays closed once closed, and holds a tab only while the relay may use it or the debugger is on it", () => {
		const events: TRelayConnectionEvent[] = [...TAB_EVENTS.flatMap((type) => [on(type), on(type, OTHER)]), { type: CLOSE, reason: "ended" }];
		runSequences(
			() => ({ state: INITIAL_RELAY_CONNECTION }),
			(context, random, label) => {
				const event = pickWith(random, events);
				const before = context.state;
				context.state = relayConnectionTransition(before, event);
				if (before.closedBecause !== undefined) expect(context.state, label(event.type)).toBe(before);
				expect(context.state.everAttached || !before.everAttached, label(event.type)).toBe(true);
				for (const status of context.state.tabs.values()) expect(status, label(event.type)).not.toBe(ABSENT);
			},
		);
	});
});
