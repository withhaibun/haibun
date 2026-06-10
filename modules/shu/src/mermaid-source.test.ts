import { describe, it, expect } from "vitest";
import { buildMermaidSource, sanitizeId, esc, THREAD_CLASSIFIER, DEFAULT_MAX_PER_SUBGRAPH, type PropertyClassifier, type TPropKind } from "./mermaid-source.js";
import { COMMENT_LABEL, LinkRelations } from "@haibun/core/lib/resources.js";
import { formatDate } from "./util.js";

const NARRATE_EDGE = LinkRelations.NARRATE.rel;

describe("esc keeps labels render-safe", () => {
	// Regression: a garbled extraction (e.g. a PDF that decodes to control bytes) put raw C0/DEL chars in a Body label,
	// which mermaid renders into an SVG with no drawable geometry. esc must strip them.
	it("strips C0 control + DEL characters (collapsing to a single space)", () => {
		const out = esc("a\u0001\u001b\u007Fb");
		expect(out).toBe("a b"); // each control char becomes a space and collapses; none survive
	});
	it("leaves ordinary text intact", () => {
		expect(esc("Xerox PrimeLink C9065")).toBe("Xerox PrimeLink C9065");
	});
});

describe("sanitizeId keeps node ids mermaid-safe", () => {
	// Regression: a "--" in a subject (e.g. a filename like "report--draft-v2.pdf") must not survive into a node id,
	// or mermaid parses it as an edge operator and the whole diagram fails to render.
	it("strips hyphens so '--' cannot be read as an edge operator", () => {
		const id = sanitizeId("report--draft-v2.pdf");
		expect(id).not.toContain("-");
		expect(id).toBe("report__draft_v2_pdf");
	});
});

const PERSON_LABEL = "Person";

type TestItem = Record<string, unknown> & { _id: string; _edges: { type: string; targetId: string }[] };

/** Simulate normalizeItem from shu-product-view */
function normalizeItem(item: Record<string, unknown>): TestItem {
	const _id = String(item["@id"] ?? item._id ?? item.persistedAs ?? item.id ?? item.name ?? "");
	const existingEdges = (item._edges ?? []) as { type: string; targetId: string }[];
	return { ...item, _id, _edges: existingEdges };
}

/** Simulate threadToQuads from shu-thread-column */
function threadToQuads(items: TestItem[], label: string) {
	const quads: { subject: string; predicate: string; object: string; namedGraph: string; objectType?: string; timestamp: number }[] = [];
	const labelById = new Map(items.map((v) => [v._id, String(v.persistedAs ?? v._label ?? label)]));
	for (const v of items) {
		const vlabel = String(v.persistedAs ?? v._label ?? label);
		const name = String(v.subject ?? v.name ?? v.text ?? v._id);
		quads.push({ subject: v._id, predicate: "name", object: name, namedGraph: vlabel, timestamp: 1 });
		for (const edge of v._edges ?? []) {
			if (labelById.has(edge.targetId)) {
				quads.push({ subject: v._id, predicate: edge.type, object: edge.targetId, namedGraph: vlabel, objectType: labelById.get(edge.targetId), timestamp: 1 });
			}
		}
	}
	return quads;
}

const opts = { layout: "TD" as const, hiddenGraphs: new Set<string>(), expandedGraphs: new Set<string>(), maxPerSubgraph: DEFAULT_MAX_PER_SUBGRAPH, displayLabel: () => undefined };

// Classifier that names `name`, treats `body` as content, the rest scalar — for node-title tests.
const titleClassifier: PropertyClassifier = { classify: (_g, p) => (p === "name" ? "name" : p === "body" ? "content" : "scalar") };

describe("node title is the server display label, else the subject id", () => {
	it("uses the displayLabel (the server-computed label) as the title", () => {
		const quads = [{ subject: "att1", predicate: "attributes", object: '["lux-resident"]', namedGraph: "PeerAttestation", timestamp: 1 }];
		const dl = { ...opts, displayLabel: (g: string, s: string) => (g === "PeerAttestation" && s === "att1" ? "attributes: lux-resident" : undefined) };
		expect(buildMermaidSource(quads, dl, titleClassifier).source).toContain("attributes: lux-resident");
	});
	it("falls back to the subject id when no display label resolves, and still shows content as a line", () => {
		const quads = [{ subject: "c1", predicate: "body", object: "First note about Technology", namedGraph: "Comment", timestamp: 1 }];
		const src = buildMermaidSource(quads, opts, titleClassifier).source; // opts.displayLabel returns undefined
		expect(src).toContain('Comment_c1["c1'); // title is the id, never derived from the body client-side
		expect(src).toContain("First note about Technology"); // content still rendered as a secondary line
	});
	it("shows content as a second line under the label", () => {
		const quads = [
			{ subject: "e1", predicate: "name", object: "RE: Meeting", namedGraph: "Email", timestamp: 1 },
			{ subject: "e1", predicate: "body", object: "see attached", namedGraph: "Email", timestamp: 1 },
		];
		const dl = { ...opts, displayLabel: (_g: string, s: string) => (s === "e1" ? "RE: Meeting" : undefined) };
		const src = buildMermaidSource(quads, dl, titleClassifier).source;
		expect(src).toContain("RE: Meeting");
		expect(src).toContain("see attached");
	});
});

