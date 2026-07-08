import { describe, it, expect } from "vitest";
import { buildGraphModelFromQuads, HYPERMEDIA_ROLE_KEY, SITE_KEY } from "./graph-model.js";
import { ROLE_RELS } from "./graph/grouping.js";
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
	// The Issuer cluster carries a real name; the Principal cluster (same @id, name-less topology) carries only the id fallback.
	const issuerCluster = cluster("Issuer", { [did]: "Coastal Fisheries Authority" });
	const principalCluster = cluster("Principal", { [did]: did });
	const quads = [q(did, "name", "Coastal Fisheries Authority", "Issuer"), q(did, "controller", did, "Principal")];

	it("a real name wins over a same-@id id-fallback when the named cluster is iterated FIRST", () => {
		const model = buildGraphModelFromQuads(quads, { clusters: [issuerCluster, principalCluster] });
		expect(model.nodes.find((n) => n.id === did)?.displayLabel).toBe("Coastal Fisheries Authority");
	});

	it("a real name wins when the named cluster is iterated LAST (order-independent)", () => {
		const model = buildGraphModelFromQuads(quads, { clusters: [principalCluster, issuerCluster] });
		expect(model.nodes.find((n) => n.id === did)?.displayLabel).toBe("Coastal Fisheries Authority");
	});

	it("a single named cluster (the verifier case) still titles by its name", () => {
		const vid = "verifier:1";
		const model = buildGraphModelFromQuads([q(vid, "name", "Credential Verifier", "Verifier")], { clusters: [cluster("Verifier", { [vid]: "Credential Verifier" })] });
		expect(model.nodes.find((n) => n.id === vid)?.displayLabel).toBe("Credential Verifier");
	});

	it("a node with no name anywhere falls back to its id (honest fallback unchanged)", () => {
		const lone = "did:lone";
		const model = buildGraphModelFromQuads([q(lone, "controller", lone, "Principal")], { clusters: [cluster("Principal", { [lone]: lone })] });
		expect(model.nodes.find((n) => n.id === lone)?.displayLabel).toBe(lone);
	});
});

