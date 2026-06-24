import { describe, it, expect } from "vitest";
import { composeDisplayLabel, MAX_DISPLAY_LABEL_LEN } from "./hypermedia.js";
import { LinkRelations } from "./resources.js";

const props = (o: Record<string, unknown>) => (f: string) => o[f];

describe("composeDisplayLabel priority: headline → body → weak → id", () => {
	it("uses NAME when present, over a body and a seqPath", () => {
		const rels = { subject: LinkRelations.NAME.rel, seqPath: LinkRelations.SEQ_PATH.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ subject: "RE: Meeting", seqPath: "0.1" }), bodyContents: ["the body"], id: "e1" })).toBe("RE: Meeting");
	});

	it("uses rdfs:label over the entity's NAME — an explicit display label wins", () => {
		const rels = { label: LinkRelations.LABEL.rel, name: LinkRelations.NAME.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ label: "Coastal Fisheries Authority", name: "should-not-win" }), bodyContents: [], id: "did:web:x" })).toBe("Coastal Fisheries Authority");
	});

	it("titles a name-less node (e.g. a Principal/DID) by its rdfs:label instead of falling back to the id", () => {
		const rels = { label: LinkRelations.LABEL.rel, controller: LinkRelations.CONTROLLER.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ label: "Importer Co.", controller: "did:web:x" }), bodyContents: [], id: "did:web:x" })).toBe("Importer Co.");
	});

	it("uses an inline CONTENT field when there is no name", () => {
		const rels = { text: LinkRelations.CONTENT.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ text: "inline note" }), bodyContents: [], id: "n1" })).toBe("inline note");
	});

	it("uses the linked-body preview over a seqPath (the Comment regression)", () => {
		const rels = { seqPath: LinkRelations.SEQ_PATH.rel, author: LinkRelations.ATTRIBUTED_TO.rel };
		const label = composeDisplayLabel({ rels, getProperty: props({ seqPath: "0.-1.26", author: "did:x" }), bodyContents: ["Lawrence vouches for this"], id: "cmt-say-0.-1.26" });
		expect(label).toBe("Lawrence vouches for this");
		expect(label).not.toContain("seqPath");
	});

	it("falls to a weak provenance pointer only when there is no headline or body", () => {
		const rels = { seqPath: LinkRelations.SEQ_PATH.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ seqPath: "0.1" }), bodyContents: [], id: "x" })).toBe("seqPath: 0.1");
	});

	it("falls to the subject id when nothing resolves", () => {
		expect(composeDisplayLabel({ rels: {}, getProperty: () => undefined, bodyContents: [], id: "n1" })).toBe("n1");
		expect(composeDisplayLabel({ rels: undefined, getProperty: () => undefined, id: "n2" })).toBe("n2");
	});

	it("picks the shortest non-empty body — the concise summary, not a blob", () => {
		expect(composeDisplayLabel({ rels: undefined, getProperty: () => undefined, bodyContents: ["x".repeat(300), "short", ""], id: "a" })).toBe("short");
	});

	it("clamps to MAX_DISPLAY_LABEL_LEN with an ellipsis", () => {
		const label = composeDisplayLabel({ rels: undefined, getProperty: () => undefined, bodyContents: ["y".repeat(200)], id: "a" });
		expect(label.length).toBe(MAX_DISPLAY_LABEL_LEN);
		expect(label.endsWith("…")).toBe(true);
	});
});
