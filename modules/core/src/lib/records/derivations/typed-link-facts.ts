/**
 * The facts a markdown text's links state, read with markdown-it, by the grammar `lib/typed-links.ts` holds. The parser is apart
 * from the grammar, so a page that reads a reference loads the grammar alone.
 */
import MarkdownIt from "markdown-it";
import { itemAt } from "../../util/item-at.js";
import { LinkRelations } from "../../resources.js";
import { DENOTES, classifyLinkText, resolveLinkTarget, type TLinkVocabulary, type TTypedLinkFact } from "../../typed-links.js";

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
		const rel = typed === null ? LinkRelations.MENTIONS.rel : typed.rel;
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