// Classifier driven by rel ROLES (not field names): the node contents derive author/date/identifier from the rel, so the
// same logic serves any type. Maps a few predicates to a kind + rel the way the real domain registry would.
const ROLE_KIND: Record<string, TPropKind> = {
	name: "name",
	email: "identifier",
	did: "identifier",
	author: "edge",
	hasBody: "edge",
	generatedAtTime: "scalar",
	proofPurpose: "scalar",
	attributes: "scalar",
	body: "content",
};
const ROLE_REL: Record<string, string> = {
	name: LinkRelations.NAME.rel,
	email: LinkRelations.IDENTIFIER.rel,
	did: LinkRelations.IDENTIFIER.rel,
	author: LinkRelations.ATTRIBUTED_TO.rel,
	hasBody: LinkRelations.HAS_BODY.rel,
	generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
	proofPurpose: LinkRelations.CONTEXT.rel,
	attributes: LinkRelations.TAG.rel,
	body: LinkRelations.CONTENT.rel,
};
const roleClassifier: PropertyClassifier = { classify: (_g, p) => ROLE_KIND[p] ?? "scalar", rel: (_g, p) => ROLE_REL[p] };

describe("node contents surface a node's significant info by rel role, each value once", () => {
	it("Comment contents: body preview as title, author by ATTRIBUTED_TO, friendly date by temporal rel", () => {
		const quads = [
			{ subject: "c1", predicate: "body", object: "Lawrence vouches for this", namedGraph: COMMENT_LABEL, timestamp: 1 },
			{ subject: "c1", predicate: "author", object: "did:lawrence", namedGraph: COMMENT_LABEL, objectType: PERSON_LABEL, timestamp: 1 },
			{ subject: "c1", predicate: "generatedAtTime", object: "2026-06-05T20:59:00Z", namedGraph: COMMENT_LABEL, timestamp: 1 },
		];
		const dl = { ...opts, displayLabel: (g: string, s: string) => (g === PERSON_LABEL && s === "did:lawrence" ? "Lawrence" : undefined) };
		const src = buildMermaidSource(quads, dl, roleClassifier).source;
		expect(src).toContain("Lawrence vouches for this");
		expect(src).toContain("by Lawrence");
		expect(src).toContain(formatDate("2026-06-05T20:59:00Z"));
	});

	it("Person contents: name as title plus the email identifier", () => {
		const quads = [
			{ subject: "urn:uuid:p-1", predicate: "name", object: "Lawrence", namedGraph: PERSON_LABEL, timestamp: 1 },
			{ subject: "urn:uuid:p-1", predicate: "email", object: "lawrence@lux.example", namedGraph: PERSON_LABEL, timestamp: 1 },
		];
		// The server derives the title from the name; the test supplies that label.
		const dl = { ...opts, displayLabel: (g: string, s: string) => (g === PERSON_LABEL && s === "urn:uuid:p-1" ? "Lawrence" : undefined) };
		const src = buildMermaidSource(quads, dl, roleClassifier).source;
		expect(src).toContain("Lawrence");
		expect(src).toContain("lawrence@lux.example");
	});

	it("omits an opaque uuid identifier (no machine ids in the contents)", () => {
		const quads = [
			{ subject: "n1", predicate: "name", object: "Some Thing", namedGraph: "Widget", timestamp: 1 },
			{ subject: "n1", predicate: "did", object: "urn:uuid:5f1e0000-0000-4000-8000-000000000000", namedGraph: "Widget", timestamp: 1 },
		];
		const dl = { ...opts, displayLabel: (_g: string, s: string) => (s === "n1" ? "Some Thing" : undefined) };
		const src = buildMermaidSource(quads, dl, roleClassifier).source;
		expect(src).toContain("Some Thing");
		expect(src).not.toContain("urn:uuid");
	});

	it("shows a repeated value (proofPurpose echoed by the display label) only once", () => {
		const quads = [{ subject: "p1", predicate: "proofPurpose", object: "assertionMethod", namedGraph: "Proof", timestamp: 1 }];
		const dl = { ...opts, displayLabel: (g: string, s: string) => (g === "Proof" && s === "p1" ? "proofPurpose: assertionMethod" : undefined) };
		const src = buildMermaidSource(quads, dl, roleClassifier).source;
		expect(src.match(/assertionMethod/g)?.length).toBe(1);
	});

	it("does not render a hasBody edge target as a scalar text line", () => {
		const quads = [
			{ subject: "att1", predicate: "attributes", object: "lux-resident", namedGraph: "PeerAttestation", timestamp: 1 },
			{ subject: "att1", predicate: "hasBody", object: "urn:uuid:body-1", namedGraph: "PeerAttestation", objectType: "Body", timestamp: 1 },
		];
		const src = buildMermaidSource(quads, opts, roleClassifier).source;
		expect(src).toContain("attributes: lux-resident");
		expect(src).not.toContain("hasBody:");
	});
});

