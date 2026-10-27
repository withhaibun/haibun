/**
 * The source pane's lines and the selection that links them to the scene both ways: the line a key moves to, what is behind a
 * line, the summary of kinds, and the frames that state the records and edges a reader chose in the scene.
 */
import { describe, expect, it } from "vitest";
import { graphDescription } from "../../../derivations/graph-description.js";
import { edgeKey } from "./focus-policy.js";
import { lineAfterKey, linesOfScene, provenanceOf, sceneOfLine, statusOf, summaryOf } from "./source-lines.js";

/** Two emails, the second a reply to the first, whose id holds quotes. */
const [QUOTED, PLAIN] = ['say "hi"', "m2"];
const REPLY = "inReplyTo";
const description = graphDescription(
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
const RECORDS = { nodes: [QUOTED, PLAIN], edges: [{ from: PLAIN, predicate: REPLY, to: QUOTED }] };
const [CLASS, PROPERTY, QUOTED_LINE, PLAIN_LINE] = ["Class Email", `ObjectProperty ${REPLY}`, `Individual ${QUOTED}`, `Individual ${PLAIN}`];

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
		const frame = description.frames.find(({ name }) => name === QUOTED_LINE);
		expect(frame && provenanceOf(frame)).toBe(`Email(<say%20%22hi%22>) · subject(<say%20%22hi%22>, "Roadmap") · Email ${QUOTED} · asserted by Email ${QUOTED}`);
	});
	it("summarises the description's kinds with their counts", () => {
		expect(summaryOf(description.summary)).toBe("classes 1 · properties 1 · individuals 2");
	});
	it("states what a reader's line lights in the scene, or how many lines state the scene's selection", () => {
		expect(statusOf("e1", { nodes: ["a", "b"], edges: ["k"] }, new Set())).toBe("e1 lights 2 nodes and 1 edge");
		expect(statusOf(null, null, new Set(["n1"]))).toBe("the selection lights 1 line");
		expect(statusOf(null, null, new Set())).toBe("");
	});
});

describe("the selection between the scene and the lines", () => {
	it("lights the lines that state a record or an edge a reader chose", () => {
		expect(linesOfScene(description, { nodes: [QUOTED], edges: [] })).toEqual([CLASS, QUOTED_LINE]);
		expect(linesOfScene(description, { nodes: [], edges: RECORDS.edges }), "an edge lights the lines that state it").toEqual([PROPERTY, PLAIN_LINE]);
	});
	it("lights the records and the edges a line states, among those the scene draws", () => {
		expect(sceneOfLine(description, PLAIN_LINE, RECORDS)).toEqual({ nodes: [PLAIN], edges: [edgeKey(PLAIN, REPLY, QUOTED)] });
		expect(sceneOfLine(description, CLASS, RECORDS), "a class lights its records").toEqual({ nodes: [QUOTED, PLAIN], edges: [] });
	});
});
