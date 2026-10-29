/**
 * The axioms pane's lines: the line a key moves to, what is behind a line, the summary of kinds, what the pane states of the
 * reader's line, and the frames that state the reader's active records.
 */
import { describe, expect, it } from "vitest";
import { graphAxioms } from "../../../derivations/graph-axioms.js";
import { lineAfterKey, linesOf, provenanceOf, statusOf, summaryOf } from "./source-lines.js";

/** Two emails, the second a reply to the first, whose id holds quotes. */
const [QUOTED, PLAIN] = ['say "hi"', "m2"];
const REPLY = "inReplyTo";
const axioms = graphAxioms(
	{
		nodes: [
			{ id: QUOTED, type: "Email", properties: { subject: "Roadmap" } },
			{ id: PLAIN, type: "Email", properties: {} },
		],
		edges: [{ from: PLAIN, to: QUOTED, predicate: REPLY, graph: "Email" }],
	},
	[],
	(_type, edge) => edge,
);
const [CLASS, QUOTED_LINE] = ["Class Email", `Individual ${QUOTED}`];

describe("lineAfterKey", () => {
	const names = ["n1", "p1", "e1"];
	it.each([
		["ArrowDown", "n1", "p1"],
		["ArrowDown", "e1", "e1"],
		["ArrowUp", "p1", "n1"],
		["ArrowUp", "n1", "n1"],
		["Home", "e1", "n1"],
		["End", "n1", "e1"],
	])("%s from %s moves to %s", (key, from, to) => expect(lineAfterKey(names, from, key)).toBe(to));
	it("starts at the first line where a reader isn't on one, and leaves a key that doesn't move a reader", () => {
		expect(lineAfterKey(names, null, "ArrowUp")).toBe("n1");
		expect(lineAfterKey(names, "p1", "Enter")).toBeUndefined();
		expect(lineAfterKey([], null, "ArrowDown")).toBeUndefined();
	});
});

describe("what a line states to a reader", () => {
	it("states a line's axioms in DL notation, the statement behind it, and the record that asserted it", () => {
		const frame = axioms.frames.find(({ name }) => name === QUOTED_LINE);
		expect(frame && provenanceOf(frame)).toBe(`Email(<say%20%22hi%22>) · subject(<say%20%22hi%22>, "Roadmap") · Email ${QUOTED} · asserted by Email ${QUOTED}`);
	});
	it("summarises the axioms' kinds with their counts", () => {
		expect(summaryOf(axioms.summary)).toBe("classes 1 · properties 1 · individuals 2");
	});
	it("states the reader's line as its hover does, or how many lines state the record the reader is on", () => {
		const line = axioms.frames.find(({ name }) => name === QUOTED_LINE);
		expect(statusOf(line, new Set())).toBe(line && provenanceOf(line));
		expect(statusOf(undefined, new Set(["n1"]))).toBe("the selection lights 1 line");
		expect(statusOf(undefined, new Set())).toBe("");
	});
});

describe("the lines that state the record a reader is on", () => {
	it("lights the record's own line and its class's", () => {
		expect(linesOf(axioms, [QUOTED])).toEqual([CLASS, QUOTED_LINE]);
		expect(linesOf(axioms, [])).toEqual([]);
	});
});
