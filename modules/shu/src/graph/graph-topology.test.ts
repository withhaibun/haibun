import { describe, it, expect } from "vitest";
import { buildGraphTopology, isSummaryId } from "./graph-topology.js";
import { THREAD_CLASSIFIER, type TGraphViewOpts } from "../graph-classifier.js";
import { colorForType } from "../type-colors.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

const opts = (over: Partial<TGraphViewOpts> = {}): TGraphViewOpts => ({
	layout: "TD",
	hiddenGraphs: new Set(),
	expandedGraphs: new Set(),
	maxPerSubgraph: 20,
	displayLabel: (_g, s) => (s === "p1" ? "Alice" : undefined),
	...over,
});

const q = (namedGraph: string, subject: string, predicate: string, object: string, objectType?: string): TQuad => ({ namedGraph, subject, predicate, object, objectType }) as TQuad;

describe("buildGraphTopology", () => {
	const quads = [q("Person", "p1", "name", "Alice"), q("Email", "e1", "attributedTo", "p1", "Person")];

	const idFor = (nodeMap: Map<string, { graph: string; subject: string }>, g: string, s: string): string => {
		const found = [...nodeMap.entries()].find(([, v]) => v.graph === g && v.subject === s);
		if (!found) throw new Error(`no node for ${g}/${s}`);
		return found[0];
	};

	it("projects nodes grouped by namedGraph with display-label titles + a nodeMap for click routing", () => {
		const { graph, nodeMap } = buildGraphTopology(quads, opts(), THREAD_CLASSIFIER);
		const personId = idFor(nodeMap, "Person", "p1");
		expect(graph.nodes.find((n) => n.id === personId)?.label).toBe("Alice");
		expect(graph.nodes.find((n) => n.id === idFor(nodeMap, "Email", "e1"))?.group).toBe("Email");
		expect(graph.groups?.Person?.label).toBe("Person (1)");
		expect(graph.styles?.Person?.fill).toBe(colorForType("Person"));
	});

	it("resolves an edge by its declared objectType (Email → Person)", () => {
		const { graph, nodeMap } = buildGraphTopology(quads, opts(), THREAD_CLASSIFIER);
		expect(graph.edges).toContainEqual(expect.objectContaining({ from: idFor(nodeMap, "Email", "e1"), to: idFor(nodeMap, "Person", "p1") }));
	});

	it("drops a hidden namedGraph entirely", () => {
		const { graph } = buildGraphTopology(quads, opts({ hiddenGraphs: new Set(["Email"]) }), THREAD_CLASSIFIER);
		expect(graph.nodes.some((n) => n.group === "Email")).toBe(false);
	});

	it("collapses a graph over the per-group cap into one summary node", () => {
		const many = Array.from({ length: 25 }, (_, i) => q("Note", `n${i}`, "name", `Note ${i}`));
		const { graph, nodeMap } = buildGraphTopology(many, opts({ maxPerSubgraph: 20 }), THREAD_CLASSIFIER);
		const noteNodes = graph.nodes.filter((n) => n.group === "Note");
		expect(noteNodes).toHaveLength(1);
		expect(isSummaryId(noteNodes[0].id)).toBe(true);
		expect(nodeMap.has(noteNodes[0].id)).toBe(false); // a summary node is not a clickable entity
	});
});
