/**
 * Writes the discourse records whose writes read records: a Comment with its markdown body, a W3C Web Annotation, and the
 * statements a text's typed links state, as a Reading of the text that undoes the previous Reading of the same text. Reads
 * the previous Reading and each link's target through the read of records.
 */
import { fromJsonText } from "../../domains/json-text.js";
import {
	COMMENT_LABEL,
	COMMENT_TOPOLOGY,
	LinkRelations,
	READING_LABEL,
	ReadingSchema,
	SEQ_PATH_LABEL,
	SPECIFIC_RESOURCE_LABEL,
	StatedRecordSchema,
	anchorPart,
	assertCommentGrounded,
	commentName,
	type TDiscourseStore,
	type TPart,
	type TQuoteAnchor,
	type TStatedRecord,
} from "../../domains/resources.js";
import { typedLinkFacts } from "../derivations/typed-link-facts.js";
import type { TLinkVocabulary, TTypedLinkFact } from "../../domains/typed-links.js";
import { recordOf, type TRecordReader } from "./record-reads.js";
import type { IQuadStore } from "../../steps/ports.js";
import { referenceTo } from "../domains/unit.js";
import { MEDIA_TYPE } from "../../domains/media-types.js";
import { DEFAULT_BODY_KIND, bodyIdOf, bodyKindsOf } from "../derivations/bodies.js";
import { keyedId } from "../derivations/unit-parts.js";

/** The store a reading writes and reads: the discourse writes and the read of records. */
type TReadingStore = TDiscourseStore & TRecordReader & Pick<IQuadStore, "readRecord">;

/** Returns a stable reading id per source, so reading the source again replaces the previous reading and doesn't add one per run. */
export function readingIdFor(sourceLabel: string, sourceId: string): string {
	return `reading:${sourceLabel}:${sourceId}`;
}

/** Undoes the previous reading of this source. It retracts the reading's statements, deletes the anchors it wrote and removes the reading. */
async function retractReading(store: TReadingStore, readingId: string): Promise<void> {
	const prior = await store.readRecord({ label: READING_LABEL, schema: ReadingSchema }, readingId);
	if (!prior) return;
	for (const entry of prior.stated) {
		const record = fromJsonText(StatedRecordSchema).parse(entry);
		if (record.kind === "edge") await store.remove({ label: record.sLabel, id: record.s, edge: { rel: record.rel, to: { label: record.oLabel, id: record.o } } });
		else await store.remove(record);
	}
	await store.remove({ label: READING_LABEL, id: readingId });
}

/**
 * Writes the facts a text's links state, with `source` as their subject.
 *
 * Every statement connects two records of registered types. One is the text, which is already a record of its own
 * type. The other is the individual its link names by `#Type:id`. The persisted-type registry defines the link
 * targets. An untyped link to an absent record is prose and doesn't state a fact. A typed link to an absent record
 * throws. A typed link's part is a passage or a fragment of media. `anchorPart` anchors it on the W3C Web Annotation
 * types and labels it with the link text.
 *
 * A Reading records what it read (`prov:used`), the step that read it and every statement it made, and each anchor it wrote
 * links it through `prov:wasGeneratedBy`. Reading a rewritten text then undoes the previous reading and leaves statements
 * asserted by hand unchanged.
 */
export async function readTypedLinks(
	store: TReadingStore,
	vocab: TLinkVocabulary,
	source: { label: string; id: string },
	markdown: string | undefined,
	provenance?: { seqPath?: string; facts?: TTypedLinkFact[] },
): Promise<{ readingId: string; statements: number } | undefined> {
	const readingId = readingIdFor(source.label, source.id);
	await retractReading(store, readingId);
	// A caller that already parsed the text passes its facts, so a prose line is parsed once.
	const facts = provenance?.facts ?? (markdown ? typedLinkFacts(markdown, vocab) : []);
	if (facts.length === 0) return undefined;
	const stated: TStatedRecord[] = [];
	const reading = { label: READING_LABEL, id: readingId };
	/** Anchors a part inside a record and returns the SpecificResource an edge can target. The SpecificResource owns its selector,
	 *  so the reading's removal of it removes the anchor pair. */
	const anchored = async (base: { label: string; id: string }, part: TPart, linkText?: string): Promise<{ label: string; id: string }> => {
		const { specificResourceId } = await anchorPart(store, base, part, { ...(linkText ? { label: linkText } : {}), generatedBy: reading });
		const written = { label: SPECIFIC_RESOURCE_LABEL, id: specificResourceId };
		stated.push({ kind: "individual", ...written });
		return written;
	};
	for (const fact of facts) {
		const named = { label: fact.target.persistedAs, id: fact.target.id };
		// The target must exist. Creating an id-only record as the target would add a node that doesn't hold a property.
		if (!(await recordOf(store, named.label, named.id))) {
			if (!fact.typed) continue;
			throw new Error(`typed link "${fact.linkText ?? fact.rel}" refers to ${named.label} "${named.id}", which isn't a record that exists. Write that record first.`);
		}
		// Only a typed link anchors its passage. An untyped link derives only the record-level edge, and its passage stays
		// in the link, so plain cross-references don't add anchor records.
		const target = fact.typed && fact.target.anchor ? await anchored(named, fact.target.anchor, fact.linkText) : named;
		await store.merge({ "@type": source.label, "@id": source.id, [fact.rel]: referenceTo(target.label, target.id) });
		stated.push({ kind: "edge", s: source.id, sLabel: source.label, rel: fact.rel, o: target.id, oLabel: target.label });
	}
	// The reading records its statements and the text it read once it has made them.
	await store.create({
		"@type": READING_LABEL,
		id: readingId,
		...(provenance?.seqPath ? { seqPath: provenance.seqPath } : {}),
		stated: stated.map((record) => JSON.stringify(record)),
		[LinkRelations.USED.rel]: referenceTo(source.label, source.id),
	});
	return { readingId, statements: stated.filter((d) => d.kind === "edge").length };
}