describe("HypermediaRole fold (roleRels)", () => {
	const principals = [q("did:issuer", "name", "Authority", "Principal"), q("did:holder", "name", "Importer", "Principal")];
	it("folds the highest-priority role edge's target onto the node", () => {
		const model = buildGraphModelFromQuads(
			[
				q("vc1", "name", "Permit", "VerifiableCredential"),
				q("vc1", "subject", "did:holder", "VerifiableCredential", "Principal"),
				q("vc1", "issuer", "did:issuer", "VerifiableCredential", "Principal"),
				...principals,
			],
			{ roleRels: ["issuer", "subject"] },
		);
		expect(model.nodes.find((n) => n.id === "vc1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("did:issuer"); // issuer outranks subject
	});

	it("makes a party (a role-edge target) its own role, so it gets its own container", () => {
		const model = buildGraphModelFromQuads(
			[q("vc1", "name", "Permit", "VerifiableCredential"), q("vc1", "issuer", "did:issuer", "VerifiableCredential", "Principal"), ...principals],
			{ roleRels: ["issuer"] },
		);
		expect(model.nodes.find((n) => n.id === "did:issuer")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("did:issuer"); // the issuer party groups with itself
		expect(model.nodes.find((n) => n.id === "vc1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("did:issuer"); // its credential joins it
		expect(model.nodes.find((n) => n.id === "did:holder")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBeUndefined(); // not a target here → unattributed
	});

	it("leaves a node with no matching role edge unattributed (no role key)", () => {
		const model = buildGraphModelFromQuads([q("e1", "name", "Hi", "Email")], { roleRels: ["issuer"] });
		expect(model.nodes.find((n) => n.id === "e1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBeUndefined();
	});

	it("records EACH actor edge on properties[predicate], so any predicate is a groupable axis — not just the winner", () => {
		const model = buildGraphModelFromQuads(
			[
				q("vc1", "name", "Permit", "VerifiableCredential"),
				q("vc1", "issuer", "did:issuer", "VerifiableCredential", "Principal"),
				q("vc1", "holder", "did:holder", "VerifiableCredential", "Principal"),
				...principals,
			],
			{ roleRels: ["issuer", "holder"] },
		);
		const vc = model.nodes.find((n) => n.id === "vc1");
		expect(vc?.properties?.issuer).toBe("did:issuer"); // group by "issuer" specifically…
		expect(vc?.properties?.holder).toBe("did:holder"); // …AND by "holder" — both kept, so "an issuer in a wallet" is expressible
	});

	it("does not fold when roleRels is absent (backward-compatible)", () => {
		const model = buildGraphModelFromQuads([
			q("vc1", "name", "Permit", "VerifiableCredential"),
			q("vc1", "issuer", "did:issuer", "VerifiableCredential", "Principal"),
			...principals,
		]);
		expect(model.nodes.find((n) => n.id === "vc1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBeUndefined();
	});
});

describe("ROLE_RELS trust-triangle placement (genuine W3C VC terms)", () => {
	it("a VerifiablePresentation groups with its HOLDER (cred:holder — possession lives on the presentation)", () => {
		const model = buildGraphModelFromQuads(
			[
				q("vp1", "name", "Presentation", "VerifiablePresentation"),
				q("vp1", "holder", "did:holder", "VerifiablePresentation", "Holder"),
				q("vp1", "verifiableCredential", "vc1", "VerifiablePresentation", "VerifiableCredential"),
				q("did:holder", "name", "Wren", "Holder"),
			],
			{ roleRels: ROLE_RELS },
		);
		expect(model.nodes.find((n) => n.id === "vp1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("did:holder");
	});

	it("a bare VerifiableCredential groups with its ISSUER (cred:issuer); credentialSubject is a triangle SIDE, not the container", () => {
		const model = buildGraphModelFromQuads(
			[
				q("vc1", "name", "Permit", "VerifiableCredential"),
				q("vc1", "issuer", "did:issuer", "VerifiableCredential", "Issuer"),
				q("vc1", "credentialSubject", "did:holder", "VerifiableCredential", "Holder"),
				q("did:issuer", "name", "Authority", "Issuer"),
				q("did:holder", "name", "Wren", "Holder"),
			],
			{ roleRels: ROLE_RELS },
		);
		expect(model.nodes.find((n) => n.id === "vc1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("did:issuer"); // issuer outranks credentialSubject
	});

	it("an ordinary record (no VC edges) still groups by its author", () => {
		const model = buildGraphModelFromQuads([q("e1", "name", "Hi", "Email"), q("e1", "author", "p1", "Email", "Person"), q("p1", "name", "Alice", "Person")], {
			roleRels: ROLE_RELS,
		});
		expect(model.nodes.find((n) => n.id === "e1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("p1");
	});

	it("a published VerificationMethod groups under its REGISTRY (registeredIn outranks its controller→Issuer)", () => {
		const model = buildGraphModelFromQuads(
			[
				q("vm1", "type", "Multikey", "VerificationMethod"),
				q("vm1", "registeredIn", "registry:vdr", "VerificationMethod", "VerifiableDataRegistry"),
				q("vm1", "controller", "did:issuer", "VerificationMethod", "Issuer"),
				q("registry:vdr", "name", "Verifiable Data Registry", "VerifiableDataRegistry"),
				q("did:issuer", "name", "Authority", "Issuer"),
			],
			{ roleRels: ROLE_RELS },
		);
		expect(model.nodes.find((n) => n.id === "vm1")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("registry:vdr"); // registry outranks controller
		expect(model.nodes.find((n) => n.id === "registry:vdr")?.properties?.[HYPERMEDIA_ROLE_KEY]).toBe("registry:vdr"); // the registry is its own container
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
