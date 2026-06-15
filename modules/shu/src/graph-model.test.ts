import { describe, it, expect } from "vitest";
import { buildGraphModelFromQuads } from "./graph-model.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

const q = (subject: string, predicate: string, object: unknown, namedGraph: string, objectType?: string): TQuad => ({ subject, predicate, object, namedGraph, objectType, timestamp: 1 }) as TQuad;

describe("buildGraphModelFromQuads", () => {
	it("emits one node per subject (typed by namedGraph) and a typed-reference edge", () => {
		const model = buildGraphModelFromQuads([q("p1", "name", "Alice", "Person"), q("e1", "name", "Hi", "Email"), q("e1", "attributedTo", "p1", "Email", "Person")]);
		expect(model.nodes.map((n) => n.id).sort()).toEqual(["e1", "p1"]);
		expect(model.nodes.find((n) => n.id === "p1")?.type).toBe("Person");
		expect(model.edges).toContainEqual(expect.objectContaining({ from: "e1", to: "p1", predicate: "attributedTo", graph: "Email" }));
	});

	it("threads a node's LITERAL properties (image, dates, scalars) onto the node; edges and internal keys are excluded", () => {
		const model = buildGraphModelFromQuads([
			q("e1", "name", "Meeting", "Email"),
			q("e1", "image", "https://x/p.png", "Email"),
			q("e1", "startDate", "2026-01-02", "Email"),
			q("e1", "attributedTo", "p1", "Email", "Person"), // a typed edge — NOT a property
			q("e1", "_seqPath", "0.1", "Email"), // internal — excluded
			q("p1", "name", "Alice", "Person"),
		]);
		const e1 = model.nodes.find((n) => n.id === "e1");
		expect(e1?.properties).toEqual({ name: "Meeting", image: "https://x/p.png", startDate: "2026-01-02" });
		expect(e1?.properties?.attributedTo).toBeUndefined();
		expect(e1?.properties?._seqPath).toBeUndefined();
	});

	it("leaves properties undefined for a node carrying only edges", () => {
		const model = buildGraphModelFromQuads([q("e1", "attributedTo", "p1", "Email", "Person"), q("p1", "name", "Alice", "Person")]);
		expect(model.nodes.find((n) => n.id === "e1")?.properties).toBeUndefined();
	});
});
