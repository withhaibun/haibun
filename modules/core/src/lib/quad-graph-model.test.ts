import { describe, it, expect } from "vitest";
import { QuadGraphModel } from "./quad-graph-model.js";
import type { TQuad } from "./quad-types.js";
import { LinkRelations, TEXT_QUOTE_SELECTOR_LABEL, SPECIFIC_RESOURCE_LABEL } from "./resources.js";

const q = (subject: string, predicate: string, object: unknown, namedGraph: string, timestamp = 1): TQuad => ({ subject, predicate, object, namedGraph, timestamp });
/** An EDGE quad — carries objectType (the target's range), the marker that distinguishes a typed reference from a scalar property. */
const qe = (subject: string, predicate: string, object: string, objectType: string, namedGraph: string, timestamp = 1): TQuad => ({
	subject,
	predicate,
	object,
	objectType,
	namedGraph,
	timestamp,
});
const noRels = (): undefined => undefined;

describe("QuadGraphModel", () => {
	it("admits subjects under the per-type budget and clusters them", () => {
		const m = new QuadGraphModel(2, noRels);
		m.merge([q("a", "name", "A", "Email"), q("b", "name", "B", "Email")]);
		const c = m.clusters.find((c) => c.type === "Email");
		expect(c?.sampledCount).toBe(2);
		expect(c?.sampledSubjects).toEqual(["a", "b"]);
		expect(c?.omittedCount).toBe(0);
		expect(m.quads).toHaveLength(2);
	});

	it("omits a new subject once its type is at budget — counts it, drops its quad", () => {
		const m = new QuadGraphModel(1, noRels);
		m.merge([q("a", "name", "A", "Email"), q("b", "name", "B", "Email")]);
		const c = m.clusters.find((c) => c.type === "Email");
		expect(c?.sampledCount).toBe(1);
		expect(c?.totalCount).toBe(2);
		expect(c?.omittedCount).toBe(1);
		expect(m.quads).toHaveLength(1);
	});

	it("keeps a pinned subject's quad as an extra even when its type is at budget", () => {
		const m = new QuadGraphModel(1, noRels);
		m.pin(["b"]);
		m.merge([q("a", "name", "A", "Email"), q("b", "name", "B", "Email")]);
		const c = m.clusters.find((c) => c.type === "Email");
		expect(m.quads).toHaveLength(2); // b kept despite budget 1 (not dropped)
		expect(m.quads.some((x) => x.subject === "b")).toBe(true);
		expect(c?.omittedCount).toBe(0); // pinned, not omitted
		expect(typeof c?.displayLabels["b"]).toBe("string"); // and labelled
	});

	it("keeps the title a seeded snapshot gave a subject, and titles only what the seed left untitled", () => {
		// A reader hiding a type refetches narrowed to the visible ones, so the merge holds no body quads for a record
		// whose text lives in a Body. Titling from what remains gives a comment its seqPath in place of its own words.
		const m = new QuadGraphModel(10, noRels);
		m.seed({
			quads: [q("cmt-1", "seqPath", "0.1.2", "Comment")],
			clusters: [{ type: "Comment", totalCount: 1, sampledCount: 1, omittedCount: 0, sampledSubjects: ["cmt-1"], displayLabels: { "cmt-1": "what the comment says" } }],
			site: "did:site:0",
		});
		m.merge([q("cmt-1", "seqPath", "0.1.2", "Comment"), q("cmt-2", "seqPath", "0.1.3", "Comment")]);
		const c = m.clusters.find((c) => c.type === "Comment");
		expect(c?.displayLabels["cmt-1"]).toBe("what the comment says");
		expect(typeof c?.displayLabels["cmt-2"]).toBe("string"); // a newcomer the seed never saw is titled here
	});

	it("dedups a scalar property by (namedGraph|subject|predicate), replacing in place", () => {
		const m = new QuadGraphModel(10, noRels);
		m.merge([q("a", "name", "A", "Email", 1)]);
		m.merge([q("a", "name", "A2", "Email", 2)]);
		expect(m.quads).toHaveLength(1);
		expect(m.quads[0].object).toBe("A2");
	});

	it("preserves every distinct edge object for one (subject,predicate) — the multi-valued attribution (§7-2)", () => {
		// A shared record attributed to three principals across a federated union — all three edges must survive.
		const m = new QuadGraphModel(10, noRels);
		m.merge([
			qe("rec", "wasAttributedTo", "did:alpha", "Principal", "FieldReport"),
			qe("rec", "wasAttributedTo", "did:beta", "Principal", "FieldReport"),
			qe("rec", "wasAttributedTo", "did:gamma", "Principal", "FieldReport"),
		]);
		const attributions = m.quads.filter((x) => x.subject === "rec" && x.predicate === "wasAttributedTo").map((x) => x.object);
		expect(attributions).toEqual(["did:alpha", "did:beta", "did:gamma"]);
	});

	it("still dedups an edge re-arriving with the SAME object (the property-quad/edge-quad collapse)", () => {
		const m = new QuadGraphModel(10, noRels);
		m.merge([qe("rec", "wasAttributedTo", "did:alpha", "Principal", "FieldReport", 1)]);
		m.merge([qe("rec", "wasAttributedTo", "did:alpha", "Principal", "FieldReport", 2)]);
		expect(m.quads.filter((x) => x.predicate === "wasAttributedTo")).toHaveLength(1);
	});

	it("lets the store override totalCount with the authoritative total", () => {
		const m = new QuadGraphModel(10, noRels);
		m.merge([q("a", "name", "A", "Email")], { totalCounts: new Map([["Email", 500]]) });
		const c = m.clusters.find((c) => c.type === "Email");
		expect(c?.totalCount).toBe(500);
		expect(c?.sampledCount).toBe(1);
		expect(c?.omittedCount).toBe(499);
	});

	it("sets a display label for each touched subject", () => {
		const m = new QuadGraphModel(10, noRels);
		m.merge([q("a", "name", "A", "Email")]);
		const c = m.clusters.find((c) => c.type === "Email");
		expect(typeof c?.displayLabels["a"]).toBe("string");
	});

	// A type whose vocabulary designates a literal-ranged labeling property (topology.displayLabel) must be titled by that
	// property's value in the quad path too — the same rule the server applies — never by the id its store had to generate.
	it("titles a declared-label type by its property value, not its id (literal rel)", () => {
		const rels = (type: string) => (type === TEXT_QUOTE_SELECTOR_LABEL ? { exact: LinkRelations.EXACT.rel } : undefined);
		const declaredRel = (type: string) => (type === TEXT_QUOTE_SELECTOR_LABEL ? LinkRelations.EXACT.rel : undefined);
		const m = new QuadGraphModel(10, rels, declaredRel);
		m.merge([q("sel-uuid", LinkRelations.EXACT.rel, "12.1.1 the exact passage", TEXT_QUOTE_SELECTOR_LABEL)]);
		const c = m.clusters.find((c) => c.type === TEXT_QUOTE_SELECTOR_LABEL);
		expect(c?.displayLabels["sel-uuid"]).toBe("12.1.1 the exact passage");
	});

	// A proxy whose labeling property is iri-ranged (oa:hasSelector) is titled ONE hop through it — by the passage its
	// selector locates — resolving the target's quads even though only the proxy was the direct merge subject.
	it("titles a proxy through its iri-ranged declared rel — one hop to what it points at", () => {
		const rels = (type: string) => (type === TEXT_QUOTE_SELECTOR_LABEL ? { exact: LinkRelations.EXACT.rel } : undefined);
		const declaredRel = (type: string) =>
			type === TEXT_QUOTE_SELECTOR_LABEL ? LinkRelations.EXACT.rel : type === SPECIFIC_RESOURCE_LABEL ? LinkRelations.HAS_SELECTOR.rel : undefined;
		const m = new QuadGraphModel(10, rels, declaredRel);
		m.merge([
			q("sel-uuid", LinkRelations.EXACT.rel, "the located passage", TEXT_QUOTE_SELECTOR_LABEL),
			qe("sr-uuid", LinkRelations.HAS_SELECTOR.rel, "sel-uuid", TEXT_QUOTE_SELECTOR_LABEL, SPECIFIC_RESOURCE_LABEL),
		]);
		const c = m.clusters.find((c) => c.type === SPECIFIC_RESOURCE_LABEL);
		expect(c?.displayLabels["sr-uuid"]).toBe("the located passage");
	});
});
