import { describe, it, expect } from "vitest";
import { QuadGraphModel } from "./quad-graph-model.js";
import type { TQuad } from "./quad-types.js";

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
});
