/**
 * Typed markdown links: markdown links as data.
 *
 * A typed link's text ends with a colon and a rel. Only the link text before the colon renders:
 *
 *   [the specification](#File:docs/spec.pdf)                        untyped: the default `mentions`
 *   [the clause it exercises:citesAsEvidence](#File:docs/spec.pdf)  typed: link text renders, the rel is the fact
 *   [that clause:cites](#File:docs/spec.pdf:~:text=a%20quote)       typed, targeting a passage
 *   [the table:cites](#File:docs/spec.pdf:~:page=12)                 typed, targeting a page of the document
 *
 * Link text without the `:rel` form is read as prose and never as a rel.
 *
 * A fact's target is a record of a persisted type. Its href is `#Type:id`. A part may follow `:~:`. A W3C/WICG Text
 * Fragment directive names a passage. It is written `text=[prefix-,]exact[,-suffix]` and maps one-to-one to a Web
 * Annotation TextQuoteSelector. A media fragment names a part of the record's media as a Web Annotation
 * FragmentSelector does: `page=N` of a PDF (RFC 8118), `t=` of audio or video and `xywh=` of an image (Media
 * Fragments). A page anchor, a relative path, a web address or any other href doesn't state a fact.
 *
 * This module implements only the grammar. It reads text and returns facts. `readTypedLinks` in resources.ts writes the
 * facts and resolves each target against the store.
 */
import { z } from "zod";
import { itemAt } from "./util/item-at.js";
import MarkdownIt from "markdown-it";
import { LinkRelations, type TPart, type TQuoteAnchor, type TRelRange } from "./resources.js";
import { MEDIA_FRAGMENTS, isFragment, type TFragment } from "./media-fragments.js";

/**
 * What a reference denotes: one persisted individual or a type. Every surface that distinguishes the two uses these
 * words, so a link, a pane, a statement and an ask name the distinction the same way.
 */
export const DENOTES = { individual: "individual", type: "type" } as const;
/**
 * The same distinction in rendered documents. `<shu-ref kind>` holds it and the ref navigation reads it. Stored
 * documents already contain these words, so the words don't change. Each place that tests them reads them from here.
 */
export const REF_DENOTES = { individual: "entity", type: "domain" } as const;

export const DOMAIN_INDIVIDUAL_ADDRESS = "individual-address";

/** An individual's address: the type it is persisted as and its id. Every surface names an individual by this pair. A
 *  caller that holds the address reads the individual directly. */
export const IndividualAddressSchema = z.object({
	persistedAs: z.string().describe("The type the individual is persisted as."),
	id: z.string().describe("The individual's id within that type."),
});
export type TIndividualAddress = z.infer<typeof IndividualAddressSchema>;

/** An in-app reference to a type, an individual or a part of an individual. The SPA's renderer takes this shape. */
type TRefHref = { kind: typeof REF_DENOTES.type; target: { domain: string } } | { kind: typeof REF_DENOTES.individual; target: TIndividualAddress & { selector?: TPart } };

/** A statement's target: a typed individual, or a part of it where `anchor` is set. */
type TAddressableTarget = TIndividualAddress & { kind: typeof DENOTES.individual; anchor?: TPart };

/** What a link's href denotes. A type is a schema term and not an individual. A link to a type navigates and doesn't state a fact. */
type TLinkTarget = TAddressableTarget | { kind: typeof DENOTES.type; persistedAs: string };

/**
 * One fact that a link states about the text containing it. `typed` marks a typed link. `linkText` is the link text
 * before the colon. `readTypedLinks` writes it as the label of a typed link's anchor. For an untyped link,
 * `readTypedLinks` writes only the record-level edge and doesn't anchor the passage.
 */
export type TTypedLinkFact = { rel: string; typed?: true; linkText?: string; target: TAddressableTarget };

/**
 * The declared ontology as the grammar reads it: whether a name is a rel, the rel's range, and whether a name is a
 * persisted type. `linkVocabularyFromDomains` builds it from the registered domains. A consumer's own rels and types
 * work in links without this module naming them.
 */
export type TLinkVocabulary = { relRange(rel: string): TRelRange | undefined; isType(name: string): boolean };

/** What separates a reference to a record from the part of it the reference names. */
export const PART_DIRECTIVE = ":~:";
/** The key of a part that quotes a passage. */
const TEXT_KEY = "text";

const PART_KEYS = [TEXT_KEY, ...MEDIA_FRAGMENTS.map(({ key }) => key)].map((key) => `${key}=`).join(", ");

/** Returns the fragment a `key=value` directive names. Throws where the key isn't a media fragment key or the value
 *  doesn't match the key's form, so a reference never names a part it doesn't locate. */
function parseFragment(directive: string): TFragment {
	const at = directive.indexOf("=");
	const key = directive.slice(0, at);
	const spec = MEDIA_FRAGMENTS.find((fragment) => fragment.key === key);
	if (at < 0 || !spec) throw new Error(`"${PART_DIRECTIVE}${directive}" doesn't name a part of a record: a part is written as ${PART_KEYS}`);
	if (!spec.form.test(directive.slice(at + 1))) throw new Error(`"${directive}" isn't a ${key} fragment of ${spec.of}`);
	return { conformsTo: spec.conformsTo, value: directive };
}

