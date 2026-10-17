/**
 * ResourcesStepper implements generic graph-resource steps.
 *
 * It implements `comment on …` and the `annotate …` steps over any graph resource, and the `get annotations for …` read.
 * The `annotate …` steps quote a passage, link one passage to another, or anchor a passage with its surrounding context.
 * records/pipelines/discourse-writes.ts implements the writes (createComment, writeAnnotation), so other callers reuse them with any store.
 *
 * It also implements the reads of what a text states. It reads a feature's prose as facts, checks that every cited
 * passage still resolves, and reads the statements made with a predicate.
 */
import { z } from "zod";
import { AStepper, IHasCycles, TStepperSteps, IStepperCycles, type TBeforeStep } from "../lib/steps/domains/stepper.js";
import { actionNotOK, actionOKWithProducts } from "../lib/util/index.js";
import { requirePrincipal } from "../lib/principal.js";
import {
	COMMENT_LABEL,
	SEQ_PATH_LABEL,
	DOMAIN_PERSISTED_TYPE,
	LinkRelations,
	SPECIFIC_RESOURCE_LABEL,
	TEXT_QUOTE_SELECTOR_LABEL,
	ANNOTATION_PLACEMENT_DOMAIN,
	ANNOTATION_NOTE_DOMAIN,
	type TAnnotationPlacement,
	type TAnnotationNote,
	annotationNoteDomainDefinition,
	bodyDomainDefinition,
	commentDomainDefinition,
	readingDomainDefinition,
	principalDomainDefinition,
	sceneDomainDefinition,
	specificResourceDomainDefinition,
	textQuoteSelectorDomainDefinition,
	fragmentSelectorDomainDefinition,
	annotationPlacementDomainDefinition,
	writeEdge,
	conversationRoot,
	assertCommentGrounded,
	QuoteAnchorSchema,
	AnnotationListSchema,
	type TQuoteAnchor,
	Access,
} from "../lib/resources.js";
import { MEDIA_TYPE } from "../lib/media-types.js";
import { bodiesByMediaType, markdownOf, readEvery, recordOf } from "../lib/records/pipelines/record-reads.js";
import { createComment, readProseLinks, writeAnnotation } from "../lib/records/pipelines/discourse-writes.js";
import { DOMAIN_LINK_REL, DOMAIN_RECORD_ID, DOMAIN_TEXT, linkVocabularyFor } from "../lib/domains.js";
import { executionOf, formatRecordName, formatSeqPath } from "../lib/actuality/domains/seq-path.js";
import { logMessageDomainDefinition } from "../lib/log-message.js";
import { runArtifactDomainDefinition } from "../lib/run-artifact.js";
import { statementsWith, type TStatementRow } from "../lib/steps/pipelines/statements.js";

/** Describes an anchored passage for a message: the quote, and the recorded words before and after it. */
function describeAnchor(selector: TQuoteAnchor): string {
	const between = [selector.prefix ? `after "${selector.prefix}"` : "", selector.suffix ? `before "${selector.suffix}"` : ""].filter(Boolean).join(" and ");
	return between ? `"${selector.exact}" ${between}` : `"${selector.exact}"`;
}

/**
 * Returns whether an anchored passage still resolves in a text. The passage resolves where one occurrence of the quote
 * has the anchor's recorded prefix before it and its recorded suffix after it. An anchor without a prefix or a suffix
 * doesn't constrain that side. A check of the quote alone would pass a citation whose clause moved. A clause number can
 * remain in the text after the clause it opened is gone.
 */
function anchorResolves(text: string, selector: TQuoteAnchor): boolean {
	for (let at = text.indexOf(selector.exact); at !== -1; at = text.indexOf(selector.exact, at + 1)) {
		const before = selector.prefix === undefined || text.slice(Math.max(0, at - selector.prefix.length), at) === selector.prefix;
		const after = selector.suffix === undefined || text.slice(at + selector.exact.length, at + selector.exact.length + selector.suffix.length) === selector.suffix;
		if (before && after) return true;
	}
	return false;
}