/** Reads a feature's prose line as a text: its links become facts about the prose step, whose record `step` names. Prose without
 *  a fact leaves the records as they are, and the facts parsed here pass to `readTypedLinks`, so the text is parsed once. */
export async function readProseLinks(store: TReadingStore, vocab: TLinkVocabulary, source: { label: string; id: string }, prose: string, step: string): Promise<void> {
	const facts = typedLinkFacts(prose, vocab);
	if (facts.length === 0) return;
	await readTypedLinks(store, vocab, source, prose, { seqPath: step, facts });
}

/** The forms of the one Body a Comment's topology declares. */
const COMMENT_BODY = bodyKindsOf(COMMENT_LABEL, COMMENT_TOPOLOGY.properties).get(DEFAULT_BODY_KIND);

/** Returns the id of the Comment `commentId`'s Body. Throws where the Comment's topology doesn't declare its Body. */
export function commentBodyIdOf(commentId: string): string {
	if (COMMENT_BODY === undefined) throw new Error(`${COMMENT_LABEL}'s topology doesn't declare a ${DEFAULT_BODY_KIND} content field for its text. Declare its body field`);
	return bodyIdOf(commentId, DEFAULT_BODY_KIND, COMMENT_BODY);
}

/** Creates a Comment individual that owns its markdown body as a Body, with the period it describes and the edges `stated` adds,
 *  and returns its id. `step` is the record name of the step that writes it, which with its author is the Comment's key, so the
 *  Comment names its Body by the id its key derives. The `comment` and `annotate` acts both call it. `name` titles the node by the
 *  truncated note text and not by its id. The note is markdown, so readTypedLinks derives the facts its links state with the
 *  Comment as their subject. */
export async function createComment(
	store: TReadingStore,
	vocab: TLinkVocabulary,
	written: { author: string; step: string },
	text: string,
	stated?: { start?: string; end?: string; edges?: Readonly<Record<string, unknown>> },
	provenance?: { seqPath?: string },
): Promise<string> {
	const keyed = { author: written.author, [LinkRelations.WAS_GENERATED_BY.rel]: referenceTo(SEQ_PATH_LABEL, written.step) };
	const commentId = COMMENT_TOPOLOGY.keys && keyedId(COMMENT_LABEL, COMMENT_TOPOLOGY.keys, keyed);
	if (commentId === undefined) throw new Error(`${COMMENT_LABEL}'s keys don't read its author and the step that writes it. Declare that key`);
	await store.create({
		"@type": COMMENT_LABEL,
		...keyed,
		...(stated?.start ? { startedAtTime: stated.start } : {}),
		...(stated?.end ? { endedAtTime: stated.end } : {}),
		name: commentName(text),
		[LinkRelations.HAS_BODY.rel]: { id: commentBodyIdOf(commentId), content: text, mediaType: MEDIA_TYPE.markdown },
		...stated?.edges,
	});
	await readTypedLinks(store, vocab, { label: COMMENT_LABEL, id: commentId }, text, provenance);
	return commentId;
}

/** Writes a W3C Web Annotation anchored in (label, id): the anchor passage (oa:hasTarget), the note and, for a linking
 *  annotation, each further anchored passage the note cross-references (oa:hasBody linksTo). The quote carries optional
 *  prefix and suffix context so the annotated passage resolves to one occurrence. Every annotate variant calls it. */
export async function writeAnnotation(
	store: TReadingStore,
	vocab: TLinkVocabulary,
	written: { author: string; step: string },
	a: { label: string; id: string; exact: string; prefix?: string; suffix?: string; text: string; at?: string; until?: string; links?: TQuoteAnchor[] },
): Promise<{ commentId: string; specificResourceId: string; linkedSpecificResourceIds?: string[] }> {
	// `at` and `until` bound the period the note describes, such as a milestone's week. They are stored as
	// startedAtTime and endedAtTime so time-placed views such as gantt show the note over its period. `generatedAtTime`
	// holds the time the record was written. The two are different facts.
	// The anchored passage is titled by the note's text, by the same rule that titles a Comment. Every view then shows
	// the anchor as the note's statement and not as the bare quote.
	const { specificResourceId } = await anchorPart(store, a, a, { label: commentName(a.text) });
	const linkedSpecificResourceIds: string[] = [];
	for (const link of a.links === undefined ? [] : a.links) linkedSpecificResourceIds.push((await anchorPart(store, a, link)).specificResourceId);
	const reference = (id: string) => referenceTo(SPECIFIC_RESOURCE_LABEL, id);
	const links = linkedSpecificResourceIds.length === 0 ? {} : { [LinkRelations.LINKS_TO.rel]: linkedSpecificResourceIds.map(reference) };
	const edges = { [LinkRelations.TARGET.rel]: reference(specificResourceId), ...links };
	const commentId = await createComment(store, vocab, written, a.text, { start: a.at, end: a.until, edges });
	await assertCommentGrounded(store, commentId);
	return { commentId, specificResourceId, ...(linkedSpecificResourceIds.length > 0 ? { linkedSpecificResourceIds } : {}) };
}
