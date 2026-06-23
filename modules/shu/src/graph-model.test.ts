import { describe, it, expect } from "vitest";
import { buildGraphModelFromQuads, HYPERMEDIA_ROLE_KEY } from "./graph-model.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

const q = (subject: string, predicate: string, object: unknown, namedGraph: string, objectType?: string): TQuad =>
	({ subject, predicate, object, namedGraph, objectType, timestamp: 1 }) as TQuad;

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

describe("HypermediaRole fold (roleRels)", () => {
	const principals = [q("did:issuer", "name", "Authority", "Principal"), q("did:holder", "name", "Importer", "Principal")];
	it("folds the highest-priority role edge's target onto the node", () => {
		const model = buildGraphModelFromQuads(
			[q("vc1", "name", "Permit", "VerifiableCredential"), q("vc1", "subject", "did:holder", "VerifiableCredential", "Principal"), q("vc1", "issuer", "did:issuer", "VerifiableCredential", "Principal"), ...principals],
			{ roleRels: ["issuer", "subject"] },
		);
		expect(model.nodes.find((n) => n.id === "vc1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("did:issuer"); // issuer outranks subject
	});

	it("makes a party (a role-edge target) its own role, so it gets its own container", () => {
		const model = buildGraphModelFromQuads([q("vc1", "name", "Permit", "VerifiableCredential"), q("vc1", "issuer", "did:issuer", "VerifiableCredential", "Principal"), ...principals], { roleRels: ["issuer"] });
		expect(model.nodes.find((n) => n.id === "did:issuer")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("did:issuer"); // the issuer party groups with itself
		expect(model.nodes.find((n) => n.id === "vc1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("did:issuer"); // its credential joins it
		expect(model.nodes.find((n) => n.id === "did:holder")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBeUndefined(); // not a target here → unattributed
	});

	it("leaves a node with no matching role edge unattributed (no role key)", () => {
		const model = buildGraphModelFromQuads([q("e1", "name", "Hi", "Email")], { roleRels: ["issuer"] });
		expect(model.nodes.find((n) => n.id === "e1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBeUndefined();
	});

	it("does not fold when roleRels is absent (backward-compatible)", () => {
		const model = buildGraphModelFromQuads([q("vc1", "name", "Permit", "VerifiableCredential"), q("vc1", "issuer", "did:issuer", "VerifiableCredential", "Principal"), ...principals]);
		expect(model.nodes.find((n) => n.id === "vc1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBeUndefined();
	});
});
