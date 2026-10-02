/**
 * Typed markdown links: markdown links as data.
 *
 * A typed link carries a rel after a colon in its link text; the link text before the colon is what renders:
 *
 *   [the specification](#File:docs/spec.pdf)                        untyped: the default `mentions`
 *   [the clause it exercises:citesAsEvidence](#File:docs/spec.pdf)  typed: link text renders, the rel is the fact
 *   [that clause:cites](#File:docs/spec.pdf:~:text=a%20quote)       typed, targeting a passage
 *   [the table:cites](#File:docs/spec.pdf:~:page=12)                 typed, targeting a page of the document
 *
 * An untyped link never reads its link text as a rel, so prose stays prose.
 *
 * A fact's target is a record here, `#Type:id`, optionally with a part after `:~:`: a W3C/WICG Text Fragment directive
 * (`text=[prefix-,]exact[,-suffix]`, one-to-one with a Web Annotation TextQuoteSelector) for a passage, or a fragment of
 * the record's media (a Web Annotation FragmentSelector): `page=N` of a PDF (RFC 8118), `t=` of audio or video and `xywh=`
 * of an image (Media Fragments). Any other href (a page anchor, a relative path, a web address) is only a link.
 *
 * This module is the grammar alone: it reads text and reports facts. Writing them is `readTypedLinks` (resources.ts),
 * which resolves each target against the store.
 */
import { z } from "zod";
import { itemAt } from "./util/item-at.js";
import MarkdownIt from "markdown-it";
import { LinkRelations, type TPart, type TQuoteAnchor, type TRelRange } from "./resources.js";
import { MEDIA_FRAGMENTS, isFragment, type TFragment } from "./media-fragments.js";

/**
 * What a reference denotes: one persisted individual, or a type. Every surface that tells those two apart states it
 * with these words, so a link, a pane, a statement and an ask name the same distinction the same way.
 */
export const DENOTES = { individual: "individual", type: "type" } as const;
/**
 * The same distinction as it is written into rendered documents, where `<shu-ref kind>` carries it and the ref
 * navigation reads it back. Documents already hold these words, so they stay as written and are named here rather
 * than spelled at each place that tests them.
 */
export const REF_DENOTES = { individual: "entity", type: "domain" } as const;

export const DOMAIN_INDIVIDUAL_ADDRESS = "individual-address";

/** An individual named by the type it is persisted as and its own id, the pair every surface names one by, so whoever
 *  holds it reads it directly. */
export const IndividualAddressSchema = z.object({
	persistedAs: z.string().describe("The type the individual is persisted as."),
	id: z.string().describe("The individual's id within that type."),
});
export type TIndividualAddress = z.infer<typeof IndividualAddressSchema>;

/** An in-app reference: a type, or an individual (optionally a part of it). The shape the SPA's renderer takes. */
type TRefHref = { kind: typeof REF_DENOTES.type; target: { domain: string } } | { kind: typeof REF_DENOTES.individual; target: TIndividualAddress & { selector?: TPart } };

/** What a statement can be about: a typed individual, optionally a part of it. */
type TAddressableTarget = TIndividualAddress & { kind: typeof DENOTES.individual; anchor?: TPart };

/** What a link's href denotes. A TYPE is a schema term, not an individual: a link to one navigates and doesn't state a fact. */
type TLinkTarget = TAddressableTarget | { kind: typeof DENOTES.type; persistedAs: string };

/**
 * One fact a link states, about the text that states it. `typed` marks a typed link. `linkText` is the link text
 * before the colon; a typed link's anchor takes it as its rdfs:label. An untyped link derives only the record-level
 * edge: its passage stays in the link.
 */
export type TTypedLinkFact = { rel: string; typed?: true; linkText?: string; target: TAddressableTarget };

/**
 * What the declared ontology states, as the grammar needs it: whether a name is a rel (and its range), and whether a
 * name is a persisted type. Built from the registered domains (`linkVocabularyFromDomains`), so a consumer's own
 * rels and types are usable in links without this module knowing them.
 */
export type TLinkVocabulary = {
	relRange(rel: string): TRelRange | undefined;
	isType(name: string): boolean;
};