/**
 * The typed form: link text, a colon, a rel. Whitespace on either side of the colon prevents a match, so prose link
 * text such as "Section 3: Overview" isn't read as typed. The link text is optional (`:cites`).
 */
const TYPED_TEXT = /^(?<linkText>\S(?:.*\S)?)?:(?<rel>[a-zA-Z][a-zA-Z0-9_]*)$/;

/** Decodes an href to the text the author wrote, because markdown-it percent-encodes link destinations. */
function decodeHref(href: string, context: string): string {
	try {
		return decodeURIComponent(href);
	} catch {
		throw new Error(`${context}: "${href}" isn't a valid link destination because its percent-encoding is malformed. Write a literal % as %25.`);
	}
}

/**
 * Parses a Text Fragment directive value (`[prefix-,]exact[,-suffix]`) into a quote anchor. The marker dashes are
 * literal in the raw directive, and an encoded %2D is text. Parts are therefore classified before decoding.
 * A range form (`start,end`) doesn't have a TextQuoteSelector equivalent, so it doesn't yield an anchor.
 */
export function parseTextDirective(directive: string): TQuoteAnchor | undefined {
	const parts = directive.split(",");
	const prefix = parts.length > 1 && itemAt(parts, 0).endsWith("-") ? decodeURIComponent(itemAt(parts, 0).slice(0, -1)) : undefined;
	if (prefix !== undefined) parts.shift();
	const suffix = parts.length > 1 && itemAt(parts, parts.length - 1).startsWith("-") ? decodeURIComponent(itemAt(parts, parts.length - 1).slice(1)) : undefined;
	if (suffix !== undefined) parts.pop();
	const [quoted] = parts;
	if (parts.length !== 1 || !quoted) return undefined;
	const exact = decodeURIComponent(quoted);
	return { exact, ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}) };
}

/** Returns the text directive that quotes an anchor. It is the inverse of `parseTextDirective`. Each part is encoded,
 *  so a dash or a comma in the text is never read as a marker. */
export function textDirectiveFor(anchor: TQuoteAnchor): string {
	const encode = (text: string) => encodeURIComponent(text).replace(/-/g, "%2D");
	return `${anchor.prefix ? `${encode(anchor.prefix)}-,` : ""}${encode(anchor.exact)}${anchor.suffix ? `,-${encode(anchor.suffix)}` : ""}`;
}

/** Returns the directive that follows `:~:` for a part. `splitPart` parses that directive back into the part. */
export function partDirectiveFor(part: TPart): string {
	return isFragment(part) ? part.value : `${TEXT_KEY}=${textDirectiveFor(part)}`;
}

/** Splits an href into the reference and the directive after `:~:`. `resolveLinkTarget` parses the directive only after
 *  the reference resolves to a record, because an address on the web may carry a directive of its own. */
