import { describe, it, expect, beforeEach } from "vitest";
import type { QuadStore } from "./quad-store.js";
import {
	LinkRelations,
	readingDomainDefinition,
	SEQ_PATH_LABEL,
	SPECIFIC_RESOURCE_LABEL,
	specificResourceDomainDefinition,
	textQuoteSelectorDomainDefinition,
} from "../../domains/resources.js";
import { readTypedLinks } from "../../records/pipelines/discourse-writes.js";
import { RECORDED_STATUS } from "../../domains/protocol.js";
import { declaredTypeOf, storeDeclaring } from "../../test/declared-types.js";

const REPORT = "FieldReport";
/** A line's record, and the record of a statement of it, by their record names. */
const LINE = "1-1.0.1.1.2";
const STEP = `${LINE}.1`;
import { SEQ_PATH_FIELD } from "../../actuality/domains/seq-path.js";
import { statementsWith } from "./statements.js";
import { itemAt } from "../../domains/item-at.js";
import type { TLinkVocabulary } from "../../domains/typed-links.js";

const vocab: TLinkVocabulary = {
	relRange: (rel) => Object.values(LinkRelations).find((e) => e.rel === rel && !(e as { abstract?: boolean }).abstract)?.range,
	isType: (name) => [REPORT, SEQ_PATH_LABEL, SPECIFIC_RESOURCE_LABEL].includes(name),
};

describe("statementsWith", () => {
	let store: QuadStore;

	beforeEach(async () => {
		store = storeDeclaring(
			Object.fromEntries([
				...[REPORT, SEQ_PATH_LABEL].map((label) => [label, {}]),
				...[readingDomainDefinition, specificResourceDomainDefinition, textQuoteSelectorDomainDefinition].map(declaredTypeOf),
			]),
		);
		// A feature of an actuality: the line `1-1.0.1.1.2` passed, and its statement `1-1.0.1.1.2.1` is running.
		await store.upsertIndividual(SEQ_PATH_LABEL, { [SEQ_PATH_FIELD.id]: LINE, [SEQ_PATH_FIELD.actionStatus]: RECORDED_STATUS.completed, [SEQ_PATH_FIELD.stepText]: "a line" });
		await store.upsertIndividual(SEQ_PATH_LABEL, { [SEQ_PATH_FIELD.id]: STEP, [SEQ_PATH_FIELD.actionStatus]: RECORDED_STATUS.running, [SEQ_PATH_FIELD.stepText]: "prose" });
		// The cited document. The statement references a record that exists.
		await store.upsertIndividual(REPORT, { id: "spec-1", generatedAtTime: "2026-07-01T00:00:00.000Z" });
		await readTypedLinks(
			store,
			vocab,
			{ label: SEQ_PATH_LABEL, id: STEP },
			"This scenario [the clause it exercises:citesAsEvidence](#FieldReport:spec-1:~:text=shall%20be%20signed).",
			{ seqPath: STEP },
		);
	});

	it("reads a statement as its three parts, and the subject and the object are references", async () => {
		const row = itemAt(await statementsWith(store, LinkRelations.CITES_AS_EVIDENCE.rel), 0);
		expect(row.subject).toEqual({ "@id": STEP, "@type": SEQ_PATH_LABEL });
		expect(row.predicate).toBe(LinkRelations.CITES_AS_EVIDENCE.rel);
		expect(row.object["@type"]).toBe(SPECIFIC_RESOURCE_LABEL);
	});

	it("returns the reading that asserted it, the line that contains the reading's step, and that line's status", async () => {
		const row = itemAt(await statementsWith(store, LinkRelations.CITES_AS_EVIDENCE.rel), 0);
		expect(row.reading).toEqual({ "@id": `reading:SeqPath:${STEP}`, "@type": "Reading" });
		expect(row.assertedBy).toEqual({ "@id": LINE, "@type": SEQ_PATH_LABEL });
		expect(row.outcome).toBe(RECORDED_STATUS.completed);
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