describe("THREAD_CLASSIFIER", () => {
	it("classifies name as name, edges as edge, internal as internal", () => {
		expect(THREAD_CLASSIFIER.classify("Email", "name")).toBe("name");
		expect(THREAD_CLASSIFIER.classify("Email", "from")).toBe("edge");
		expect(THREAD_CLASSIFIER.classify("Email", "subject")).toBe("edge");
		expect(THREAD_CLASSIFIER.classify("Email", "_id")).toBe("internal");
	});
});

describe("buildMermaidSource with THREAD_CLASSIFIER", () => {
	it("renders edges between nodes", () => {
		const quads = [
			{ subject: "Email", predicate: "name", object: "Email", namedGraph: "Email", timestamp: 1 },
			{ subject: "Email", predicate: "from", object: PERSON_LABEL, namedGraph: "Email", objectType: PERSON_LABEL, timestamp: 1 },
			{ subject: PERSON_LABEL, predicate: "name", object: PERSON_LABEL, namedGraph: PERSON_LABEL, timestamp: 1 },
		];
		const result = buildMermaidSource(quads, opts, THREAD_CLASSIFIER);
		expect(result.source).toContain("-->|from|");
		expect(result.source).toContain("Email");
		expect(result.source).toContain(PERSON_LABEL);
	});

	it("renders property-type edges between vertex and base type", () => {
		const quads = [
			{ subject: "Email", predicate: "name", object: "Email message", namedGraph: "Email", timestamp: 1 },
			{ subject: "Email", predicate: "subject", object: "string", namedGraph: "Email", objectType: "string", timestamp: 1 },
			{ subject: "string", predicate: "name", object: "string", namedGraph: "string", timestamp: 1 },
		];
		const result = buildMermaidSource(quads, opts, THREAD_CLASSIFIER);
		expect(result.source).toContain("-->|subject|");
	});

	it("does not render edges to non-existent targets", () => {
		const quads = [
			{ subject: "Email", predicate: "name", object: "Email", namedGraph: "Email", timestamp: 1 },
			{ subject: "Email", predicate: "from", object: "MissingNode", namedGraph: "Email", timestamp: 1 },
		];
		const result = buildMermaidSource(quads, opts, THREAD_CLASSIFIER);
		expect(result.source).not.toContain("MissingNode");
	});

	it("uses the server display label as the node label", () => {
		const quads = [{ subject: "email-1", predicate: "name", object: "RE: Meeting notes", namedGraph: "Email", timestamp: 1 }];
		const dl = { ...opts, displayLabel: (_g: string, s: string) => (s === "email-1" ? "RE: Meeting notes" : undefined) };
		const result = buildMermaidSource(quads, dl, THREAD_CLASSIFIER);
		expect(result.source).toContain("RE: Meeting notes");
	});
});

