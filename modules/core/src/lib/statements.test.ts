import { describe, it, expect, beforeEach } from "vitest";
import { QuadStore } from "./quad-store.js";
import { LinkRelations, SEQ_PATH_LABEL, SEQ_PATH_STATUS, SPECIFIC_RESOURCE_LABEL, readTypedLinks } from "./resources.js";

const REPORT = "FieldReport";
import { SEQ_PATH_EDGE, SEQ_PATH_FIELD } from "./seq-path.js";
import { statementsWith } from "./statements.js";
import type { TLinkVocabulary } from "./typed-links.js";

const vocab: TLinkVocabulary = {
	relRange: (rel) => Object.values(LinkRelations).find((e) => e.rel === rel && !(e as { abstract?: boolean }).abstract)?.range,
	isType: (name) => [REPORT, SEQ_PATH_LABEL, SPECIFIC_RESOURCE_LABEL].includes(name),
};

describe("statementsWith", () => {
	let store: QuadStore;

	beforeEach(async () => {
		store = new QuadStore();
		// A run: the feature's step sits inside the run that ended by passing.
		await store.upsertIndividual(SEQ_PATH_LABEL, { [SEQ_PATH_FIELD.id]: "0", [SEQ_PATH_FIELD.actionStatus]: SEQ_PATH_STATUS.passed, [SEQ_PATH_FIELD.stepText]: "a run" });
		await store.upsertIndividual(SEQ_PATH_LABEL, { [SEQ_PATH_FIELD.id]: "0.1", [SEQ_PATH_FIELD.actionStatus]: SEQ_PATH_STATUS.running, [SEQ_PATH_FIELD.stepText]: "prose" });
		await store.createEdge(SEQ_PATH_LABEL, "0.1", SEQ_PATH_EDGE.isPartOf, SEQ_PATH_LABEL, "0");
		// The cited document: a statement is made about a record that exists.
		await store.upsertIndividual(REPORT, { id: "spec-1", generatedAtTime: "2026-07-01T00:00:00.000Z" });
		await readTypedLinks(
			store,
			vocab,
			{ label: SEQ_PATH_LABEL, id: "0.1" },
			"This scenario [the clause it exercises:citesAsEvidence](#FieldReport:spec-1:~:text=shall%20be%20signed).",
			{
				seqPath: "0.1",
			},
		);
	});

	it("reads a statement as its three parts, each a reference to open", async () => {
		const [row] = await statementsWith(store, LinkRelations.CITES_AS_EVIDENCE.rel);
		expect(row.subject).toEqual({ "@id": "0.1", "@type": SEQ_PATH_LABEL });
		expect(row.predicate).toBe(LinkRelations.CITES_AS_EVIDENCE.rel);
		expect(row.object["@type"]).toBe(SPECIFIC_RESOURCE_LABEL);
	});

	it("says which reading asserted it, and how the run that made it ended", async () => {
		const [row] = await statementsWith(store, LinkRelations.CITES_AS_EVIDENCE.rel);
		expect(row.reading).toEqual({ "@id": "reading:SeqPath:0.1", "@type": "Reading" });
		expect(row.assertedBy).toEqual({ "@id": "0", "@type": SEQ_PATH_LABEL });
		expect(row.outcome).toBe(SEQ_PATH_STATUS.passed);
	});

	it("reads a statement no reading claims, made by hand, as a row with no provenance", async () => {
		await store.createEdge(REPORT, "report-2", LinkRelations.CITES_AS_EVIDENCE.rel, REPORT, "spec-1");
		const rows = await statementsWith(store, LinkRelations.CITES_AS_EVIDENCE.rel);
		const byHand = rows.find((r) => r.subject["@id"] === "report-2");
		expect(byHand?.reading).toBeUndefined();
		expect(byHand?.outcome).toBeUndefined();
	});

	it("reads nothing for a predicate nothing was stated with", async () => {
		expect(await statementsWith(store, LinkRelations.LINKS_TO.rel)).toEqual([]);
	});
});
