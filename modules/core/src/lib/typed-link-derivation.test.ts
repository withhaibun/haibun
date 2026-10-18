import { describe, it, expect, beforeEach } from "vitest";
import type { QuadStore } from "./steps/pipelines/quad-store.js";
import { BODY_LABEL, COMMENT_LABEL, FRAGMENT_SELECTOR_LABEL, READING_LABEL, LinkRelations, SPECIFIC_RESOURCE_LABEL, TEXT_QUOTE_SELECTOR_LABEL } from "./domains/resources.js";
import { commentBodyIdOf, createComment, readTypedLinks, readingIdFor } from "./records/pipelines/discourse-writes.js";
import { DEFAULT_BODY_KIND } from "./records/derivations/bodies.js";
import { MEDIA_TYPE } from "./domains/media-types.js";
import { readEvery, recordOf } from "./records/pipelines/record-reads.js";
import { storeDeclaring } from "./test/declared-types.js";
import { z } from "zod";
import { FRAGMENT_SPEC } from "./domains/media-fragments.js";
import type { TLinkVocabulary } from "./domains/typed-links.js";
import { itemAt } from "./domains/item-at.js";

// A registered fixture type, as a consumer would declare one. Statements connect records of registered types only.
const REPORT = "FieldReport";
const TYPES = new Set([REPORT, COMMENT_LABEL, BODY_LABEL, SPECIFIC_RESOURCE_LABEL, TEXT_QUOTE_SELECTOR_LABEL, READING_LABEL]);
/** The types the derivation writes and reads, declared so the store reads their records. */
const DECLARED = Object.fromEntries([...TYPES, FRAGMENT_SELECTOR_LABEL].map((label) => [label, {}]));
const vocab: TLinkVocabulary = {
	relRange: (rel) => Object.values(LinkRelations).find((e) => e.rel === rel && !(e as { abstract?: boolean }).abstract)?.range,
	isType: (name) => TYPES.has(name),
};

/** The store as the derivation writes it: every edge is a quad in the subject's own named graph. */
const edgesOf = async (store: QuadStore, subject: string, rel: string) => (await store.query({ subject, predicate: rel })).map((q) => String(q.object));