/** What separates a reference to a record from the part of it the reference names. */
export const PART_DIRECTIVE = ":~:";
/** The key a part that quotes a passage is written with. */
const TEXT_KEY = "text";

const PART_KEYS = [TEXT_KEY, ...MEDIA_FRAGMENTS.map(({ key }) => key)].map((key) => `${key}=`).join(", ");

/** The fragment a `key=value` names, or a refusal where the key isn't one a part is written with or the value isn't in
 *  the key's form, so a reference doesn't name a part it doesn't locate. */
function parseFragment(directive: string): TFragment {
	const at = directive.indexOf("=");
	const key = directive.slice(0, at);
	const spec = MEDIA_FRAGMENTS.find((fragment) => fragment.key === key);
	if (at < 0 || !spec) throw new Error(`"${PART_DIRECTIVE}${directive}" doesn't name a part of a record: a part is written as ${PART_KEYS}`);
	if (!spec.form.test(directive.slice(at + 1))) throw new Error(`"${directive}" isn't a ${key} fragment of ${spec.of}`);
	return { conformsTo: spec.conformsTo, value: directive };
}

/**
 * The typed form: link text, a colon, a rel. Whitespace doesn't touch the colon, so ordinary prose link text
 * ("Section 3: Overview") is not read as typed. The link text may be omitted (`:cites`).
 */
const TYPED_TEXT = /^(?<linkText>\S(?:.*\S)?)?:(?<rel>[a-zA-Z][a-zA-Z0-9_]*)$/;

/** Decode an href back to what the author wrote (markdown-it percent-encodes link destinations). */
function decodeHref(href: string, context: string): string {
	try {
		return decodeURIComponent(href);
	} catch {
		throw new Error(`${context}: "${href}" is not a valid link destination (malformed percent-encoding)`);
	}
}

/**
 * Parse a Text Fragment directive value (`[prefix-,]exact[,-suffix]`) into a quote anchor. The marker dashes are
 * literal in the raw directive (an encoded %2D is text, not a marker), so parts are classified before decoding.
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

/** The text directive that quotes an anchor, the inverse of `parseTextDirective`: each part is encoded, so a dash or a
 *  comma in the text is never read as a marker. */
export function textDirectiveFor(anchor: TQuoteAnchor): string {
	const encode = (text: string) => encodeURIComponent(text).replace(/-/g, "%2D");
	return `${anchor.prefix ? `${encode(anchor.prefix)}-,` : ""}${encode(anchor.exact)}${anchor.suffix ? `,-${encode(anchor.suffix)}` : ""}`;
}

/** The directive a part is written as after `:~:`, the inverse of `splitPart`. */
export function partDirectiveFor(part: TPart): string {
	return isFragment(part) ? part.value : `${TEXT_KEY}=${textDirectiveFor(part)}`;
}

/** An href as the reference it writes and the directive after `:~:`, which isn't read until the reference is known to name
 *  a record here: an address on the web may carry a directive of its own. */
