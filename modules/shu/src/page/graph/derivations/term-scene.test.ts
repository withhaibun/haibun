/**
 * A source's term graph as the scene draws it: each node a subject of its kind, each edge a quad labelled by its predicate, a
 * variable hollow, a quantified rule's cluster badged, and the statements behind each node and edge.
 */
import { describe, expect, it } from "vitest";
import { constantOf, type TFormula, type TTerm } from "@haibun/logic/derivations/formula.js";
import { edgeKey, projected } from "@haibun/logic/derivations/term-graph.js";
import { termScene } from "./term-scene.js";

const atom = (predicate: string, ...args: TTerm[]): TFormula => ({ atom: predicate, args });
const [M1, M2] = [constantOf("m1"), constantOf("m2")];
const X1 = { variable: "X1" };
const projection = projected([
	{ name: "n1", role: "axiom", formula: atom("Email", M1), statement: "Email m1", assertedBy: { persistedAs: "Email", id: "m1" } },
	{ name: "e1", role: "axiom", formula: atom("inReplyTo", M2, M1), statement: "Email m2", assertedBy: { persistedAs: "Email", id: "m2" } },
	{
		name: "r1",
		role: "axiom",
		formula: { quantifier: "!", variables: ["X1"], body: { connective: "=>", left: atom("Email", X1), right: atom("inReplyTo", X1, M1) } },
		statement: "reply to {email}",
	},
]);

describe("termScene", () => {
	const { quads, clusters, styles } = termScene(projection);

	it("draws each node as a subject of its kind and each edge as a quad its predicate labels", () => {
		expect(quads.filter(({ objectType }) => objectType === undefined).map(({ subject, namedGraph }) => [subject, namedGraph])).toEqual([
			["m1", "Email"],
			["m2", "constant"],
			["r1:X1", "r1"],
		]);
		expect(quads.filter(({ objectType }) => objectType !== undefined).map(({ subject, predicate, object }) => [subject, predicate, object])).toEqual([
			["m2", "inReplyTo", "m1"],
			["r1:X1", "inReplyTo", "m1"],
		]);
		expect(clusters.map(({ type }) => type)).toEqual(["Email", "constant", "r1"]);
	});

	it("requests a variable hollow and a badge on the quantified rule's cluster", () => {
		expect([...styles.hollow]).toEqual(["r1:X1"]);
		expect([...styles.badges]).toEqual([["r1", "∀"]]);
	});

	it("states the statements behind each node once, and the statement behind each edge", () => {
		expect(styles.behind.get("m1")).toBe("Email m1 · Email m2 · reply to {email}");
		expect(styles.behind.get("r1:X1")).toBe("reply to {email}");
		expect(styles.behind.get(edgeKey("m2", "inReplyTo", "m1"))).toBe("Email m2");
	});
});
