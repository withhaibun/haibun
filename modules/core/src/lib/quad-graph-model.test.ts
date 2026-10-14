import { describe, it, expect } from "vitest";
import { QuadGraphModel } from "./quad-graph-model.js";
import type { TQuad } from "./steps/domains/quad-types.js";
import { LinkRelations, TEXT_QUOTE_SELECTOR_LABEL, SPECIFIC_RESOURCE_LABEL } from "./resources.js";
import { itemAt } from "./util/item-at.js";

const q = (subject: string, predicate: string, object: unknown, namedGraph: string, timestamp = 1): TQuad => ({ subject, predicate, object, namedGraph, timestamp });
/** Builds an edge quad. Its objectType holds the target's range and distinguishes a typed reference from a scalar property. */
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
	it("admits subjects under the per-type limit and clusters them", () => {
		const m = new QuadGraphModel(2, noRels);
		m.merge([q("a", "name", "A", "Letter"), q("b", "name", "B", "Letter")]);
		const c = m.clusters.find((c) => c.type === "Letter");
		expect(c?.sampledCount).toBe(2);
		expect(c?.sampledSubjects).toEqual(["a", "b"]);
		expect(c?.omittedCount).toBe(0);
		expect(m.quads).toHaveLength(2);
	});

	it("omits a new subject once its type is at its limit, counts it and drops its quad", () => {
		const m = new QuadGraphModel(1, noRels);
		m.merge([q("a", "name", "A", "Letter"), q("b", "name", "B", "Letter")]);
		const c = m.clusters.find((c) => c.type === "Letter");
		expect(c?.sampledCount).toBe(1);
		expect(c?.totalCount).toBe(2);
		expect(c?.omittedCount).toBe(1);
		expect(m.quads).toHaveLength(1);
	});

	it("keeps a pinned subject's quad as an extra even when its type is at its limit", () => {
		const m = new QuadGraphModel(1, noRels);
		m.pin(["b"]);
		m.merge([q("a", "name", "A", "Letter"), q("b", "name", "B", "Letter")]);
		const c = m.clusters.find((c) => c.type === "Letter");
		expect(m.quads).toHaveLength(2); // b kept despite limit 1 (not dropped)
		expect(m.quads.some((x) => x.subject === "b")).toBe(true);
		expect(c?.omittedCount).toBe(0); // pinned, not omitted
		expect(typeof c?.displayLabels["b"]).toBe("string"); // and labelled
	});

	it("keeps the title a seeded snapshot gave a subject, and titles only what the seed left untitled", () => {
		// The view refetches only the visible types when a reader hides a type. That merge doesn't carry the Body quads that
		// store a record's text. A title computed from the remaining quads would replace a comment's text with its seqPath.
		const m = new QuadGraphModel(10, noRels);
		m.seed({
			quads: [q("cmt-1", "seqPath", "0.1.2", "Comment")],
			clusters: [{ type: "Comment", totalCount: 1, sampledCount: 1, omittedCount: 0, sampledSubjects: ["cmt-1"], displayLabels: { "cmt-1": "what the comment states" } }],
			site: "did:site:0",
		});
		m.merge([q("cmt-1", "seqPath", "0.1.2", "Comment"), q("cmt-2", "seqPath", "0.1.3", "Comment")]);
		const c = m.clusters.find((c) => c.type === "Comment");
		expect(c?.displayLabels["cmt-1"]).toBe("what the comment states");
		expect(typeof c?.displayLabels["cmt-2"]).toBe("string"); // the merge titles a subject the seed doesn't contain
	});

	it("dedups a scalar property by (namedGraph|subject|predicate) and replaces it in place", () => {
		const m = new QuadGraphModel(10, noRels);
		m.merge([q("a", "name", "A", "Letter", 1)]);
		m.merge([q("a", "name", "A2", "Letter", 2)]);
		expect(m.quads).toHaveLength(1);
		expect(itemAt(m.quads, 0).object).toBe("A2");
	});

	it("keeps every distinct edge object for one (subject,predicate) for multi-valued attribution (§7-2)", () => {
		// A federated union attributes a shared record to three principals. The merge keeps all three edges.
		const m = new QuadGraphModel(10, noRels);
		m.merge([
			qe("rec", "wasAttributedTo", "did:alpha", "Principal", "FieldReport"),
			qe("rec", "wasAttributedTo", "did:beta", "Principal", "FieldReport"),
			qe("rec", "wasAttributedTo", "did:gamma", "Principal", "FieldReport"),
		]);
		const attributions = m.quads.filter((x) => x.subject === "rec" && x.predicate === "wasAttributedTo").map((x) => x.object);
		expect(attributions).toEqual(["did:alpha", "did:beta", "did:gamma"]);
	});

	it("dedups an edge that arrives again with the same object, as it dedups a property quad", () => {
		const m = new QuadGraphModel(10, noRels);
		m.merge([qe("rec", "wasAttributedTo", "did:alpha", "Principal", "FieldReport", 1)]);
		m.merge([qe("rec", "wasAttributedTo", "did:alpha", "Principal", "FieldReport", 2)]);
		expect(m.quads.filter((x) => x.predicate === "wasAttributedTo")).toHaveLength(1);
	});

	it("replaces totalCount with the store's total", () => {
		const m = new QuadGraphModel(10, noRels);
		m.merge([q("a", "name", "A", "Letter")], { totalCounts: new Map([["Letter", 500]]) });
		const c = m.clusters.find((c) => c.type === "Letter");
		expect(c?.totalCount).toBe(500);
		expect(c?.sampledCount).toBe(1);
		expect(c?.omittedCount).toBe(499);
	});

	it("sets a display label for each touched subject", () => {
		const m = new QuadGraphModel(10, noRels);
		m.merge([q("a", "name", "A", "Letter")]);
		const c = m.clusters.find((c) => c.type === "Letter");
		expect(typeof c?.displayLabels["a"]).toBe("string");
	});

	// QuadGraphModel titles a type whose topology.displayLabel names a literal-ranged property by that property's value.
	// The server applies the same rule. The title isn't the id the store generated.
	it("titles a declared-label type by its property value, not its id (literal rel)", () => {
		const rels = (type: string) => (type === TEXT_QUOTE_SELECTOR_LABEL ? { exact: LinkRelations.EXACT.rel } : undefined);
		const titledBy = (type: string) => (type === TEXT_QUOTE_SELECTOR_LABEL ? { key: "exact", through: false } : undefined);
		const m = new QuadGraphModel(10, rels, titledBy);
		m.merge([q("sel-uuid", "exact", "12.1.1 the exact passage", TEXT_QUOTE_SELECTOR_LABEL)]);
		const c = m.clusters.find((c) => c.type === TEXT_QUOTE_SELECTOR_LABEL);
		expect(c?.displayLabels["sel-uuid"]).toBe("12.1.1 the exact passage");
	});

	// A proxy titled by an edge such as oa:hasSelector takes its target's title. relabel groups every held quad by subject,
	// so it resolves the target's quads even when a merge doesn't touch the target.
	it("titles a proxy through its declared edge by its target's title", () => {
		const rels = (type: string) => (type === TEXT_QUOTE_SELECTOR_LABEL ? { exact: LinkRelations.EXACT.rel } : undefined);
		const titledBy = (type: string) =>
			type === TEXT_QUOTE_SELECTOR_LABEL ? { key: "exact", through: false } : type === SPECIFIC_RESOURCE_LABEL ? { key: "hasSelector", through: true } : undefined;
		const m = new QuadGraphModel(10, rels, titledBy);
		m.merge([
			q("sel-uuid", "exact", "the located passage", TEXT_QUOTE_SELECTOR_LABEL),
			qe("sr-uuid", "hasSelector", "sel-uuid", TEXT_QUOTE_SELECTOR_LABEL, SPECIFIC_RESOURCE_LABEL),
		]);
		const c = m.clusters.find((c) => c.type === SPECIFIC_RESOURCE_LABEL);
		expect(c?.displayLabels["sr-uuid"]).toBe("the located passage");
	});

	// A declaration names an edge by its key, not its rel. Several of a type's edges can share a rel, and the quads carry the key.
	it("titles through an edge named by its key, along a chain, and ends a cycle", () => {
		const [CREDENTIAL, PRESENTATION, VERDICT] = ["Credential", "Presentation", "Verdict"];
		const titledBy = (type: string) =>
			({
				[CREDENTIAL]: { key: "type", through: false },
				[PRESENTATION]: { key: "verifiableCredential", through: true },
				[VERDICT]: { key: "verifiedPresentation", through: true },
			})[type];
		const m = new QuadGraphModel(10, () => ({}), titledBy);
		m.merge([
			q("vc", "type", "EmployeeCredential", CREDENTIAL),
			qe("vp", "verifiableCredential", "vc", CREDENTIAL, PRESENTATION),
			qe("pv", "verifiedPresentation", "vp", PRESENTATION, VERDICT),
			qe("loop-a", "verifiedPresentation", "loop-b", VERDICT, VERDICT),
			qe("loop-b", "verifiedPresentation", "loop-a", VERDICT, VERDICT),
		]);
		const labelOf = (type: string, id: string) => m.clusters.find((c) => c.type === type)?.displayLabels[id];
		expect(labelOf(PRESENTATION, "vp")).toBe("EmployeeCredential");
		expect(labelOf(VERDICT, "pv"), "through the presentation to its credential").toBe("EmployeeCredential");
		expect(labelOf(VERDICT, "loop-a"), "a cycle ends at a record already visited").toBeTypeOf("string");
	});
});