function splitDirective(href: string): { base: string; directive?: string } {
	const at = href.indexOf(PART_DIRECTIVE);
	return at === -1 ? { base: href } : { base: href.slice(0, at).replace(/#$/, ""), directive: href.slice(at + PART_DIRECTIVE.length) };
}

/** The part a directive names: a passage it quotes, or a fragment of its media. A text directive that doesn't yield a
 *  quote, as a range, names the record alone. */
function parsePart(directive: string): TPart | undefined {
	return directive.startsWith(`${TEXT_KEY}=`) ? parseTextDirective(directive.slice(TEXT_KEY.length + 1)) : parseFragment(directive);
}

/** Split the part a reference to a record names off it. */
export function splitPart(href: string): { base: string; anchor?: TPart } {
	const { base, directive } = splitDirective(href);
	const anchor = directive === undefined ? undefined : parsePart(directive);
	return { base, ...(anchor ? { anchor } : {}) };
}

/** The href a reference to a type, or to one of its records, is written with, which `resolveLinkTarget` reads back. The id
 *  is encoded, parentheses included, so it stays whole as a markdown link's destination. */
export function typedHref(persistedAs: string, id?: string): string {
	if (id === undefined) return `#${persistedAs}`;
	return `#${persistedAs}:${encodeURIComponent(id).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/** A markdown link to a type, or to one of its records: how an answer or a turn's activity names one, so a reader opens it. */
export const markdownRef = (text: string, persistedAs: string, id?: string): string => `[${text.replace(/[[\]]/g, "\\$&")}](${typedHref(persistedAs, id)})`;

/**
 * Resolve an href to what it names, or null when it doesn't name a record here (a plain in-page `#anchor`, a path, an
 * address on the web, an empty href). The id may itself contain colons (a DID), so the type/id split is on the FIRST
 * colon only.
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

/** Parse a `#Type` / `#Type:id` / `#Type:id:~:<part>` href into the in-app reference it names, or null when it is not one. */
export function parseRefHref(href: string | null | undefined, isType: (name: string) => boolean): TRefHref | null {
	const target = resolveLinkTarget(href, isType);
	if (target?.kind === DENOTES.type) return { kind: REF_DENOTES.type, target: { domain: target.persistedAs } };
	if (target?.kind === DENOTES.individual)
		return { kind: REF_DENOTES.individual, target: { persistedAs: target.persistedAs, id: target.id, ...(target.anchor ? { selector: target.anchor } : {}) } };
	return null;
}

/**
 * The rel and link text of a typed link, or null for an untyped one. Only the colon form is typed; a rel the ontology
 * does not declare is an error, since the colon indicates a rel was meant.
 */
export function classifyLinkText(text: string, vocab: TLinkVocabulary): { rel: string; linkText?: string } | null {
	const trimmed = text.trim();
	const groups = TYPED_TEXT.exec(trimmed)?.groups;
	if (!groups) return null;
	const { rel } = groups;
	if (rel === undefined) throw new Error(`typed link "[${trimmed}]": the typed-link pattern names its rel`);
	if (vocab.relRange(rel) === undefined) throw new Error(`typed link "[${trimmed}]": "${rel}" is not a declared rel`);
	return { rel, ...(groups.linkText ? { linkText: groups.linkText } : {}) };
}

/** One markdown-it instance for every parse: linkify is OFF, so a bare URL in prose is prose, only a written link is data. */
let linkParser: MarkdownIt | undefined;

/** Every explicit link in the markdown, in document order. Code fences and inline code never tokenize as links, so they are immune by construction. */
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
 * The facts the markdown states. A typed link is held to its rel: an undeclared rel, a rel that does not point at a
 * resource, or a target that doesn't name a record here is an error. An untyped link whose target doesn't name a record here is
 * prose and doesn't state a fact.
 */
export function typedLinkFacts(markdown: string, vocab: TLinkVocabulary): TTypedLinkFact[] {
	const facts: TTypedLinkFact[] = [];
	for (const link of markdownLinks(markdown)) {
		const typed = classifyLinkText(link.text, vocab);
		const rel = typed?.rel ?? LinkRelations.MENTIONS.rel;
		if (typed && vocab.relRange(rel) !== "iri") throw new Error(`typed link "[${link.text}]": "${rel}" does not point at a resource and cannot be a link's rel`);
		const target = resolveLinkTarget(link.href, vocab.isType);
		if (!target || target.kind === "type") {
			if (!typed) continue;
			const why = target ? `"${target.persistedAs}" is a type` : "a fact's target is a record here, named #Type:id";
			throw new Error(`typed link "[${link.text}](${link.href})": ${why}`);
		}
		facts.push({ rel, ...(typed ? { typed: true as const } : {}), ...(typed?.linkText ? { linkText: typed.linkText } : {}), target });
	}
	return facts;
}

/** The records a text's links name, each link read as a mention and its text as text: for a text whose writer wasn't given the
 *  typed form, as a model's answer, whose link text may hold a colon as prose does. */
export function linkMentions(markdown: string, vocab: TLinkVocabulary): TTypedLinkFact[] {
	return markdownLinks(markdown).flatMap(({ href }) => {
		const target = resolveLinkTarget(href, vocab.isType);
		return target?.kind === DENOTES.individual ? [{ rel: LinkRelations.MENTIONS.rel, target }] : [];
	});
}