const ReferenceSchema = z.object({ "@id": z.string(), "@type": z.string() });
const StatementsSchema = z.object({
	statements: z.array(
		z.object({
			"@type": z.literal("rdf:Statement"),
			subject: ReferenceSchema,
			predicate: z.string(),
			object: ReferenceSchema,
			reading: ReferenceSchema.optional(),
			assertedBy: ReferenceSchema.optional(),
			outcome: z.string().optional(),
		}),
	),
	total: z.number(),
});
/** Product domains of this stepper's steps. */
const DOMAIN_CITATIONS_CHECKED = "citations-checked";
const DOMAIN_STATEMENTS = "statements";
const DOMAIN_COMMENT_CREATED = "comment-created";
const DOMAIN_ANNOTATION_CREATED = "annotation-created";
const DOMAIN_ANNOTATIONS = "annotations";
const CitationsCheckedSchema = z.object({ checked: z.number() });
const CommentCreatedSchema = z.object({ commentId: z.string(), contextRoot: z.string() });
const AnnotationCreatedSchema = z.object({
	commentId: z.string(),
	specificResourceId: z.string(),
	linkedSpecificResourceIds: z.array(z.string()).optional(),
	contextRoot: z.string(),
});

const cycles = (stepper: ResourcesStepper): IStepperCycles => ({
	beforeStep: (beforeStep) => stepper.readFeatureProse(beforeStep),
	getConcerns: () => ({
		domains: [
			bodyDomainDefinition,
			commentDomainDefinition,
			{ selectors: [DOMAIN_CITATIONS_CHECKED], schema: CitationsCheckedSchema, description: "How many citations a check read" },
			{ selectors: [DOMAIN_STATEMENTS], schema: StatementsSchema, description: "The statements made with a predicate" },
			{ selectors: [DOMAIN_COMMENT_CREATED], schema: CommentCreatedSchema, description: "A comment a step wrote" },
			{ selectors: [DOMAIN_ANNOTATION_CREATED], schema: AnnotationCreatedSchema, description: "An annotation a step anchored in a record" },
			{ selectors: [DOMAIN_ANNOTATIONS], schema: AnnotationListSchema, description: "The annotations anchored in a record" },
			readingDomainDefinition,
			principalDomainDefinition,
			sceneDomainDefinition,
			logMessageDomainDefinition,
			runArtifactDomainDefinition,
			specificResourceDomainDefinition,
			textQuoteSelectorDomainDefinition,
			fragmentSelectorDomainDefinition,
			annotationPlacementDomainDefinition,
			annotationNoteDomainDefinition,
		],
	}),
});

class ResourcesStepper extends AStepper implements IHasCycles {
	description = "Graph-resource steps: comment on vertices, annotate passages, get annotations, check citations and read statements";

	cycles = cycles(this);

	/** Returns the link vocabulary of the registered domains. A note's links are read with it, so a note can use a consumer's vocabulary. */
	private get linkVocabulary() {
		return linkVocabularyFor(this.getWorld().domains);
	}

	/**
	 * Reads a feature's prose as a text. Its links become facts about the prose step. The document and monitor views show
	 * that step's SeqPath record, so a second record isn't written for the feature. The record id is the step's position,
	 * so running the step again restates its facts instead of adding more. The step's status states how it ended.
	 */
	async readFeatureProse({ featureStep }: TBeforeStep): Promise<void> {
		if (!featureStep.action.step.prose) return;
		const text = featureStep.in;
		// The prose step's record id: its path under its execution.
		const named = formatRecordName({ execution: executionOf(this.getWorld().tag), path: featureStep.seqPath });
		await readProseLinks(this.getWorld().shared.getStore(), this.linkVocabulary, { label: SEQ_PATH_LABEL, id: named }, text, formatSeqPath(featureStep.seqPath));
	}