describe("readTypedLinks", () => {
	let store: QuadStore;
	const source = { label: REPORT, id: "report-1" };

	beforeEach(async () => {
		store = storeDeclaring(DECLARED);
		// A statement is made about a record that exists, so every record a test's text refers to is here first.
		for (const id of [source.id, "spec-1", "gone-1", "stays-1", "by-hand-1"]) await store.upsertIndividual(REPORT, { id, generatedAtTime: "2026-07-01T00:00:00.000Z" });
	});

	it("states a link between two records as an edge", async () => {
		await readTypedLinks(store, vocab, source, "See [the specification](#FieldReport:spec-1).");
		expect(await edgesOf(store, source.id, LinkRelations.MENTIONS.rel)).toEqual(["spec-1"]);
	});

	it("makes a typed citation an edge to the passage's anchor, labelled by the link text", async () => {
		await readTypedLinks(store, vocab, source, "This [the signing rule:citesAsEvidence](#FieldReport:spec-1:~:text=shall%20be%20signed).");
		const cited = await edgesOf(store, source.id, LinkRelations.CITES_AS_EVIDENCE.rel);
		expect(cited).toHaveLength(1);
		const anchor = await recordOf(store, SPECIFIC_RESOURCE_LABEL, itemAt(cited, 0));
		expect(anchor?.label).toBe("the signing rule");
		const selectorIds = await edgesOf(store, itemAt(cited, 0), LinkRelations.HAS_SELECTOR.rel);
		const selector = await recordOf(store, TEXT_QUOTE_SELECTOR_LABEL, itemAt(selectorIds, 0));
		expect(selector?.exact).toBe("shall be signed");
		expect(await edgesOf(store, itemAt(cited, 0), LinkRelations.HAS_SOURCE.rel)).toEqual(["spec-1"]);
	});

	it("makes a typed citation of a page an edge to the page's anchor, located by a FragmentSelector", async () => {
		await readTypedLinks(store, vocab, source, "This [the table:cites](#FieldReport:spec-1:~:page=12).");
		const cited = itemAt(await edgesOf(store, source.id, LinkRelations.CITES.rel), 0);
		const selectorId = itemAt(await edgesOf(store, cited, LinkRelations.HAS_SELECTOR.rel), 0);
		const selector = await recordOf(store, FRAGMENT_SELECTOR_LABEL, selectorId);
		expect(selector, "the page, as RFC 8118 writes it").toMatchObject({ conformsTo: FRAGMENT_SPEC.pdf, value: "page=12" });
		expect(await edgesOf(store, cited, LinkRelations.HAS_SOURCE.rel)).toEqual(["spec-1"]);
	});

	it("records the reading, what it read, and the step that read it", async () => {
		await readTypedLinks(store, vocab, source, "See [the specification](#FieldReport:spec-1).", { seqPath: "0.1.2" });
		const derivationId = readingIdFor(REPORT, source.id);
		const reading = await recordOf(store, READING_LABEL, derivationId);
		expect(reading?.seqPath).toBe("0.1.2");
		expect(await edgesOf(store, derivationId, LinkRelations.USED.rel)).toEqual([source.id]);
		const [stated] = z.array(z.string()).parse(reading?.stated);
		expect(JSON.parse(stated ?? "{}")).toMatchObject({ kind: "edge", rel: LinkRelations.MENTIONS.rel, o: "spec-1" });
	});

	it("doesn't derive an anchor for an untyped reference to a passage: navigation stays in the link, the edge is record-level", async () => {
		await readTypedLinks(store, vocab, source, "Also [§12.1.2](#FieldReport:spec-1:~:text=a%20clause).");
		expect(await edgesOf(store, source.id, LinkRelations.MENTIONS.rel)).toEqual(["spec-1"]);
		expect(await readEvery(store, { label: SPECIFIC_RESOURCE_LABEL })).toHaveLength(0);
		expect(await readEvery(store, { label: TEXT_QUOTE_SELECTOR_LABEL })).toHaveLength(0);
	});

	it("marks the anchors it writes with the reading that generated them", async () => {
		await readTypedLinks(store, vocab, source, "[that clause:cites](#FieldReport:spec-1:~:text=a%20clause)");
		const anchorId = itemAt(await edgesOf(store, source.id, LinkRelations.CITES.rel), 0);
		expect(await edgesOf(store, anchorId, LinkRelations.WAS_GENERATED_BY.rel)).toEqual([readingIdFor(REPORT, source.id)]);
	});

	it("retracts exactly the previous reading when the text is rewritten", async () => {
		await readTypedLinks(store, vocab, source, "[the old one:cites](#FieldReport:gone-1) and [that clause:cites](#FieldReport:spec-1:~:text=a%20clause)");
		await store.createEdge(REPORT, source.id, LinkRelations.MENTIONS.rel, REPORT, "by-hand-1");
		await readTypedLinks(store, vocab, source, "[the one that stays:cites](#FieldReport:stays-1)");
		expect(await edgesOf(store, source.id, LinkRelations.CITES.rel)).toEqual(["stays-1"]);
		expect(await edgesOf(store, source.id, LinkRelations.MENTIONS.rel)).toEqual(["by-hand-1"]);
		expect(await readEvery(store, { label: SPECIFIC_RESOURCE_LABEL })).toHaveLength(0);
		expect(await readEvery(store, { label: TEXT_QUOTE_SELECTOR_LABEL })).toHaveLength(0);
	});

	it("states the same facts when the same text is read again", async () => {
		const text = "[the specification:cites](#FieldReport:spec-1)";
		await readTypedLinks(store, vocab, source, text);
		await readTypedLinks(store, vocab, source, text);
		expect(await edgesOf(store, source.id, LinkRelations.CITES.rel)).toEqual(["spec-1"]);
	});

	it("doesn't leave a reading for a text that doesn't state a fact", async () => {
		await readTypedLinks(store, vocab, source, "Plain prose with no links.");
		expect(await readEvery(store, { label: READING_LABEL })).toHaveLength(0);
	});

	it("doesn't state a fact for an untyped link to a record that is not here; a typed link fails", async () => {
		await readTypedLinks(store, vocab, source, "See [an absent one](#FieldReport:absent-1).");
		expect(await edgesOf(store, source.id, LinkRelations.MENTIONS.rel)).toEqual([]);
		await expect(readTypedLinks(store, vocab, source, "[an absent one:cites](#FieldReport:absent-1)")).rejects.toThrow(/a record that exists/);
	});
});

describe("a note's own links", () => {
	it("states a cross-record link from the note that made it", async () => {
		const store = storeDeclaring(DECLARED);
		await store.upsertIndividual(REPORT, { id: "spec-1", generatedAtTime: "2026-07-01T00:00:00.000Z" });
		const commentId = await createComment(
			store,
			vocab,
			"did:example:reviewer",
			"Contradicts [a later clause:linksTo](#FieldReport:spec-1:~:text=a%20later%20clause).",
			"2026-07-01T00:00:00.000Z",
		);
		const anchorId = itemAt(await edgesOf(store, commentId, LinkRelations.LINKS_TO.rel), 0);
		expect(await edgesOf(store, anchorId, LinkRelations.HAS_SOURCE.rel)).toEqual(["spec-1"]);
	});
});

describe("a Comment's Body", () => {
	it("is named by the rule that names a record's Body from its declaration", async () => {
		const store = storeDeclaring(DECLARED);
		const commentId = await createComment(store, vocab, "did:example:reviewer", "A *note*.", "2026-07-01T00:00:00.000Z");
		const bodyId = `body-${commentId}-${DEFAULT_BODY_KIND}-text-markdown`;
		expect(bodyId).toBe(commentBodyIdOf(commentId));
		expect(await edgesOf(store, commentId, LinkRelations.HAS_BODY.rel)).toEqual([bodyId]);
		expect(await recordOf(store, BODY_LABEL, bodyId)).toMatchObject({ content: "A *note*.", mediaType: MEDIA_TYPE.markdown });
	});
});
