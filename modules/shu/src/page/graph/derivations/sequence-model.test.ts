import { describe, expect, it } from "vitest";
import { HYPERMEDIA_ROLE_REL_KEY } from "../../../domains/graph-model.js";
import { GANTT_ROW_H } from "./gantt-layout.js";
import { SEQ_LANE_SPACING, actorBars, seqLabelOf, seqNodesOf, sequenceExtentOf, type SeqLayout } from "./sequence-model.js";

describe("the sequence's reading of the visible model", () => {
	it("carries each node's identity, type, label and properties, and its recorded time where the times hold one", () => {
		const nodes = [
			{ id: "a", type: "Email", displayLabel: "Invoice", properties: { x: 1 } },
			{ id: "b", type: "Principal", properties: {} },
		];
		expect(seqNodesOf(nodes, new Map([["a", { ms: 5 }]]))).toEqual([
			{ id: "a", type: "Email", displayLabel: "Invoice", properties: { x: 1 }, __t: 5 },
			{ id: "b", type: "Principal", displayLabel: undefined, properties: {}, __t: undefined },
		]);
	});

	it("names a participant by the noun of its role and its name, by its type where the role lacks a noun, and by its id where the graph lacks it", () => {
		const party = { name: "Coastal Fisheries", type: "Principal", properties: { [HYPERMEDIA_ROLE_REL_KEY]: "issuer" } };
		expect(seqLabelOf("did:a", party, (rel) => (rel === "issuer" ? "Issuer" : undefined))).toBe("Issuer, Coastal Fisheries");
		expect(seqLabelOf("did:a", party, () => undefined)).toBe("Principal, Coastal Fisheries");
		expect(seqLabelOf("did:a", { name: "", type: "Principal" }, () => undefined)).toBe("Principal, did:a");
		expect(seqLabelOf("did:a", undefined, () => undefined)).toBe("did:a");
	});

	it("frames a placement with a lane of room on the participant axis and a row on the time axis", () => {
		const layout = {
			placement: new Map([
				["a", { y: 0, z: 0 }],
				["b", { y: 10, z: 20 }],
			]),
		} as SeqLayout;
		expect(sequenceExtentOf(layout)).toEqual({ cy: 5, cz: 10, halfH: 5 + SEQ_LANE_SPACING, halfW: 10 + GANTT_ROW_H });
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

	it("keeps a participant without an object on its bar, which is itself to read", () => {
		expect(actorBars(layout()).find((b) => b.id === "verifier")?.nodeIds).toEqual([]);
	});
});
