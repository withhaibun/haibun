/**
 * What the graph shows after a person has put things away: the filters compose in one order, hidden types first,
 * then hidden predicates, then the prune over what is left. Every medium the scene renders into reads this one
 * derivation, so a chip put away has to disappear from the drawing, the still image and the accessible reading alike.
 */
import { describe, it, expect } from "vitest";
import { visibleGraphModel } from "./polymorphic-data-pipeline.js";
import { actorBars } from "./sequence-model.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import type { SeqLayout } from "./sequence-model.js";

const quad = (subject: string, predicate: string, object: string, namedGraph: string, objectType?: string): TQuad => ({
	subject,
	predicate,
	object,
	namedGraph,
	objectType,
	timestamp: 1,
});

// An email that names its sender, a person nothing points at, and a file the email attaches.
const quads: TQuad[] = [
	quad("email-1", "subject", "Invoice", "Email"),
	quad("email-1", "sender", "person-1", "Email", "Principal"),
	quad("email-1", "attachment", "file-1", "Email", "File"),
	quad("person-1", "name", "Vid", "Principal"),
	quad("file-1", "name", "invoice.pdf", "File"),
];

const model = (over: Partial<Parameters<typeof visibleGraphModel>[0]> = {}) =>
	visibleGraphModel({ quads, clusters: [], hiddenGraphs: [], hiddenPredicates: [], prune: false, roleRels: [], ...over });

const ids = (m: ReturnType<typeof visibleGraphModel>): string[] => m.nodes.map((n) => n.id).sort();
const rels = (m: ReturnType<typeof visibleGraphModel>): string[] => m.edges.map((e) => e.predicate).sort();

describe("what a person's filter leaves of the graph", () => {
	it("shows every type with nothing put away", () => {
		expect(ids(model())).toEqual(["email-1", "file-1", "person-1"]);
		expect(rels(model())).toEqual(["attachment", "sender"]);
	});

	it("a type put away takes its records with it, and the edges that pointed at them", () => {
		const shown = model({ hiddenGraphs: ["File"] });
		expect(ids(shown)).toEqual(["email-1", "person-1"]);
		expect(rels(shown), "an edge to a record nothing shows is not an edge").toEqual(["sender"]);
	});

	it("a predicate put away takes only its edges: the records it linked stay", () => {
		const shown = model({ hiddenPredicates: ["sender"] });
		expect(ids(shown)).toEqual(["email-1", "file-1", "person-1"]);
		expect(rels(shown)).toEqual(["attachment"]);
	});
});

describe("the prune, which reads what is left rather than what was there", () => {
	it("drops what nothing links to", () => {
		const shown = model({ quads: [...quads, quad("note-1", "name", "aside", "Note")], prune: true });
		expect(ids(shown), "the note nothing points at goes").toEqual(["email-1", "file-1", "person-1"]);
	});

	it("counts a record edgeless when its every edge was put away, since the hiding comes first", () => {
		const shown = model({ hiddenPredicates: ["sender"], prune: true });
		expect(ids(shown), "the person is now linked by nothing").toEqual(["email-1", "file-1"]);
	});
});

describe("the bars a sequence reads along", () => {
	const layout = (): SeqLayout => ({
		barOf: new Map([
			["msg-1", "issuer"],
			["msg-2", "holder"],
			["msg-3", "issuer"],
		]),
		actors: [
			{ id: "issuer", label: "Issuer" },
			{ id: "holder", label: "Holder" },
			{ id: "verifier", label: "Verifier" },
		],
		laneY: new Map(),
		placement: new Map([
			["msg-1", { y: 0, z: 0 }],
			["msg-2", { y: 1, z: 1 }],
			["msg-3", { y: 0, z: 2 }],
			["loose", { y: 2, z: 3 }],
		]),
		spans: new Map(),
		arrows: [],
		laneSpan: 0,
		timeSpan: 0,
	});

	it("puts each object on its participant's bar, in the order the layout placed them", () => {
		expect(actorBars(layout())).toEqual([
			{ id: "issuer", label: "Issuer", nodeIds: ["msg-1", "msg-3"] },
			{ id: "holder", label: "Holder", nodeIds: ["msg-2"] },
			{ id: "verifier", label: "Verifier", nodeIds: [] },
		]);
	});

	it("keeps a participant with nothing on it, which is itself worth reading", () => {
		expect(actorBars(layout()).find((b) => b.id === "verifier")?.nodeIds).toEqual([]);
	});
});
