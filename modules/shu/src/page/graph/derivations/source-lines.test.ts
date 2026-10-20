/**
 * The source pane's lines and the selection that links them to the scene both ways: the line a key moves to, what is behind a
 * line, the summary of kinds, and the mapping between the scene's ids and the projection's, for a graph of records whose ids the
 * projection's constants name and for the terms of a source drawn as the projection names them.
 */
import { describe, expect, it } from "vitest";
import { constantOf, literalOf, nameOfText, type TFormula, type TTerm } from "@haibun/logic/derivations/formula.js";
import { edgeKey, projected } from "@haibun/logic/derivations/term-graph.js";
import { lineAfterKey, linesOfScene, provenanceOf, sceneOfLine, statusOf, summaryOf } from "./source-lines.js";

const atom = (predicate: string, ...args: TTerm[]): TFormula => ({ atom: predicate, args });
/** A record whose id the projection's constant names in JSON's escapes, beside one it names as it is. */
const [QUOTED, PLAIN] = ['say "hi"', "m2"];
const RECORD = { persistedAs: "Email", id: QUOTED };
const projection = projected([
	{ name: "n1", role: "axiom", formula: atom("Email", constantOf(QUOTED)), statement: `Email ${QUOTED}`, assertedBy: RECORD },
	{ name: "p1", role: "axiom", formula: atom("subject", constantOf(QUOTED), literalOf("Roadmap")), statement: `Email ${QUOTED}`, assertedBy: RECORD },
	{ name: "e1", role: "axiom", formula: atom("inReplyTo", constantOf(PLAIN), constantOf(QUOTED)), statement: "Email m2" },
	{
		name: "goal",
		role: "conjecture",
		formula: { quantifier: "?", variables: ["X1"], body: atom("inReplyTo", { variable: "X1" }, constantOf(QUOTED)) },
		statement: "resolve reply",
	},
]);
const RECORDS = { nodes: [QUOTED, PLAIN], edges: [{ from: PLAIN, predicate: "inReplyTo", to: QUOTED }] };

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
	it("states the statement behind a line, and the record that asserted it", () => {
		const [n1, , e1] = projection.formulas;
		expect(n1 && provenanceOf(n1)).toBe(`Email ${QUOTED} · asserted by Email ${QUOTED}`);
		expect(e1 && provenanceOf(e1)).toBe("Email m2");
	});
	it("summarises the source's kinds with their counts", () => {
		expect(summaryOf(projection.summary)).toBe("axioms 3 · rules 0 · conjectures 1");
	});
	it("states what a reader's line lights in the scene, or how many lines state the scene's selection", () => {
		expect(statusOf("e1", { nodes: ["a", "b"], edges: ["k"] }, new Set())).toBe("e1 lights 2 nodes and 1 edge");
		expect(statusOf(null, null, new Set(["n1"]))).toBe("the selection lights 1 line");
		expect(statusOf(null, null, new Set())).toBe("");
	});
});

describe("the selection between the scene and the lines", () => {
	it("lights the lines that state a record a reader chose in a graph of records, through the text its constant names", () => {
		expect(linesOfScene(projection, nameOfText, { nodes: [QUOTED], edges: [] })).toEqual(["n1", "p1", "e1", "goal"]);
		expect(linesOfScene(projection, nameOfText, { nodes: [], edges: RECORDS.edges }), "an edge lights the line that states it").toEqual(["e1"]);
	});
	it("lights the records and the edge a line states, among those the scene draws", () => {
		expect(sceneOfLine(projection, nameOfText, "e1", RECORDS)).toEqual({ nodes: [QUOTED, PLAIN], edges: [edgeKey(PLAIN, "inReplyTo", QUOTED)] });
		expect(sceneOfLine(projection, nameOfText, "p1", RECORDS), "a literal isn't a record the scene draws").toEqual({ nodes: [QUOTED], edges: [] });
	});
	it("maps the terms of a source as the projection names them", () => {
		const terms = { nodes: projection.nodes.map(({ id }) => id), edges: projection.edges.map(({ from, label, to }) => ({ from, predicate: label, to })) };
		const named = nameOfText(QUOTED);
		expect(sceneOfLine(projection, (id) => id, "goal", terms)).toEqual({ nodes: [named, "goal:X1"], edges: [edgeKey("goal:X1", "inReplyTo", named)] });
		expect(linesOfScene(projection, (id) => id, { nodes: ["goal:X1"], edges: [] })).toEqual(["goal"]);
	});
});
