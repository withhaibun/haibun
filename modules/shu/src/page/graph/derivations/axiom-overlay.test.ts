import { describe, expect, it } from "vitest";
import { FRAME_KIND, type TGraphAxioms } from "@haibun/core/lib/records/domains/axioms.js";
import { axiomOverlay, sameOverlay, withAxioms } from "./axiom-overlay.js";
import { edgeKey } from "./focus-policy.js";
import type { TDrawn } from "./source-lines.js";
import { CLASS_LABEL } from "@haibun/core/lib/domains/resources.js";
import { ONTOLOGY_FIELD } from "@haibun/core/lib/records/domains/ontology.js";
import { graphAxioms } from "../../../derivations/graph-axioms.js";
import type { GraphModel } from "../../../domains/graph-model.js";

const DRAWN: TDrawn = { nodes: ["e1", "Email"], edges: [{ from: "e1", predicate: "type", to: "Email" }] };
const frame = (kind: (typeof FRAME_KIND)[keyof typeof FRAME_KIND], name: string, dl: string, extra: object = {}) => ({
	name,
	kind,
	manchester: "",
	dl,
	statement: "",
	nodes: [],
	edges: [],
	...extra,
});
const AXIOMS: TGraphAxioms = {
	text: "",
	summary: { classes: 1, properties: 1, individuals: 2 },
	frames: [
		frame(FRAME_KIND.class, "Class Email", "Email ⊑ prov:Entity", { nodes: ["Email"] }),
		frame(FRAME_KIND.property, "ObjectProperty type", "∃type.⊤ ⊑ Email · ⊤ ⊑ ∀type.Class", {
			edges: [
				{ from: "e1", label: "type", to: "Email" },
				{ from: "e9", label: "type", to: "Email" },
			],
		}),
		frame(FRAME_KIND.individual, "Individual e1", "Email(e1)", { nodes: ["e1"], assertedBy: { persistedAs: "Email", id: "e1" }, entailed: ["prov:Entity"] }),
		frame(FRAME_KIND.individual, "Individual e9", "Email(e9)", { nodes: ["e9"], assertedBy: { persistedAs: "Email", id: "e9" } }),
	],
};

describe("the graph's DL view", () => {
	it("maps the axioms onto the nodes and edges the scene draws, by the same ids, and leaves out what it doesn't draw", () => {
		const overlay = axiomOverlay(DRAWN, AXIOMS);
		expect([...overlay.nodes.keys()].sort()).toEqual([...DRAWN.nodes].sort());
		expect([...overlay.edges.keys()]).toEqual(DRAWN.edges.map(({ from, predicate, to }) => edgeKey(from, predicate, to)));
	});

	it("marks the types the ontology entails of an individual apart from the type its record asserts, and carries each frame's axioms", () => {
		const overlay = axiomOverlay(DRAWN, AXIOMS);
		expect(overlay.nodes.get("e1")).toEqual({ lines: ["∈ Email", "⊨ ∈ prov:Entity"], frame: "Individual e1" });
		expect(overlay.nodes.get("Email")).toEqual({ lines: ["Email ⊑ prov:Entity"], frame: "Class Email" });
		expect(overlay.edges.get(edgeKey("e1", "type", "Email"))).toEqual({ lines: ["∃type.⊤ ⊑ Email", "⊤ ⊑ ∀type.Class"], frame: "ObjectProperty type" });
	});
});

describe("the DL view of a graph", () => {
	/** Two emails, one a reply to the other, and the Class record of Email, which the ontology states a kind of prov:Entity. */
	const MODEL: GraphModel = {
		nodes: [
			{ id: "m1", type: "Email", properties: {} },
			{ id: "m2", type: "Email", properties: {} },
			{ id: "Email", type: CLASS_LABEL, properties: {} },
		],
		edges: [{ from: "m2", to: "m1", predicate: "inReplyTo", graph: "Email" }],
	};
	const ONTOLOGY = [{ subject: "Email", predicate: ONTOLOGY_FIELD.subClassOf, object: "prov:Entity", namedGraph: "ontology", timestamp: 0 }];
	const drawn: TDrawn = { nodes: MODEL.nodes.map(({ id }) => id), edges: MODEL.edges };

	it("derives from the node and edge set the graph draws: the same ids, with axioms added", () => {
		const overlay = axiomOverlay(
			drawn,
			graphAxioms(MODEL, ONTOLOGY, (_type, edge) => edge),
		);
		expect([...overlay.nodes.keys()].sort()).toEqual([...drawn.nodes].sort());
		expect([...overlay.edges.keys()]).toEqual(drawn.edges.map(({ from, predicate, to }) => edgeKey(from, predicate, to)));
		expect(overlay.nodes.get("Email")?.lines, "a Class record carries its class's ⊑ axiom and its own type").toEqual(["Email ⊑ prov:Entity", "∈ Class"]);
		expect(overlay.nodes.get("m1")?.lines, "an individual carries its asserted type and its entailed one").toEqual(["∈ Email", "⊨ ∈ prov:Entity"]);
	});
});

describe("a chip's text in the DL view", () => {
	it("reads its label alone outside the DL view, and with a line for each axiom it carries in it", () => {
		expect(withAxioms("e1", undefined)).toBe("e1");
		expect(withAxioms("e1", { lines: ["∈ Email", "⊨ ∈ prov:Entity"], frame: "Individual e1" })).toBe("e1\n∈ Email\n⊨ ∈ prov:Entity");
	});
});

describe("whether the scene redraws an overlay", () => {
	it("holds two overlays of the same axioms on the same nodes and edges the same, and any change of them different", () => {
		expect(sameOverlay(axiomOverlay(DRAWN, AXIOMS), axiomOverlay(DRAWN, AXIOMS))).toBe(true);
		expect(sameOverlay(null, null)).toBe(true);
		expect(sameOverlay(axiomOverlay(DRAWN, AXIOMS), null)).toBe(false);
		expect(sameOverlay(axiomOverlay(DRAWN, AXIOMS), axiomOverlay({ ...DRAWN, nodes: ["e1"] }, AXIOMS))).toBe(false);
	});
});
