/** A machine changes state only through its transition. It sends each follower every move with the event that caused it. */
import { describe, it, expect } from "vitest";
import { Cell } from "./cell.js";
import { machine, type TMove } from "./machine.js";
import { assertTable, runSequences, pickWith, staying } from "./test/machine-table.js";

type TLight = "closed" | "opening" | "open";
type TEvent = "open" | "opened" | "close";
const EVENTS: TEvent[] = ["open", "opened", "close"];
const transition = (state: TLight, event: TEvent): TLight =>
	event === "close" ? "closed" : state === "closed" && event === "open" ? "opening" : state === "opening" && event === "opened" ? "open" : state;
const TABLE: Record<TLight, Record<TEvent, TLight>> = {
	closed: staying(EVENTS, "closed", { open: "opening" }),
	opening: staying(EVENTS, "opening", { opened: "open", close: "closed" }),
	open: staying(EVENTS, "open", { close: "closed" }),
};

describe("a cell", () => {
	it("calls each subscriber with the new value and the value it replaced, and doesn't call a subscriber for an unchanged value", () => {
		const cell = new Cell(1);
		const told: [number, number][] = [];
		const stop = cell.subscribe((value, before) => told.push([value, before]));
		cell.set(2);
		cell.set(2);
		stop();
		cell.set(3);
		expect(told).toEqual([[2, 1]]);
		expect(cell.get()).toBe(3);
	});
});

describe("a machine", () => {
	it("moves as its table states", () => {
		assertTable(TABLE, { closed: "closed", opening: "opening", open: "open" }, { events: EVENTS, statusOf: (state) => state, event: (type) => type, transition });
	});

	it("calls a follower with each move and its event, and doesn't call a follower for an event that leaves the state unchanged", () => {
		const light = machine<TLight, TEvent>("closed", transition);
		const moves: TMove<TLight, TEvent>[] = [];
		light.follow((move) => moves.push(move));
		light.dispatch("opened");
		light.dispatch("open");
		expect(moves).toEqual([{ event: "open", before: "closed", after: "opening" }]);
		expect(light.state.get()).toBe("opening");
	});

	it("holds the state its table states after any sequence of events", () => {
		runSequences(
			() => ({ light: machine<TLight, TEvent>("closed", transition), expected: "closed" as TLight }),
			(context, random, label) => {
				const event = pickWith(random, EVENTS);
				context.expected = TABLE[context.expected][event];
				expect(context.light.dispatch(event), label(event)).toBe(context.expected);
			},
		);
	});
});