describe("end-to-end: show domains → thread → graph", () => {
	it("renders edges between domain types from show domains products", () => {
		// Simulate show domains product items
		const rawItems = [
			{
				name: "test-email",
				description: "Email message",
				members: 0,
				persistedAs: "Email",
				_edges: [
					{ type: "from", targetId: PERSON_LABEL },
					{ type: "subject", targetId: "string" },
				],
			},
			{ name: "test-contact", description: PERSON_LABEL, members: 0, persistedAs: PERSON_LABEL, _edges: [] },
			{ name: "string", description: "Plain string literal", members: 0, _edges: [] },
		];

		// normalizeItem sets _id from persistedAs or name
		const items = rawItems.map(normalizeItem);
		expect(items[0]._id).toBe("Email");
		expect(items[1]._id).toBe(PERSON_LABEL);
		expect(items[2]._id).toBe("string");

		// threadToQuads converts items to quads
		const quads = threadToQuads(items, "Domain");
		const edgeQuads = quads.filter((q) => q.predicate !== "name");
		expect(edgeQuads.length).toBe(2);
		expect(edgeQuads[0]).toMatchObject({ subject: "Email", predicate: "from", object: PERSON_LABEL });
		expect(edgeQuads[1]).toMatchObject({ subject: "Email", predicate: "subject", object: "string" });

		// buildMermaidSource renders edges
		const result = buildMermaidSource(quads, opts, THREAD_CLASSIFIER);
		expect(result.source).toContain("-->|from|");
		expect(result.source).toContain("-->|subject|");
	});

	it("renders edges for comment thread", () => {
		const rawItems = [
			{ name: "person-1", _label: PERSON_LABEL, _id: "person-1", _edges: [] },
			{ name: "a1", _label: COMMENT_LABEL, _id: "a1-uuid", _inReplyTo: "person-1", _edges: [{ type: NARRATE_EDGE, targetId: "person-1" }] },
			{ name: "a11", _label: COMMENT_LABEL, _id: "a11-uuid", _inReplyTo: "a1-uuid", _edges: [{ type: NARRATE_EDGE, targetId: "a1-uuid" }] },
		];

		const items = rawItems.map(normalizeItem);
		const quads = threadToQuads(items, "Thread");
		const result = buildMermaidSource(quads, opts, THREAD_CLASSIFIER);
		expect(result.source).toContain(`==>|${NARRATE_EDGE}|`);
	});

	it("renders edges for contact with related emails (bidirectional)", () => {
		// getRelated for a Contact returns: the contact, connected emails (via incoming from/to edges),
		// and attachments. Incoming edges are stored as "← from" on the contact item.
		const rawItems = [
			{
				name: "person-1@example.org",
				_label: PERSON_LABEL,
				_id: "person-1@example.org",
				_edges: [
					{ type: "← from", targetId: "msg-1" },
					{ type: "← to", targetId: "msg-2" },
				],
			},
			{
				name: "Meeting invite",
				_label: "Email",
				_id: "msg-1",
				subject: "Meeting invite",
				_edges: [
					{ type: "from", targetId: "person-1@example.org" },
					{ type: "attachment", targetId: "invite.ics" },
				],
			},
			{
				name: "Newsletter",
				_label: "Email",
				_id: "msg-2",
				subject: "Newsletter",
				_edges: [{ type: "to", targetId: "person-1@example.org" }],
			},
			{
				name: "invite.ics",
				_label: "File",
				_id: "invite.ics",
				_edges: [],
			},
		];

		const items = rawItems.map(normalizeItem);
		const quads = threadToQuads(items, "Thread");

		// Verify edge quads exist
		const edgeQuads = quads.filter((q) => q.predicate !== "name");
		expect(edgeQuads.length).toBeGreaterThan(0);

		const result = buildMermaidSource(quads, opts, THREAD_CLASSIFIER);
		// Edges must render: Email→Contact (from, to), Email→File (attachment), Contact→Email (← from)
		expect(result.source).toContain("-->|from|");
		expect(result.source).toContain("-->|to|");
		expect(result.source).toContain("-->|attachment|");
		expect(result.source).toContain("-->|← from|");
	});
});

describe("hiddenRels filtering", () => {
	it("hides edges matching hiddenRels", () => {
		const quads = [
			{ subject: "Email", predicate: "name", object: "Email", namedGraph: "Email", timestamp: 1 },
			{ subject: "Email", predicate: "from", object: PERSON_LABEL, namedGraph: "Email", objectType: PERSON_LABEL, timestamp: 1 },
			{ subject: "Email", predicate: "to", object: PERSON_LABEL, namedGraph: "Email", objectType: PERSON_LABEL, timestamp: 1 },
			{ subject: PERSON_LABEL, predicate: "name", object: PERSON_LABEL, namedGraph: PERSON_LABEL, timestamp: 1 },
		];
		// Thread classifier has no relForEdge, so predicate name IS the rel
		const result = buildMermaidSource(quads, { ...opts, hiddenRels: new Set(["from"]) }, THREAD_CLASSIFIER);
		expect(result.source).not.toContain("-->|from|");
		expect(result.source).toContain("-->|to|");
	});
});

