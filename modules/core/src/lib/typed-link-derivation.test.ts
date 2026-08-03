import { describe, it, expect, beforeEach } from "vitest";
import { QuadStore } from "./quad-store.js";
import { COMMENT_LABEL, READING_LABEL, LinkRelations, SPECIFIC_RESOURCE_LABEL, TEXT_QUOTE_SELECTOR_LABEL, createComment, readTypedLinks, readingIdFor } from "./resources.js";
import type { TLinkVocabulary } from "./typed-links.js";

// A registered fixture type, as a consumer would declare one. Statements connect records of registered types only.
const REPORT = "FieldReport";
const TYPES = new Set([REPORT, COMMENT_LABEL, SPECIFIC_RESOURCE_LABEL, TEXT_QUOTE_SELECTOR_LABEL, READING_LABEL]);
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
		store = new QuadStore();
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
		const anchor = await store.getIndividual<{ label?: string }>(SPECIFIC_RESOURCE_LABEL, cited[0]);
		expect(anchor?.label).toBe("the signing rule");
		const selectorIds = await edgesOf(store, cited[0], LinkRelations.HAS_SELECTOR.rel);
		const selector = await store.getIndividual<{ exact: string }>(TEXT_QUOTE_SELECTOR_LABEL, selectorIds[0]);
		expect(selector?.exact).toBe("shall be signed");
		expect(await edgesOf(store, cited[0], LinkRelations.HAS_SOURCE.rel)).toEqual(["spec-1"]);
	});

	it("records the reading, what it read, and the step that read it", async () => {
		await readTypedLinks(store, vocab, source, "See [the specification](#FieldReport:spec-1).", { seqPath: "0.1.2" });
		const derivationId = readingIdFor(REPORT, source.id);
		const reading = await store.getIndividual<{ seqPath: string; stated: string[] }>(READING_LABEL, derivationId);
		expect(reading?.seqPath).toBe("0.1.2");
		expect(await edgesOf(store, derivationId, LinkRelations.USED.rel)).toEqual([source.id]);
		expect(JSON.parse(reading?.stated[0] ?? "{}")).toMatchObject({ kind: "edge", rel: LinkRelations.MENTIONS.rel, o: "spec-1" });
	});

	it("derives no anchor for an untyped reference to a passage: navigation stays in the link, the edge is record-level", async () => {
		await readTypedLinks(store, vocab, source, "Also [§12.1.2](#FieldReport:spec-1:~:text=a%20clause).");
		expect(await edgesOf(store, source.id, LinkRelations.MENTIONS.rel)).toEqual(["spec-1"]);
		expect(await store.queryIndividuals(SPECIFIC_RESOURCE_LABEL)).toHaveLength(0);
		expect(await store.queryIndividuals(TEXT_QUOTE_SELECTOR_LABEL)).toHaveLength(0);
	});

	it("marks the anchors it writes with the reading that generated them", async () => {
		await readTypedLinks(store, vocab, source, "[that clause:cites](#FieldReport:spec-1:~:text=a%20clause)");
		const [anchorId] = await edgesOf(store, source.id, LinkRelations.CITES.rel);
		expect(await edgesOf(store, anchorId, LinkRelations.WAS_GENERATED_BY.rel)).toEqual([readingIdFor(REPORT, source.id)]);
	});

	it("retracts exactly the previous reading when the text is rewritten", async () => {
		await readTypedLinks(store, vocab, source, "[the old one:cites](#FieldReport:gone-1) and [that clause:cites](#FieldReport:spec-1:~:text=a%20clause)");
		await store.createEdge(REPORT, source.id, LinkRelations.MENTIONS.rel, REPORT, "by-hand-1");
		await readTypedLinks(store, vocab, source, "[the one that stays:cites](#FieldReport:stays-1)");
		expect(await edgesOf(store, source.id, LinkRelations.CITES.rel)).toEqual(["stays-1"]);
		expect(await edgesOf(store, source.id, LinkRelations.MENTIONS.rel)).toEqual(["by-hand-1"]);
		expect(await store.queryIndividuals(SPECIFIC_RESOURCE_LABEL)).toHaveLength(0);
		expect(await store.queryIndividuals(TEXT_QUOTE_SELECTOR_LABEL)).toHaveLength(0);
	});

	it("states the same facts when the same text is read again", async () => {
		const text = "[the specification:cites](#FieldReport:spec-1)";
		await readTypedLinks(store, vocab, source, text);
		await readTypedLinks(store, vocab, source, text);
		expect(await edgesOf(store, source.id, LinkRelations.CITES.rel)).toEqual(["spec-1"]);
	});

	it("leaves no reading behind for a text that states nothing", async () => {
		await readTypedLinks(store, vocab, source, "Plain prose with no links.");
		expect(await store.queryIndividuals(READING_LABEL)).toHaveLength(0);
	});

	it("states nothing for an untyped link to a record that is not here; a typed link fails", async () => {
		await readTypedLinks(store, vocab, source, "See [an absent one](#FieldReport:absent-1).");
		expect(await edgesOf(store, source.id, LinkRelations.MENTIONS.rel)).toEqual([]);
		await expect(readTypedLinks(store, vocab, source, "[an absent one:cites](#FieldReport:absent-1)")).rejects.toThrow(/a record that exists/);
	});
});

describe("a note's own links", () => {
	it("states a cross-record link from the note that made it", async () => {
		const store = new QuadStore();
		await store.upsertIndividual(REPORT, { id: "spec-1", generatedAtTime: "2026-07-01T00:00:00.000Z" });
		const commentId = await createComment(
			store,
			vocab,
			"did:example:reviewer",
			"Contradicts [a later clause:linksTo](#FieldReport:spec-1:~:text=a%20later%20clause).",
			"2026-07-01T00:00:00.000Z",
		);
		const [anchorId] = await edgesOf(store, commentId, LinkRelations.LINKS_TO.rel);
		expect(await edgesOf(store, anchorId, LinkRelations.HAS_SOURCE.rel)).toEqual(["spec-1"]);
	});
});
