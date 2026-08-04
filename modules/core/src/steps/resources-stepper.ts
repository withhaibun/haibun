/**
 * ResourcesStepper — generic graph-resource steps.
 *
 * Owns the discourse acts over any graph resource: `comment on …`, the `annotate …` family (quoting a passage, linking
 * one passage to another, or anchoring with surrounding context), the `get annotations for …` read, and `get related for …`.
 * The write logic lives in resources.ts (createComment / writeAnnotation) so it is reusable and store-agnostic.
 *
 * It also owns what a TEXT states: reading a feature's own prose as facts, checking that every cited passage still
 * resolves, and reading the statements made with a predicate.
 */
import { z } from "zod";
import { AStepper, IHasCycles, TStepperSteps, IStepperCycles, type TBeforeStep } from "../lib/astepper.js";
import { type TIndividualResult } from "../lib/execution.js";
import { actionNotOK, actionOKWithProducts } from "../lib/util/index.js";
import { requirePrincipal } from "../lib/principal.js";
import {
	COMMENT_LABEL,
	SEQ_PATH_LABEL,
	DOMAIN_PERSISTED_TYPE,
	LinkRelations,
	isReplyEdge,
	SPECIFIC_RESOURCE_LABEL,
	TEXT_QUOTE_SELECTOR_LABEL,
	ANNOTATION_PLACEMENT_DOMAIN,
	ANNOTATION_NOTE_DOMAIN,
	type TAnnotationPlacement,
	type TAnnotationNote,
	annotationNoteDomainDefinition,
	bodyDomainDefinition,
	bodyByMediaType,
	commentDomainDefinition,
	readingDomainDefinition,
	readTypedLinks,
	markdownOf,
	principalDomainDefinition,
	sceneDomainDefinition,
	specificResourceDomainDefinition,
	textQuoteSelectorDomainDefinition,
	annotationPlacementDomainDefinition,
	createComment,
	writeAnnotation,
	writeEdge,
	conversationRoot,
	assertCommentGrounded,
} from "../lib/resources.js";
import { linkVocabularyFor } from "../lib/domains.js";
import { formatSeqPath, seqPathDomainDefinition } from "../lib/seq-path.js";
import { statementsWith, type TStatementRow } from "../lib/statements.js";
import { typedLinkFacts } from "../lib/typed-links.js";

/** The base prose step: a line of a feature that is not a step. Its text is the feature's own words, so it is where a feature states what it refers to. */
const PROSE_ACTION = "Haibun.prose";

/** An anchored passage as a reader would say it: the quote, and the words it sits between where they were recorded. */
function describeAnchor(selector: { exact: string; prefix?: string; suffix?: string }): string {
	const between = [selector.prefix ? `after "${selector.prefix}"` : "", selector.suffix ? `before "${selector.suffix}"` : ""].filter(Boolean).join(" and ");
	return between ? `"${selector.exact}" ${between}` : `"${selector.exact}"`;
}

/**
 * Whether an anchored passage still resolves in a text: the quote occurs, and where the anchor recorded the words
 * around it, an occurrence exists with those words still around it. Checking the quote alone would pass a citation
 * whose clause moved out from under it: the number is still there, the clause it opened is not.
 */
