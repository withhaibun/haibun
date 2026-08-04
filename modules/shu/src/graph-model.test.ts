import { describe, it, expect } from "vitest";
import { buildGraphModelFromQuads, HYPERMEDIA_ROLE_KEY, SITE_KEY } from "./graph-model.js";
// An injected, ordered role list — consumers derive theirs from rels-cache roleEdgeLabels() (declared rolePriority);
// the fold itself is generic, so the fixture names no consumer vocabulary.
const TEST_ROLE_ORDER: readonly string[] = ["archive", "keeper", "maker", "subjectOf", "performedBy", "author", "wasAttributedTo", "attributedTo"];
import type { TQuad, TCluster } from "@haibun/core/lib/quad-types.js";

const q = (subject: string, predicate: string, object: unknown, namedGraph: string, objectType?: string): TQuad =>
	({ subject, predicate, object, namedGraph, objectType, timestamp: 1 }) as TQuad;

const cluster = (type: string, displayLabels: Record<string, string>): TCluster => ({
	type,
	totalCount: Object.keys(displayLabels).length,
	sampledCount: Object.keys(displayLabels).length,
	omittedCount: 0,
	sampledSubjects: Object.keys(displayLabels),
	displayLabels,
});

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

describe("displayLabel merge (shared-@id collapse)", () => {
	const did = "did:web:coastal-fisheries.example.authority";
	// The Agency cluster carries a real name; the Principal cluster (same @id, name-less topology) carries only the id fallback.
	const agencyCluster = cluster("Agency", { [did]: "Coastal Fisheries Authority" });
	const principalCluster = cluster("Principal", { [did]: did });
	const quads = [q(did, "name", "Coastal Fisheries Authority", "Agency"), q(did, "controller", did, "Principal")];

	it("a real name wins over a same-@id id-fallback when the named cluster is iterated FIRST", () => {
		const model = buildGraphModelFromQuads(quads, { clusters: [agencyCluster, principalCluster] });
		expect(model.nodes.find((n) => n.id === did)?.displayLabel).toBe("Coastal Fisheries Authority");
	});

	it("a real name wins when the named cluster is iterated LAST (order-independent)", () => {
		const model = buildGraphModelFromQuads(quads, { clusters: [principalCluster, agencyCluster] });
		expect(model.nodes.find((n) => n.id === did)?.displayLabel).toBe("Coastal Fisheries Authority");
	});

	it("a single named cluster (the single-cluster case) still titles by its name", () => {
		const vid = "verifier:1";
		const model = buildGraphModelFromQuads([q(vid, "name", "Site Inspector", "Inspector")], { clusters: [cluster("Inspector", { [vid]: "Site Inspector" })] });
		expect(model.nodes.find((n) => n.id === vid)?.displayLabel).toBe("Site Inspector");
	});

	it("a node with no name anywhere falls back to its id (honest fallback unchanged)", () => {
		const lone = "did:lone";
		const model = buildGraphModelFromQuads([q(lone, "controller", lone, "Principal")], { clusters: [cluster("Principal", { [lone]: lone })] });
		expect(model.nodes.find((n) => n.id === lone)?.displayLabel).toBe(lone);
	});
});

