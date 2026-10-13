/**
 * What the graph shows after a person has put things away: the filters compose in one order, hidden types first,
 * then hidden predicates, then the prune over what is left. Every medium the scene renders into reads this one
 * derivation, so a chip put away has to disappear from the drawing, the still image and the accessible reading alike.
 */
import { describe, it, expect } from "vitest";
import { sceneDataHash, visibleGraphModel, type TSceneData } from "./scene-data.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

const quad = (subject: string, predicate: string, object: string, namedGraph: string, objectType?: string): TQuad => ({
	subject,
	predicate,
	object,
	namedGraph,
	objectType,
	timestamp: 1,
});

// An email that names its sender, a person without an incoming edge, and a file the email attaches.
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
	it("shows every type when the filter doesn't hide a type", () => {
		expect(ids(model())).toEqual(["email-1", "file-1", "person-1"]);
		expect(rels(model())).toEqual(["attachment", "sender"]);
	});

	it("a type put away takes its records with it, and the edges that pointed at them", () => {
		const shown = model({ hiddenGraphs: ["File"] });
		expect(ids(shown)).toEqual(["email-1", "person-1"]);
		expect(rels(shown), "an edge to a record that the view doesn't show is not an edge").toEqual(["sender"]);
	});

	it("a predicate put away takes only its edges: the records it linked stay", () => {
		const shown = model({ hiddenPredicates: ["sender"] });
		expect(ids(shown)).toEqual(["email-1", "file-1", "person-1"]);
		expect(rels(shown)).toEqual(["attachment"]);
	});
});

describe("the prune, which reads what is left rather than what was there", () => {
	it("drops a node without an incoming link", () => {
		const shown = model({ quads: [...quads, quad("note-1", "name", "aside", "Note")], prune: true });
		expect(ids(shown), "the note without an incoming edge goes").toEqual(["email-1", "file-1", "person-1"]);
	});

	it("counts a record edgeless when its every edge was put away, since the hiding comes first", () => {
		const shown = model({ hiddenPredicates: ["sender"], prune: true });
		expect(ids(shown), "the person no longer has an incoming link").toEqual(["email-1", "file-1"]);
	});
});

describe("the hash a repaint compares before it builds a model (PF31)", () => {
	const data = (over: Partial<TSceneData> = {}): TSceneData => ({
		quads,
		clusters: [],
		hiddenGraphs: ["Note"],
		hiddenPredicates: [],
		prune: false,
		roleRels: [],
		viewType: "force",
		options: { flatten: false },
		timeCursor: null,
		...over,
	});

	it("leaves the hash of a batch that brings only quads of a hidden type", () => {
		expect(sceneDataHash(data({ quads: [...quads, quad("note-1", "name", "aside", "Note")] }))).toBe(sceneDataHash(data()));
	});

	it("changes with a visible quad, a hidden type, the view, an option and the time cursor", () => {
		const base = sceneDataHash(data());
		for (const over of [
			{ quads: [...quads, quad("person-2", "name", "Ana", "Principal")] },
			{ hiddenGraphs: ["File"] },
			{ viewType: "gantt" },
			{ options: { flatten: true } },
			{ timeCursor: 5 },
		])
			expect(sceneDataHash(data(over))).not.toBe(base);
	});
});