describe("objectType resolves edge targets across shared ids (no guessing, fail fast)", () => {
	const sharedId = [
		{ subject: "did:bron", predicate: "name", object: "Bron", namedGraph: "Principal", timestamp: 1 },
		{ subject: "did:bron", predicate: "name", object: "Bron", namedGraph: "Issuer", timestamp: 1 },
		{ subject: "att1", predicate: "name", object: "vouch", namedGraph: "PeerAttestation", timestamp: 1 },
		{ subject: "att1", predicate: "attestedBy", object: "did:bron", namedGraph: "PeerAttestation", objectType: "Principal", timestamp: 1 },
		{ subject: "cap1", predicate: "name", object: "cap", namedGraph: "Capability", timestamp: 1 },
		{ subject: "cap1", predicate: "controller", object: "did:bron", namedGraph: "Capability", objectType: "Issuer", timestamp: 1 },
	];

	it("links each edge to the node of its declared objectType, even when the id is shared", () => {
		const { source } = buildMermaidSource(sharedId, opts, THREAD_CLASSIFIER);
		expect(source).toMatch(/attestedBy\|[^\n]*Principal/);
		expect(source).toMatch(/controller\|[^\n]*Issuer/);
		expect(source).not.toMatch(/attestedBy\|[^\n]*Issuer/);
	});

	it("does not draw an edge whose quad has no objectType (an id-valued property, not a typed relationship)", () => {
		const quads = [
			{ subject: "did:bron", predicate: "name", object: "Bron", namedGraph: "Principal", timestamp: 1 },
			{ subject: "att1", predicate: "name", object: "vouch", namedGraph: "PeerAttestation", timestamp: 1 },
			{ subject: "att1", predicate: "attestedBy", object: "did:bron", namedGraph: "PeerAttestation", timestamp: 1 },
		];
		expect(buildMermaidSource(quads, opts, THREAD_CLASSIFIER).source).not.toContain("attestedBy");
	});
});

describe("buildMermaidSource diagnostics explain why each edge draws or not", () => {
	it("reports a drawn edge with its declared objectType and the graph subject counts", () => {
		const quads = [
			{ subject: "did:bron", predicate: "name", object: "Bron", namedGraph: "Principal", timestamp: 1 },
			{ subject: "did:bron", predicate: "name", object: "Bron", namedGraph: "Issuer", timestamp: 1 },
			{ subject: "att1", predicate: "name", object: "vouch", namedGraph: "PeerAttestation", timestamp: 1 },
			{ subject: "att1", predicate: "attestedBy", object: "did:bron", namedGraph: "PeerAttestation", objectType: "Principal", timestamp: 1 },
			{ subject: "cap1", predicate: "name", object: "cap", namedGraph: "Capability", timestamp: 1 },
			{ subject: "cap1", predicate: "controller", object: "did:bron", namedGraph: "Capability", objectType: "Issuer", timestamp: 1 },
		];
		const { diagnostics } = buildMermaidSource(quads, opts, THREAD_CLASSIFIER);
		expect(diagnostics.edgesDrawn).toBe(2);
		expect(diagnostics.totalQuads).toBe(6);
		expect(diagnostics.edges.find((e) => e.predicate === "attestedBy")).toMatchObject({ drawn: true, objectType: "Principal" });
		expect(diagnostics.graphs).toEqual(expect.arrayContaining([{ name: "Principal", subjects: 1 }]));
	});

	it("reports reason 'no-objectType' for a declared edge quad missing its target type", () => {
		const quads = [
			{ subject: "did:bron", predicate: "name", object: "Bron", namedGraph: "Principal", timestamp: 1 },
			{ subject: "att1", predicate: "attestedBy", object: "did:bron", namedGraph: "PeerAttestation", timestamp: 1 },
		];
		const { diagnostics } = buildMermaidSource(quads, opts, THREAD_CLASSIFIER);
		expect(diagnostics.edgesDrawn).toBe(0);
		expect(diagnostics.edges.find((e) => e.predicate === "attestedBy")?.reason).toBe("no-objectType");
	});

	it("reports reason 'target-type-mismatch' when the object exists only under a different type", () => {
		const quads = [
			{ subject: "did:bron", predicate: "name", object: "Bron", namedGraph: "Principal", timestamp: 1 },
			{ subject: "att1", predicate: "name", object: "vouch", namedGraph: "PeerAttestation", timestamp: 1 },
			{ subject: "att2", predicate: "attestedBy", object: "att1", namedGraph: "PeerAttestation", objectType: "Principal", timestamp: 1 },
		];
		const { diagnostics } = buildMermaidSource(quads, opts, THREAD_CLASSIFIER);
		expect(diagnostics.edges.find((e) => e.predicate === "attestedBy")?.reason).toBe("target-type-mismatch");
	});
});
