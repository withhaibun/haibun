import { describe, it, expect } from "vitest";
import { buildMermaidSource, THREAD_CLASSIFIER, DEFAULT_MAX_PER_SUBGRAPH } from "./mermaid-source.js";
import { COMMENT_LABEL, LinkRelations } from "@haibun/core/lib/resources.js";

const NARRATE_EDGE = LinkRelations.NARRATE.rel;

const PERSON_LABEL = "Person";

type TestItem = Record<string, unknown> & { _id: string; _edges: { type: string; targetId: string }[] };

/** Simulate normalizeItem from shu-product-view */
function normalizeItem(item: Record<string, unknown>): TestItem {
	const _id = String(item["@id"] ?? item._id ?? item.vertexLabel ?? item.id ?? item.name ?? "");
	const existingEdges = (item._edges ?? []) as { type: string; targetId: string }[];
	return { ...item, _id, _edges: existingEdges };
}

/** Simulate threadToQuads from shu-thread-column */
function threadToQuads(items: TestItem[], label: string) {
	const quads: { subject: string; predicate: string; object: string; namedGraph: string; timestamp: number }[] = [];
	const itemIds = new Set(items.map((v) => v._id));
	for (const v of items) {
		const vlabel = String(v.vertexLabel ?? v._label ?? label);
		const name = String(v.subject ?? v.name ?? v.text ?? v._id);
		quads.push({ subject: v._id, predicate: "name", object: name, namedGraph: vlabel, timestamp: 1 });
		for (const edge of v._edges ?? []) {
			if (itemIds.has(edge.targetId)) {
				quads.push({ subject: v._id, predicate: edge.type, object: edge.targetId, namedGraph: vlabel, timestamp: 1 });
			}
		}
	}
	return quads;
}

const opts = { layout: "TD" as const, hiddenGraphs: new Set<string>(), expandedGraphs: new Set<string>(), maxPerSubgraph: DEFAULT_MAX_PER_SUBGRAPH };

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
			{ subject: "Email", predicate: "from", object: PERSON_LABEL, namedGraph: "Email", timestamp: 1 },
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
			{ subject: "Email", predicate: "subject", object: "string", namedGraph: "Email", timestamp: 1 },
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

	it("uses name predicate as node label", () => {
		const quads = [
			{ subject: "email-1", predicate: "name", object: "RE: Meeting notes", namedGraph: "Email", timestamp: 1 },
		];
		const result = buildMermaidSource(quads, opts, THREAD_CLASSIFIER);
		expect(result.source).toContain("RE: Meeting notes");
	});
});

describe("end-to-end: show domains → thread → graph", () => {
	it("renders edges between domain types from show domains products", () => {
		// Simulate show domains product items
		const rawItems = [
			{ name: "muskeg-email", description: "Email message", members: 0, vertexLabel: "Email", _edges: [{ type: "from", targetId: PERSON_LABEL }, { type: "subject", targetId: "string" }] },
			{ name: "muskeg-contact", description: PERSON_LABEL, members: 0, vertexLabel: PERSON_LABEL, _edges: [] },
			{ name: "string", description: "Plain string literal", members: 0, _edges: [] },
		];

		// normalizeItem sets _id from vertexLabel or name
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
				name: "person-1@example.org", _label: PERSON_LABEL, _id: "person-1@example.org",
				_edges: [{ type: "← from", targetId: "msg-1" }, { type: "← to", targetId: "msg-2" }],
			},
			{
				name: "Meeting invite", _label: "Email", _id: "msg-1", subject: "Meeting invite",
				_edges: [{ type: "from", targetId: "person-1@example.org" }, { type: "attachment", targetId: "invite.ics" }],
			},
			{
				name: "Newsletter", _label: "Email", _id: "msg-2", subject: "Newsletter",
				_edges: [{ type: "to", targetId: "person-1@example.org" }],
			},
			{
				name: "invite.ics", _label: "File", _id: "invite.ics",
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
			{ subject: "Email", predicate: "from", object: PERSON_LABEL, namedGraph: "Email", timestamp: 1 },
			{ subject: "Email", predicate: "to", object: PERSON_LABEL, namedGraph: "Email", timestamp: 1 },
			{ subject: PERSON_LABEL, predicate: "name", object: PERSON_LABEL, namedGraph: PERSON_LABEL, timestamp: 1 },
		];
		// Thread classifier has no relForEdge, so predicate name IS the rel
		const result = buildMermaidSource(quads, { ...opts, hiddenRels: new Set(["from"]) }, THREAD_CLASSIFIER);
		expect(result.source).not.toContain("-->|from|");
		expect(result.source).toContain("-->|to|");
	});
});