function splitDirective(href: string): { base: string; directive?: string } {
	const at = href.indexOf(PART_DIRECTIVE);
	return at === -1 ? { base: href } : { base: href.slice(0, at).replace(/#$/, ""), directive: href.slice(at + PART_DIRECTIVE.length) };
}

/** Returns the part a directive names: a quoted passage or a media fragment. A range text directive doesn't yield a
 *  quote, so the reference names the whole record. */
function parsePart(directive: string): TPart | undefined {
	return directive.startsWith(`${TEXT_KEY}=`) ? parseTextDirective(directive.slice(TEXT_KEY.length + 1)) : parseFragment(directive);
}

/** Splits a reference to a record into its base and the part it names. */
export function splitPart(href: string): { base: string; anchor?: TPart } {
	const { base, directive } = splitDirective(href);
	const anchor = directive === undefined ? undefined : parsePart(directive);
	return { base, ...(anchor ? { anchor } : {}) };
}

/** Returns the href of a type or of one of its records. `resolveLinkTarget` reads the href back. The id is percent-encoded
 *  with its parentheses, so it stays whole as a markdown link's destination. */
export function typedHref(persistedAs: string, id?: string): string {
	if (id === undefined) return `#${persistedAs}`;
	return `#${persistedAs}:${encodeURIComponent(id).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/** Returns a markdown link to a type or to one of its records. Square brackets in the link text are escaped. A reader
 *  opens the type or the record from the link. */
export const markdownRef = (text: string, persistedAs: string, id?: string): string => `[${text.replace(/[[\]]/g, "\\$&")}](${typedHref(persistedAs, id)})`;

/**
 * Resolves an href to the type or the record it names. Returns null for an empty href, a plain in-page `#anchor`, a
 * path, an address on the web or any other href that doesn't name a type or a record. An id may contain colons, so the
 * type and the id split at the first colon. A DID is such an id.
 */
export function resolveLinkTarget(href: string | null | undefined, isType: (name: string) => boolean): TLinkTarget | null {
	if (!href) return null;
	const { base, directive } = splitDirective(href);
	if (!base.startsWith("#")) return null;
	const key = decodeHref(base.slice(1), "reference link");
	if (!key) return null;
	const colon = key.indexOf(":");
	if (colon === -1) return isType(key) ? { kind: DENOTES.type, persistedAs: key } : null;
	const persistedAs = key.slice(0, colon);
	const id = key.slice(colon + 1);
	if (!persistedAs || !id || !isType(persistedAs)) return null;
	const anchor = directive === undefined ? undefined : parsePart(directive);
	return { kind: DENOTES.individual, persistedAs, id, ...(anchor ? { anchor } : {}) };
}

/** Parses a `#Type`, `#Type:id` or `#Type:id:~:<part>` href into the in-app reference it names, or null when it isn't one. */
export function parseRefHref(href: string | null | undefined, isType: (name: string) => boolean): TRefHref | null {
	const target = resolveLinkTarget(href, isType);
	if (target?.kind === DENOTES.type) return { kind: REF_DENOTES.type, target: { domain: target.persistedAs } };
	if (target?.kind === DENOTES.individual)
		return { kind: REF_DENOTES.individual, target: { persistedAs: target.persistedAs, id: target.id, ...(target.anchor ? { selector: target.anchor } : {}) } };
	return null;
}

/**
 * Returns the rel and link text of a typed link, or null for an untyped link. Only the colon form is typed. Throws for
 * a rel the ontology doesn't declare, because the colon marks the text after it as a rel.
 */
export function classifyLinkText(text: string, vocab: TLinkVocabulary): { rel: string; linkText?: string } | null {
	const trimmed = text.trim();
	const groups = TYPED_TEXT.exec(trimmed)?.groups;
	if (!groups) return null;
	const { rel } = groups;
	if (rel === undefined) throw new Error(`typed link "[${trimmed}]": the typed-link pattern matched without capturing a rel`);
	if (vocab.relRange(rel) === undefined)
		throw new Error(`typed link "[${trimmed}]": "${rel}" is not a declared rel. Use a declared rel, or write a space after the colon so the link text is read as prose.`);
	return { rel, ...(groups.linkText ? { linkText: groups.linkText } : {}) };
}

/** One markdown-it instance parses every text. linkify is off, so a bare URL in prose stays prose and only a written link is data. */
let linkParser: MarkdownIt | undefined;

/** Returns every explicit link in the markdown in document order. markdown-it doesn't tokenize code fences or inline code as links. */
function markdownLinks(markdown: string): Array<{ text: string; href: string }> {
	if (!linkParser) linkParser = new MarkdownIt({ html: false, linkify: false });
	const links: Array<{ text: string; href: string }> = [];
	for (const block of linkParser.parse(markdown, {})) {
		if (block.type !== "inline" || !block.children) continue;
		const children = block.children;
		for (let i = 0; i < children.length; i++) {
			const opened = itemAt(children, i);
			if (opened.type !== "link_open") continue;
			const href = opened.attrGet("href");
			let text = "";
			let j = i + 1;
			for (; j < children.length && itemAt(children, j).type !== "link_close"; j++) {
				const child = itemAt(children, j);
				if (child.type === "text" || child.type === "code_inline") text += child.content;
			}
			if (j < children.length && href) links.push({ text, href });
			i = j;
		}
	}
	return links;
}

/**
 * Returns the facts the markdown states. Throws for a typed link with an undeclared rel, a rel whose range isn't a
 * resource, or a target other than a `#Type:id` reference to a persisted type. An untyped link to any other target is
 * prose and doesn't state a fact.
 */
export function typedLinkFacts(markdown: string, vocab: TLinkVocabulary): TTypedLinkFact[] {
	const facts: TTypedLinkFact[] = [];
	for (const link of markdownLinks(markdown)) {
		const typed = classifyLinkText(link.text, vocab);
		const rel = typed?.rel ?? LinkRelations.MENTIONS.rel;
		if (typed && vocab.relRange(rel) !== "iri")
			throw new Error(`typed link "[${link.text}]": "${rel}" does not point at a resource and cannot be a link's rel. Use a rel whose range is a resource.`);
		const target = resolveLinkTarget(link.href, vocab.isType);
		if (!target || target.kind === "type") {
			if (!typed) continue;
			const why = target ? `"${target.persistedAs}" is a type. Link to one of its records as #Type:id.` : "a fact's target is a record. Write the href as #Type:id.";
			throw new Error(`typed link "[${link.text}](${link.href})": ${why}`);
		}
		facts.push({ rel, ...(typed ? { typed: true as const } : {}), ...(typed?.linkText ? { linkText: typed.linkText } : {}), target });
	}
	return facts;
}

/** Returns a mention for each record that a text's links name. It reads only each link's href, so a colon in link text
 *  isn't read as a rel. A caller passes a text whose writer wasn't given the typed form. A model's response is such a text. */
export function linkMentions(markdown: string, vocab: TLinkVocabulary): TTypedLinkFact[] {
	return markdownLinks(markdown).flatMap(({ href }) => {
		const target = resolveLinkTarget(href, vocab.isType);
		return target?.kind === DENOTES.individual ? [{ rel: LinkRelations.MENTIONS.rel, target }] : [];
	});
}