describe("HypermediaRole fold (roleRels)", () => {
	const principals = [q("did:maker", "name", "Authority", "Principal"), q("did:keeper", "name", "Importer", "Principal")];
	it("folds the highest-priority role edge's target onto the node", () => {
		const model = buildGraphModelFromQuads(
			[q("vc1", "name", "Permit", "Record"), q("vc1", "subject", "did:keeper", "Record", "Principal"), q("vc1", "maker", "did:maker", "Record", "Principal"), ...principals],
			{ roleRels: ["maker", "subject"] },
		);
		expect(model.nodes.find((n) => n.id === "vc1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("did:maker"); // maker outranks subject
	});

	it("makes a party (a role-edge target) its own role, so it gets its own container", () => {
		const model = buildGraphModelFromQuads([q("vc1", "name", "Permit", "Record"), q("vc1", "maker", "did:maker", "Record", "Principal"), ...principals], { roleRels: ["maker"] });
		expect(model.nodes.find((n) => n.id === "did:maker")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("did:maker"); // the maker party groups with itself
		expect(model.nodes.find((n) => n.id === "vc1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("did:maker"); // its record joins it
		expect(model.nodes.find((n) => n.id === "did:keeper")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBeUndefined(); // not a target here → unattributed
	});

	it("leaves a node with no matching role edge unattributed (no role key)", () => {
		const model = buildGraphModelFromQuads([q("e1", "name", "Hi", "Email")], { roleRels: ["maker"] });
		expect(model.nodes.find((n) => n.id === "e1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBeUndefined();
	});

	it("records EACH actor edge on properties[predicate], so any predicate is a groupable axis — not just the winner", () => {
		const model = buildGraphModelFromQuads(
			[q("vc1", "name", "Permit", "Record"), q("vc1", "maker", "did:maker", "Record", "Principal"), q("vc1", "keeper", "did:keeper", "Record", "Principal"), ...principals],
			{ roleRels: ["maker", "keeper"] },
		);
		const vc = model.nodes.find((n) => n.id === "vc1");
		expect(vc?.properties?.maker).toBe("did:maker"); // group by "maker" specifically…
		expect(vc?.properties?.keeper).toBe("did:keeper"); // …AND by "keeper" — both kept, so both actor roles stay expressible
	});

	it("does not fold when roleRels is absent (backward-compatible)", () => {
		const model = buildGraphModelFromQuads([q("vc1", "name", "Permit", "Record"), q("vc1", "maker", "did:maker", "Record", "Principal"), ...principals]);
		expect(model.nodes.find((n) => n.id === "vc1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBeUndefined();
	});
});

describe("role placement honours the injected priority order", () => {
	it("a record carrying a high-priority actor edge groups with that actor", () => {
		const model = buildGraphModelFromQuads(
			[
				q("r1", "name", "Field notes", "Record"),
				q("r1", "keeper", "p:keeper", "Record", "Person"),
				q("r1", "attributedTo", "p:other", "Record", "Person"),
				q("p:keeper", "name", "Wren", "Person"),
			],
			{ roleRels: TEST_ROLE_ORDER },
		);
		expect(model.nodes.find((n) => n.id === "r1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("p:keeper");
	});

	it("the SOURCE actor outranks the record's subject — the subject is a relation, not the container", () => {
		const model = buildGraphModelFromQuads(
			[
				q("r1", "name", "Permit", "Record"),
				q("r1", "maker", "p:maker", "Record", "Person"),
				q("r1", "subjectOf", "p:subject", "Record", "Person"),
				q("p:maker", "name", "Authority", "Person"),
				q("p:subject", "name", "Wren", "Person"),
			],
			{ roleRels: TEST_ROLE_ORDER },
		);
		expect(model.nodes.find((n) => n.id === "r1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("p:maker"); // maker outranks subjectOf
	});

	it("an ordinary record (no consumer edges) still groups by its author", () => {
		const model = buildGraphModelFromQuads([q("e1", "name", "Hi", "Email"), q("e1", "author", "p1", "Email", "Person"), q("p1", "name", "Alice", "Person")], {
			roleRels: TEST_ROLE_ORDER,
		});
		expect(model.nodes.find((n) => n.id === "e1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("p1");
	});

	it("a published artifact groups under its top-priority publication target, not its controller", () => {
		const model = buildGraphModelFromQuads(
			[
				q("a1", "type", "Key", "Artifact"),
				q("a1", "archive", "site:archive", "Artifact", "Archive"),
				q("a1", "controller", "p:owner", "Artifact", "Person"),
				q("site:archive", "name", "Public Archive", "Archive"),
				q("p:owner", "name", "Authority", "Person"),
			],
			{ roleRels: TEST_ROLE_ORDER },
		);
		expect(model.nodes.find((n) => n.id === "a1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("site:archive"); // the publication target outranks the controller
		expect(model.nodes.find((n) => n.id === "site:archive")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("site:archive"); // the archive is its own container
	});
});

describe("serving-site fold (SITE_KEY)", () => {
	it("folds the response site onto every node, a federated per-subject stamp winning over it", () => {
		const clusters: TCluster[] = [
			{ type: "Email", totalCount: 2, sampledCount: 2, omittedCount: 0, sampledSubjects: ["e1", "r1"], displayLabels: { e1: "E1", r1: "R1" }, sites: { r1: "did:site:imap.1" } },
		];
		const model = buildGraphModelFromQuads([q("e1", "name", "E1", "Email"), q("r1", "name", "R1", "Email")], { clusters, site: "did:site:main" });
		expect(model.nodes.find((n) => n.id === "e1")?.properties?.[SITE_KEY]).toBe("did:site:main");
		expect(model.nodes.find((n) => n.id === "r1")?.properties?.[SITE_KEY]).toBe("did:site:imap.1");
	});

	it("folds nothing when the response carries no site (offline snapshots, plain quad tests)", () => {
		const model = buildGraphModelFromQuads([q("e1", "name", "E1", "Email")]);
		expect(model.nodes.find((n) => n.id === "e1")?.properties?.[SITE_KEY]).toBeUndefined();
	});
});