	/** Writes the annotation of every `annotate` step, resolves its conversation root, and returns both. Each step only
	 *  shapes the passage and link argument. The principal, store and threading are the same for each step. */
	private async runAnnotate(a: Parameters<typeof writeAnnotation>[3]) {
		const store = this.getWorld().shared.getStore();
		const written = await writeAnnotation(store, this.linkVocabulary, requirePrincipal(this.getWorld()), a);
		const contextRoot = await conversationRoot(store, a.id);
		return actionOKWithProducts({ ...written, contextRoot });
	}

	steps = {
		checkCitations: {
			// Re-anchors every stored anchored passage against the current text of its source. A quote that doesn't match the
			// current text makes the statements about it stale. The step fails and lists each passage that doesn't resolve.
			gwta: `check citations resolve`,
			productsDomain: DOMAIN_CITATIONS_CHECKED,
			action: async () => {
				const store = this.getWorld().shared.getStore();
				const unresolved: string[] = [];
				let checked = 0;
				for (const anchor of await readEvery(store, { label: SPECIFIC_RESOURCE_LABEL })) {
					const quads = await store.query({ subject: String(anchor.id) });
					const sourceQuad = quads.find((q) => q.predicate === LinkRelations.HAS_SOURCE.rel);
					const selectorId = quads.find((q) => q.predicate === LinkRelations.HAS_SELECTOR.rel)?.object;
					if (!sourceQuad || !selectorId) continue;
					const held = await recordOf(store, TEXT_QUOTE_SELECTOR_LABEL, String(selectorId));
					if (!held) continue;
					const selector = QuoteAnchorSchema.parse(held);
					checked++;
					const sourceLabel = (sourceQuad as { objectType?: string }).objectType;
					if (!sourceLabel) return actionNotOK(`anchor ${anchor.id}: its hasSource edge doesn't name a type for "${String(sourceQuad.object)}"`);
					const sourceId = String(sourceQuad.object);
					const text = await markdownOf(store, sourceLabel, sourceId);
					const said = describeAnchor(selector);
					if (text === undefined) unresolved.push(`${sourceLabel} "${sourceId}" doesn't hold text to anchor ${said} (anchor ${anchor.id})`);
					else if (!anchorResolves(text, selector)) unresolved.push(`${sourceLabel} "${sourceId}" no longer states ${said} (anchor ${anchor.id})`);
				}
				if (unresolved.length > 0) return actionNotOK(`${unresolved.length} of ${checked} citations no longer resolve:\n${unresolved.join("\n")}`);
				return actionOKWithProducts({ checked });
			},
		},
		statements: {
			// Reads every statement made with a predicate, with the source of each. A coverage table is this read with the
			// citation predicate. It lists the requirements actuality evidenced and the outcome of each, without a separate
			// report.
			gwta: `statements with {rel: ${DOMAIN_LINK_REL}}`,
			productsDomain: DOMAIN_STATEMENTS,
			action: async ({ rel }: { rel: string }) => {
				const statements = (await statementsWith(this.getWorld().shared.getStore(), rel)) as TStatementRow[];
				return actionOKWithProducts({ statements, total: statements.length });
			},
		},
		comment: {
			gwta: `comment on {label: ${DOMAIN_PERSISTED_TYPE}} {id: ${DOMAIN_RECORD_ID}} with {text: ${DOMAIN_TEXT}}`,
			recordIds: { id: "label" },
			productsDomain: DOMAIN_COMMENT_CREATED,
			action: async ({ label, id, text }: { label: string; id: string; text: string }) => {
				const author = requirePrincipal(this.getWorld());
				const store = this.getWorld().shared.getStore();
				const commentId = await createComment(store, this.linkVocabulary, author, text, new Date().toISOString());
				// Writes the comment's narrate edge to its subject. narrate is a sub-property of inReplyTo, so the edge grounds the comment and threads it.
				await writeEdge(store, COMMENT_LABEL, commentId, LinkRelations.NARRATE.rel, label, id);
				await assertCommentGrounded(store, commentId);
				const contextRoot = await conversationRoot(store, id);
				return actionOKWithProducts({ commentId, contextRoot });
			},
		},
		annotate: {
			gwta: `annotate {label: ${DOMAIN_PERSISTED_TYPE}} {id: ${DOMAIN_RECORD_ID}} quoting {exact: ${DOMAIN_TEXT}} with {text: ${DOMAIN_TEXT}}`,
			recordIds: { id: "label" },
			productsDomain: DOMAIN_ANNOTATION_CREATED,
			// The gwta binds label, id, exact and text. UI authoring calls this action over RPC with optional link passages
			// and with a prefix and a suffix from the selection's context. The prefix and suffix resolve the anchor to one
			// occurrence.
			action: async (p: { label: string; id: string; exact: string; text: string; prefix?: string; suffix?: string; links?: Array<TQuoteAnchor> }) => this.runAnnotate(p),
		},
		annotateLinking: {
			// `linking` follows the id directly, so the `annotate … quoting …` gwta doesn't match this line and the two
			// steps stay unambiguous.
			gwta: `annotate {label: ${DOMAIN_PERSISTED_TYPE}} {id: ${DOMAIN_RECORD_ID}} linking {exact: ${DOMAIN_TEXT}} to {linkExact: ${DOMAIN_TEXT}} with {text: ${DOMAIN_TEXT}}`,
			recordIds: { id: "label" },
			productsDomain: DOMAIN_ANNOTATION_CREATED,
			action: async ({ label, id, exact, linkExact, text }: { label: string; id: string; exact: string; linkExact: string; text: string }) =>
				this.runAnnotate({ label, id, exact, text, links: [{ exact: linkExact }] }),
		},
		annotateAnchored: {
			// {context} holds the quote's surrounding text, and {placement} states its side. "preceded by" makes the context
			// the TextQuoteSelector prefix, and "followed by" makes it the suffix, so a short or repeated quote resolves to the
			// intended occurrence. `anchoring` follows the id directly, so the annotate gwtas stay unambiguous.
			gwta: `annotate {label: ${DOMAIN_PERSISTED_TYPE}} {id: ${DOMAIN_RECORD_ID}} anchoring {exact: ${DOMAIN_TEXT}} {placement: ${ANNOTATION_PLACEMENT_DOMAIN}} {context: ${DOMAIN_TEXT}} with {text: ${DOMAIN_TEXT}}`,
			recordIds: { id: "label" },
			productsDomain: DOMAIN_ANNOTATION_CREATED,
			action: async ({
				label,
				id,
				exact,
				placement,
				context,
				text,
			}: {
				label: string;
				id: string;
				exact: string;
				placement: TAnnotationPlacement;
				context: string;
				text: string;
			}) => this.runAnnotate({ label, id, exact, ...(placement === "preceded by" ? { prefix: context } : { suffix: context }), text }),
		},
		annotateNote: {
			// Takes the passage, note, time and cross-reference links in one value. It writes notes the prose forms can't
			// express, such as a dated milestone that links other clauses. `at` dates the note at the time it describes, so
			// time-placed views (gantt) show it at that time. Each link renders as a cross-reference a reader can follow in the document.
			gwta: `annotate note {data: ${ANNOTATION_NOTE_DOMAIN}}`,
			productsDomain: DOMAIN_ANNOTATION_CREATED,
			action: async ({ data }: { data: TAnnotationNote }) => this.runAnnotate(data),
		},
		annotations: {
			read: true,
			readsAt: Access.public,
			gwta: `get annotations for {label: ${DOMAIN_PERSISTED_TYPE}} {id: ${DOMAIN_RECORD_ID}}`,
			recordIds: { id: "label" },
			productsDomain: DOMAIN_ANNOTATIONS,
			action: async ({ id }: { label: string; id: string }) => {
				const store = this.getWorld().shared.getStore();
				// Walks the W3C Web Annotation chain backward from the annotated individual with bulk reads scoped by label,
				// then joins the results in memory. An unscoped or per-note quad query on a property-graph store reloads every
				// type and every body, including this document's own, so a per-note walk takes note count × document size.
				// This walk takes eight scoped reads: five of the chain, the matched comments by id, and their bodies' edges and bodies.
				// SpecificResource: hasSource → id, hasSelector → TextQuoteSelector.
				// Comment: hasTarget → SpecificResource, and optionally linksTo → another SpecificResource.
				const srIds = new Set((await store.query({ predicate: LinkRelations.HAS_SOURCE.rel, object: id, namedGraph: SPECIFIC_RESOURCE_LABEL })).map((q) => String(q.subject)));
				if (srIds.size === 0) return actionOKWithProducts({ annotations: [], total: 0 });
				const selectorOfSr = new Map<string, string>();
				for (const q of await store.query({ predicate: LinkRelations.HAS_SELECTOR.rel, namedGraph: SPECIFIC_RESOURCE_LABEL }))
					selectorOfSr.set(String(q.subject), String(q.object));
				const linkQuads = await store.query({ predicate: LinkRelations.LINKS_TO.rel, namedGraph: COMMENT_LABEL });
				const linkSrsOfComment = new Map([...Map.groupBy(linkQuads, (q) => String(q.subject))].map(([comment, held]) => [comment, held.map((q) => String(q.object))]));
				const selectorById = new Map<string, Record<string, unknown>>();
				for (const s of await readEvery(store, { label: TEXT_QUOTE_SELECTOR_LABEL })) selectorById.set(String(s.id), s);
				const quoteOf = (srId: string | undefined): TQuoteAnchor | undefined => {
					const selectorId = srId ? selectorOfSr.get(srId) : undefined;
					const sel = selectorId === undefined ? undefined : selectorById.get(selectorId);
					if (!sel) return undefined;
					return {
						exact: String(sel.exact),
						...(sel.prefix !== undefined ? { prefix: String(sel.prefix) } : {}),
						...(sel.suffix !== undefined ? { suffix: String(sel.suffix) } : {}),
					};
				};
				const anchored = (await store.query({ predicate: LinkRelations.TARGET.rel, namedGraph: COMMENT_LABEL })).flatMap((tq) => {
					const specificResourceId = String(tq.object);
					// A target without a selector doesn't anchor a passage.
					const quote = srIds.has(specificResourceId) ? quoteOf(specificResourceId) : undefined;
					return quote ? [{ commentId: String(tq.subject), specificResourceId, quote }] : [];
				});
				if (anchored.length === 0) return actionOKWithProducts({ annotations: [], total: 0 });
				const commentIds = [...new Set(anchored.map(({ commentId }) => commentId))];
				const [comments, noteTexts] = await Promise.all([
					readEvery(store, { label: COMMENT_LABEL, named: commentIds }),
					bodiesByMediaType(store, COMMENT_LABEL, commentIds, MEDIA_TYPE.markdown),
				]);
				const commentById = new Map(comments.map((comment) => [String(comment.id), comment]));
				const annotations = anchored.flatMap(({ commentId, specificResourceId, quote }) => {
					const comment = commentById.get(commentId);
					if (!comment) return [];
					const noteText = noteTexts.get(commentId);
					const links = (linkSrsOfComment.get(commentId) ?? []).map((srId) => quoteOf(srId)).filter((l): l is NonNullable<typeof l> => l !== undefined);
					return [
						{
							commentId,
							...(comment.author !== undefined ? { author: String(comment.author) } : {}),
							...(comment.generatedAtTime !== undefined ? { generatedAtTime: String(comment.generatedAtTime) } : {}),
							...(comment.startedAtTime !== undefined ? { startedAtTime: String(comment.startedAtTime) } : {}),
							...(comment.endedAtTime !== undefined ? { endedAtTime: String(comment.endedAtTime) } : {}),
							...(noteText !== undefined ? { body: noteText } : {}),
							...quote,
							specificResourceId,
							...(links.length > 0 ? { links } : {}),
						},
					];
				});
				return actionOKWithProducts({ annotations, total: annotations.length });
			},
		},
	} as const satisfies TStepperSteps;

	constructor() {
		super();
	}
}

export default ResourcesStepper;