function anchorResolves(text: string, selector: { exact: string; prefix?: string; suffix?: string }): boolean {
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
const CitationsCheckedSchema = z.object({ checked: z.number() });
const CommentCreatedSchema = z.object({ commentId: z.string(), contextRoot: z.string() });
const AnnotationCreatedSchema = z.object({
	commentId: z.string(),
	specificResourceId: z.string(),
	linkedSpecificResourceIds: z.array(z.string()).optional(),
	contextRoot: z.string(),
});
const RelatedItemsSchema = z.object({ items: z.array(z.unknown()), contextRoot: z.string() });
const QuoteSchema = z.object({ exact: z.string(), prefix: z.string().optional(), suffix: z.string().optional() });
const AnnotationListSchema = z.object({
	annotations: z.array(
		z.object({
			commentId: z.string(),
			author: z.string().optional(),
			generatedAtTime: z.string().optional(),
			startedAtTime: z.string().optional(),
			endedAtTime: z.string().optional(),
			body: z.string().optional(),
			exact: z.string(),
			prefix: z.string().optional(),
			suffix: z.string().optional(),
			specificResourceId: z.string(),
			// A linking annotation's cross-references: the quotes locating the sections this note points at, so a reader can jump to each.
			links: z.array(QuoteSchema).optional(),
		}),
	),
	total: z.number(),
});

const cycles = (stepper: ResourcesStepper): IStepperCycles => ({
	beforeStep: (beforeStep) => stepper.readFeatureProse(beforeStep),
	getConcerns: () => ({
		domains: [
			bodyDomainDefinition,
			commentDomainDefinition,
			readingDomainDefinition,
			principalDomainDefinition,
			sceneDomainDefinition,
			seqPathDomainDefinition,
			specificResourceDomainDefinition,
			textQuoteSelectorDomainDefinition,
			annotationPlacementDomainDefinition,
			annotationNoteDomainDefinition,
		],
	}),
});

class ResourcesStepper extends AStepper implements IHasCycles {
	description = "Graph-resource steps: comment on vertices, annotate passages, get related, and get annotations";

	cycles = cycles(this);

	/** The declared ontology a note's own links are read against: the registered domains, so a consumer's vocabulary is usable in a note. */
	private get linkVocabulary() {
		return linkVocabularyFor(this.getWorld().domains);
	}

	/**
	 * A feature's prose is a text like any other: its links are facts about the step that spoke them. That step is already
	 * a record (its SeqPath, what the document and monitor views show), so no second record is made for the feature. The
	 * id is the step's position, so re-running restates rather than accumulates, and the step's status says how it ended.
	 */
	async readFeatureProse({ featureStep }: TBeforeStep): Promise<void> {
		if (`${featureStep.action.stepperName}.${featureStep.action.actionName}` !== PROSE_ACTION) return;
		const text = featureStep.in;
		const vocab = this.linkVocabulary;
		// Prose that states nothing changes nothing; the facts parsed here are the reading's, so the text parses once.
		const facts = typedLinkFacts(text, vocab);
		if (facts.length === 0) return;
		const seqPath = formatSeqPath(featureStep.seqPath);
		await readTypedLinks(this.getWorld().shared.getStore(), vocab, { label: SEQ_PATH_LABEL, id: seqPath }, text, { seqPath, facts });
	}

	/** The shared tail of every `annotate` variant: write the annotation, resolve its conversation root, return both.
	 *  Each variant only shapes the passage/link arg; the principal, store, and threading are identical. */
	private async runAnnotate(a: Parameters<typeof writeAnnotation>[3]) {
		const store = this.getWorld().shared.getStore();
		const written = await writeAnnotation(store, this.linkVocabulary, requirePrincipal(this.getWorld()), a);
		const contextRoot = await conversationRoot(store, a.id);
		return actionOKWithProducts({ ...written, contextRoot });
	}

	steps = {
		checkCitations: {
			// Every anchored passage a reading wrote, re-anchored against what its source says NOW. A quote that no longer
			// matches means the text moved on and the statements about it are stale, which is a failure to say, not to hide.
			gwta: `check citations resolve`,
			productsSchema: CitationsCheckedSchema,
			action: async () => {
				const store = this.getWorld().shared.getStore();
				const unresolved: string[] = [];
				let checked = 0;
				for (const anchor of await store.queryIndividuals<{ id: string }>(SPECIFIC_RESOURCE_LABEL)) {
					const quads = await store.query({ subject: anchor.id });
					const sourceQuad = quads.find((q) => q.predicate === LinkRelations.HAS_SOURCE.rel);
					const selectorId = quads.find((q) => q.predicate === LinkRelations.HAS_SELECTOR.rel)?.object;
					if (!sourceQuad || !selectorId) continue;
					const selector = await store.getIndividual<{ exact: string; prefix?: string; suffix?: string }>(TEXT_QUOTE_SELECTOR_LABEL, String(selectorId));
					if (!selector) continue;
					checked++;
					const sourceLabel = (sourceQuad as { objectType?: string }).objectType;
					if (!sourceLabel) throw new Error(`anchor ${anchor.id}: its hasSource edge names no type for "${String(sourceQuad.object)}"`);
					const sourceId = String(sourceQuad.object);
					const text = await markdownOf(store, sourceLabel, sourceId);
					const said = describeAnchor(selector);
					if (text === undefined) unresolved.push(`${sourceLabel} "${sourceId}" holds no text to anchor ${said} in (anchor ${anchor.id})`);
					else if (!anchorResolves(text, selector)) unresolved.push(`${sourceLabel} "${sourceId}" no longer says ${said} (anchor ${anchor.id})`);
				}
				if (unresolved.length > 0) return actionNotOK(`${unresolved.length} of ${checked} citations no longer resolve:\n${unresolved.join("\n")}`);
				return actionOKWithProducts({ checked });
			},
		},
		statements: {
			// The general read: every statement made with a predicate, and where each came from. A coverage table (which
			// requirements a run evidenced, and how it ended) is this read with the citation predicate, not a report of its own.
			gwta: `statements with {rel: string}`,
			productsSchema: StatementsSchema,
			action: async ({ rel }: { rel: string }) => {
				const statements = (await statementsWith(this.getWorld().shared.getStore(), rel)) as TStatementRow[];
				return actionOKWithProducts({ statements, total: statements.length });
			},
		},
		comment: {
			gwta: `comment on {label: ${DOMAIN_PERSISTED_TYPE}} {id: string} with {text: string}`,
			productsSchema: CommentCreatedSchema,
			action: async ({ label, id, text }: { label: string; id: string; text: string }) => {
				const author = requirePrincipal(this.getWorld());
				const store = this.getWorld().shared.getStore();
				const commentId = await createComment(store, this.linkVocabulary, author, text, new Date().toISOString());
				// The comment narrates what it is about (narrate is a sub-property of inReplyTo, so it both grounds and threads it).
				await writeEdge(store, COMMENT_LABEL, commentId, LinkRelations.NARRATE.rel, label, id);
				await assertCommentGrounded(store, commentId);
				const contextRoot = await conversationRoot(store, id);
				return actionOKWithProducts({ commentId, contextRoot });
			},
		},
		annotate: {
			gwta: `annotate {label: ${DOMAIN_PERSISTED_TYPE}} {id: string} quoting {exact: string} with {text: string}`,
			productsSchema: AnnotationCreatedSchema,
			// The prose gwta binds label/id/exact/text; UI authoring calls this same action over RPC with the extra
			// prefix/suffix (the selection's context, for a reliable anchor) and an optional link passage.
			action: async (p: {
				label: string;
				id: string;
				exact: string;
				text: string;
				prefix?: string;
				suffix?: string;
				links?: Array<{ exact: string; prefix?: string; suffix?: string }>;
			}) => this.runAnnotate(p),
		},
		annotateLinking: {
			// `linking` sits right after the id (before `quoting`) so the plain `annotate … quoting …` gwta cannot also
			// match this prose — the two steps stay unambiguous.
			gwta: `annotate {label: ${DOMAIN_PERSISTED_TYPE}} {id: string} linking {exact: string} to {linkExact: string} with {text: string}`,
			productsSchema: AnnotationCreatedSchema,
			action: async ({ label, id, exact, linkExact, text }: { label: string; id: string; exact: string; linkExact: string; text: string }) =>
				this.runAnnotate({ label, id, exact, text, links: [{ exact: linkExact }] }),
		},
		annotateAnchored: {
			// The quote's surrounding text as one TextQuoteSelector context, its side given by {placement}: "preceded by"
			// makes the context the prefix, "followed by" makes it the suffix — so a short or repeated quote resolves to the
			// intended occurrence. `anchoring` sits right after the id (a distinct keyword from `quoting`/`linking`) to keep
			// the three annotate prose forms unambiguous.
			gwta: `annotate {label: ${DOMAIN_PERSISTED_TYPE}} {id: string} anchoring {exact: string} {placement: ${ANNOTATION_PLACEMENT_DOMAIN}} {context: string} with {text: string}`,
			productsSchema: AnnotationCreatedSchema,
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
			// The composite form: passage, note, meaningful time, and cross-reference links in one value — for notes the
			// prose forms cannot express (a dated milestone that also links the other clauses it touches). `at` dates the
			// note at the time it is ABOUT, so time-placed views (gantt) show it there; each link renders as a followable
			// cross-reference in the document.
			gwta: `annotate note {data: ${ANNOTATION_NOTE_DOMAIN}}`,
			productsSchema: AnnotationCreatedSchema,
			action: async ({ data }: { data: TAnnotationNote }) => this.runAnnotate(data),
		},
		annotations: {
			gwta: `get annotations for {label: ${DOMAIN_PERSISTED_TYPE}} {id: string}`,
			productsSchema: AnnotationListSchema,
			action: async ({ id }: { label: string; id: string }) => {
				const store = this.getWorld().shared.getStore();
				// Reverse-walk the W3C Web Annotation chain from the annotated individual with LABEL-SCOPED bulk reads, then
				// join them in memory. An unscoped or per-note quad query on a property-graph store reloads every type and
				// every body — including this document's own — so the naive walk costs note-count × document-size; this is a
				// fixed handful of scoped reads instead. SpecificResource —hasSource→ id, —hasSelector→ TextQuoteSelector;
				// Comment —hasTarget→ SpecificResource, optionally —linksTo→ another SpecificResource.
				const srIds = new Set((await store.query({ predicate: LinkRelations.HAS_SOURCE.rel, object: id, namedGraph: SPECIFIC_RESOURCE_LABEL })).map((q) => String(q.subject)));
				if (srIds.size === 0) return actionOKWithProducts({ annotations: [], total: 0 });
				const selectorOfSr = new Map<string, string>();
				for (const q of await store.query({ predicate: LinkRelations.HAS_SELECTOR.rel, namedGraph: SPECIFIC_RESOURCE_LABEL }))
					selectorOfSr.set(String(q.subject), String(q.object));
				const linkSrsOfComment = new Map<string, string[]>();
				for (const q of await store.query({ predicate: LinkRelations.LINKS_TO.rel, namedGraph: COMMENT_LABEL })) {
					const list = linkSrsOfComment.get(String(q.subject)) ?? [];
					list.push(String(q.object));
					linkSrsOfComment.set(String(q.subject), list);
				}
				const selectorById = new Map<string, Record<string, unknown>>();
				for (const s of (await store.queryIndividuals(TEXT_QUOTE_SELECTOR_LABEL)) as Array<Record<string, unknown>>) selectorById.set(String(s.id), s);
				const quoteOf = (srId: string | undefined): { exact: string; prefix?: string; suffix?: string } | undefined => {
					const sel = srId ? selectorById.get(selectorOfSr.get(srId) ?? "") : undefined;
					if (!sel) return undefined;
					return {
						exact: String(sel.exact),
						...(sel.prefix !== undefined ? { prefix: String(sel.prefix) } : {}),
						...(sel.suffix !== undefined ? { suffix: String(sel.suffix) } : {}),
					};
				};
				const annotations: Array<Record<string, unknown>> = [];
				for (const tq of await store.query({ predicate: LinkRelations.TARGET.rel, namedGraph: COMMENT_LABEL })) {
					const specificResourceId = String(tq.object);
					if (!srIds.has(specificResourceId)) continue;
					const quote = quoteOf(specificResourceId);
					if (!quote) continue; // a target without a selector anchors nothing
					const commentId = String(tq.subject);
					const comment = (await store.getIndividual(COMMENT_LABEL, commentId)) as Record<string, unknown> | null;
					if (!comment) continue;
					const noteText = await bodyByMediaType(store, comment, "text/markdown");
					const links = (linkSrsOfComment.get(commentId) ?? []).map((srId) => quoteOf(srId)).filter((l): l is NonNullable<typeof l> => l !== undefined);
					annotations.push({
						commentId,
						...(comment.author !== undefined ? { author: String(comment.author) } : {}),
						...(comment.generatedAtTime !== undefined ? { generatedAtTime: String(comment.generatedAtTime) } : {}),
						...(comment.startedAtTime !== undefined ? { startedAtTime: String(comment.startedAtTime) } : {}),
						...(comment.endedAtTime !== undefined ? { endedAtTime: String(comment.endedAtTime) } : {}),
						...(noteText !== undefined ? { body: noteText } : {}),
						...quote,
						specificResourceId,
						...(links.length > 0 ? { links } : {}),
					});
				}
				return actionOKWithProducts({ annotations, total: annotations.length });
			},
		},
		getRelated: {
			gwta: `get related for {label: ${DOMAIN_PERSISTED_TYPE}} {id: string}`,
			productsSchema: RelatedItemsSchema,
			action: async ({ label, id }: { label: string; id: string }) => {
				const store = this.getWorld().shared.getStore();
				// The thread is the conversation root plus every comment that replies (transitively) to a member.
				const contextRoot = await conversationRoot(store, id);
				const memberLabel = new Map<string, string>([[contextRoot, label]]);
				const frontier = [contextRoot];
				for (let guard = 0; frontier.length > 0 && guard < 10000; guard++) {
					const cur = frontier.shift() as string;
					const incoming = (await store.query({ object: cur })).filter((q) => isReplyEdge(q.predicate));
					for (const q of incoming) {
						if (!memberLabel.has(q.subject)) {
							memberLabel.set(q.subject, q.namedGraph);
							frontier.push(q.subject);
						}
					}
				}
				const items: TIndividualResult[] = [];
				for (const [vid, vlabel] of memberLabel) {
					const individual = (await store.getIndividual(vlabel, vid)) ?? (await store.getIndividual(COMMENT_LABEL, vid)) ?? (await store.getIndividual(label, vid));
					if (individual) {
						const outgoing = await store.query({ subject: vid });
						const edges = outgoing.filter((q) => !isReplyEdge(q.predicate)).map((q) => ({ type: q.predicate, targetId: String(q.object) }));
						items.push({ ...(individual as Record<string, unknown>), _edges: edges });
					}
				}
				items.sort((a, b) => {
					const dateA = String(a.generatedAtTime ?? a.dateSent ?? a.published ?? "");
					const dateB = String(b.generatedAtTime ?? b.dateSent ?? b.published ?? "");
					return dateA.localeCompare(dateB);
				});
				return actionOKWithProducts({ items, contextRoot });
			},
		},
	} satisfies TStepperSteps;

	constructor() {
		super();
	}
}

export default ResourcesStepper;
