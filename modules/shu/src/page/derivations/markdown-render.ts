/**
 * A text's markdown and HTML as the page renders them: the markdown renderers with their in-app references, a body's HTML
 * by its media type, and the sanitizing options of each sink. The page loads them with the views that render a text's
 * markdown, apart from the references and escaping every view reads (`markdown.ts`).
 */
import { isJsonMedia, MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { esc, headingAnchor } from "@haibun/core/lib/domains/document-content.js";
import { jsonCarried } from "@haibun/core/lib/domains/json-text.js";
import { parseRefHref } from "@haibun/core/lib/domains/typed-links.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { renderRef, textOf, type TRefContext } from "./markdown.js";

/** A typed link renders its link text. A typed link without link text (`[:cites](…)`) renders the relation's declared
 *  display name and icon. */
function displayForLinkText(text: string, refs: TRefContext): string {
	const colon = text.lastIndexOf(":");
	if (colon === -1) return text;
	const words = text.slice(0, colon).trim();
	if (words) return words;
	const rel = text.slice(colon + 1).trim();
	const definition = refs.propertyDefinition(rel);
	if (!definition) return text;
	const named = definition.label ?? rel;
	return definition.icon ? `${definition.icon} ${named}` : named;
}

/** Installs the reference-link rule: a reference link's `link_open … link_close` tokens, or an image token whose src
 *  names a reference, become one `<shu-ref>`. */
export function refLinksPlugin(md: MarkdownIt, refs: TRefContext): void {
	md.core.ruler.push("shu_ref_links", (state) => {
		for (const block of state.tokens) {
			if (block.type !== "inline" || !block.children) continue;
			const children = block.children;
			for (let i = 0; i < children.length; i++) {
				const token = itemAt(children, i);
				if (token.type === "image") {
					const ref = parseRefHref(token.attrGet("src"), refs.isType);
					if (!ref) continue;
					const alt = token.children?.map((child) => child.content).join("") || token.content;
					const tok = new state.Token("html_inline", "", 0);
					tok.content = renderRef(ref, alt ? displayForLinkText(alt, refs) : undefined, true);
					children.splice(i, 1, tok);
					continue;
				}
				if (token.type !== "link_open") continue;
				const ref = parseRefHref(token.attrGet("href"), refs.isType);
				if (!ref) continue;
				let j = i + 1;
				let text = "";
				for (; j < children.length; j++) {
					const child = itemAt(children, j);
					if (child.type === "link_close") break;
					if (child.type === "text" || child.type === "code_inline") text += child.content;
				}
				if (j >= children.length) continue; // an unbalanced link stays as it is
				const tok = new state.Token("html_inline", "", 0);
				tok.content = renderRef(ref, text ? displayForLinkText(text, refs) : undefined);
				children.splice(i, j - i + 1, tok);
			}
		}
	});
}

/** Returns the renderer `make` builds for `refs`, built at the first call for that context. */
function rendererFor(held: WeakMap<TRefContext, MarkdownIt>, refs: TRefContext, make: () => MarkdownIt): MarkdownIt {
	const found = held.get(refs);
	if (found !== undefined) return found;
	const made = make();
	refLinksPlugin(made, refs);
	held.set(refs, made);
	return made;
}

/** Stamps every markdown heading the renderer produces with its name as a link anchor in `data-heading`. Core's
 *  headingAnchor computes the anchor from the heading text, as it does for actuality's scenario headings. A prose
 *  block's "## Contents" is then reachable as `#contents`. */
export function withHeadingAnchors(md: { renderer: { rules: Record<string, unknown>; renderToken(tokens: unknown[], idx: number, options: unknown): string } }): void {
	md.renderer.rules.heading_open = (tokens: Array<{ attrSet(name: string, value: string): void }>, idx: number, options: unknown) => {
		const inline = (tokens as Array<{ type?: string; content?: string }>)[idx + 1];
		if (inline?.type === "inline" && inline.content) itemAt(tokens, idx).attrSet("data-heading", headingAnchor(inline.content));
		return md.renderer.renderToken(tokens, idx, options);
	};
}

const bodyRenderers = new WeakMap<TRefContext, MarkdownIt>();
const answerRenderers = new WeakMap<TRefContext, MarkdownIt>();
const proseRenderers = new WeakMap<TRefContext, MarkdownIt>();

/** What a sanitizer allows through for a rewritten reference: the element and its attributes. DOMPurify lowercases attribute
 *  names, so `linkTarget` is allowed as `linktarget`. */
export const refSanitizeOptions = { ADD_TAGS: ["shu-ref"], ADD_ATTR: ["kind", "linktarget", "text", "inline-image"] };

/** Renders a whole markdown body, block markdown and the inline HTML its source carries, with its references live, so a
 *  reference opens its target in a column and doesn't navigate the page to a hash the page doesn't read. Each body sink
 *  sanitizes with its own allowlist and `refSanitizeOptions`. Every heading carries its anchor, so a link reaches a
 *  heading of any record body (CA4D12). */
export const renderRefBody = (markdown: string, refs: TRefContext): string =>
	rendererFor(bodyRenderers, refs, () => {
		const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
		withHeadingAnchors(md);
		return md;
	}).render(markdown);

/** Renders the text a model returns, with its references live: block markdown, without raw HTML, since a model and not
 *  actuality writes the text. Sanitized, as model output. */
export const renderRefAnswer = (markdown: string, refs: TRefContext): string =>
	DOMPurify.sanitize(rendererFor(answerRenderers, refs, () => new MarkdownIt({ html: false, linkify: false, typographer: false })).render(markdown), refSanitizeOptions);

/** Renders a short text, a type's description or a step's, inline, with its references live, so a description names another
 *  type by a link. A description is a sentence, so it renders without paragraphs, headings, lists and raw HTML. Sanitized,
 *  since a description travels from the served concern catalog. */
export const renderRefProse = (text: string, refs: TRefContext): string =>
	DOMPurify.sanitize(rendererFor(proseRenderers, refs, () => new MarkdownIt({ html: false, linkify: false, typographer: true })).renderInline(text), refSanitizeOptions);

/** Returns the words a short text reads as, each reference by the words that name it, for a surface that shows text alone. */
export function proseText(text: string, refs: TRefContext): string {
	const template = document.createElement("template");
	template.innerHTML = renderRefProse(text, refs);
	return textOf(template.content);
}

const preBlock = (text: string): string => `<pre style="font-family:monospace;white-space:pre-wrap;margin:0;">${esc(text)}</pre>`;

/** Returns a body's HTML by its media type: markdown with its references live, HTML as it reads, JSON indented, and any
 *  other text preformatted. Each surface that shows a `content` value renders it here. Callers sanitize with
 *  `refSanitizeOptions`. */
export function renderContentHtml(raw: string, mediaType: string, refs: TRefContext): string {
	if (mediaType === MEDIA_TYPE.markdown) return renderRefBody(raw, refs);
	if (mediaType === MEDIA_TYPE.html) return raw;
	if (isJsonMedia(mediaType)) {
		const carried = jsonCarried(raw);
		return preBlock(carried === undefined ? raw : JSON.stringify(carried, null, 2)); // a text that isn't JSON shows as it reads
	}
	return preBlock(raw);
}
