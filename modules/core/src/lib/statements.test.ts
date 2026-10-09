import { describe, it, expect, beforeEach } from "vitest";
import type { QuadStore } from "./quad-store.js";
import { LinkRelations, READING_LABEL, SEQ_PATH_LABEL, SEQ_PATH_STATUS, SPECIFIC_RESOURCE_LABEL, TEXT_QUOTE_SELECTOR_LABEL } from "./resources.js";
import { readTypedLinks } from "./records/pipelines/discourse-writes.js";
import { storeDeclaring } from "./test/declared-types.js";

const REPORT = "FieldReport";
import { SEQ_PATH_EDGE, SEQ_PATH_FIELD } from "./seq-path.js";
import { statementsWith } from "./statements.js";
import { itemAt } from "./util/item-at.js";
import type { TLinkVocabulary } from "./typed-links.js";

const vocab: TLinkVocabulary = {
	relRange: (rel) => Object.values(LinkRelations).find((e) => e.rel === rel && !(e as { abstract?: boolean }).abstract)?.range,
	isType: (name) => [REPORT, SEQ_PATH_LABEL, SPECIFIC_RESOURCE_LABEL].includes(name),
};

describe("statementsWith", () => {
	let store: QuadStore;

	beforeEach(async () => {
		store = storeDeclaring(Object.fromEntries([REPORT, SEQ_PATH_LABEL, READING_LABEL, SPECIFIC_RESOURCE_LABEL, TEXT_QUOTE_SELECTOR_LABEL].map((label) => [label, {}])));
		// An execution: the feature's step `0.1` is part of the root step `0`. The root step passed.
		await store.upsertIndividual(SEQ_PATH_LABEL, { [SEQ_PATH_FIELD.id]: "0", [SEQ_PATH_FIELD.actionStatus]: SEQ_PATH_STATUS.passed, [SEQ_PATH_FIELD.stepText]: "a run" });
		await store.upsertIndividual(SEQ_PATH_LABEL, { [SEQ_PATH_FIELD.id]: "0.1", [SEQ_PATH_FIELD.actionStatus]: SEQ_PATH_STATUS.running, [SEQ_PATH_FIELD.stepText]: "prose" });
		await store.createEdge(SEQ_PATH_LABEL, "0.1", SEQ_PATH_EDGE.isPartOf, SEQ_PATH_LABEL, "0");
		// The cited document. The statement references a record that exists.
		await store.upsertIndividual(REPORT, { id: "spec-1", generatedAtTime: "2026-07-01T00:00:00.000Z" });
		await readTypedLinks(
			store,
			vocab,
			{ label: SEQ_PATH_LABEL, id: "0.1" },
			"This scenario [the clause it exercises:citesAsEvidence](#FieldReport:spec-1:~:text=shall%20be%20signed).",
			{ seqPath: "0.1" },
		);
	});

	it("reads a statement as its three parts, and the subject and the object are references", async () => {
		const row = itemAt(await statementsWith(store, LinkRelations.CITES_AS_EVIDENCE.rel), 0);
		expect(row.subject).toEqual({ "@id": "0.1", "@type": SEQ_PATH_LABEL });
		expect(row.predicate).toBe(LinkRelations.CITES_AS_EVIDENCE.rel);
		expect(row.object["@type"]).toBe(SPECIFIC_RESOURCE_LABEL);
	});

	it("returns the reading that asserted it, the outermost step that contains the reading's step, and that step's status", async () => {
		const row = itemAt(await statementsWith(store, LinkRelations.CITES_AS_EVIDENCE.rel), 0);
		expect(row.reading).toEqual({ "@id": "reading:SeqPath:0.1", "@type": "Reading" });
		expect(row.assertedBy).toEqual({ "@id": "0", "@type": SEQ_PATH_LABEL });
		expect(row.outcome).toBe(SEQ_PATH_STATUS.passed);
	});

	it("reads a statement made by hand as a row without provenance, since a reading's stated records don't hold it", async () => {
		await store.createEdge(REPORT, "report-2", LinkRelations.CITES_AS_EVIDENCE.rel, REPORT, "spec-1");
		const rows = await statementsWith(store, LinkRelations.CITES_AS_EVIDENCE.rel);
		const byHand = rows.find((r) => r.subject["@id"] === "report-2");
		expect(byHand?.reading).toBeUndefined();
		expect(byHand?.outcome).toBeUndefined();
	});

	it("doesn't read a row for a predicate that a statement didn't use", async () => {
		expect(await statementsWith(store, LinkRelations.LINKS_TO.rel)).toEqual([]);
	});
});
