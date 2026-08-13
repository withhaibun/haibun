/**
 * markdown-refs — a markdown-it plugin that turns an in-app reference link into a <shu-ref>, so a link in prose
 * or a document opens the referenced type or individual in a column (via PaneState) instead of navigating the
 * page. Reuses shu-ref's renderRef + routing; the markdown author only writes a link.
 *
 * The grammar it renders is the typed-link grammar (`@haibun/core/lib/typed-links.js`), the same one the server
 * derives facts from: a link is a reference when its href is `#Type` (a known persisted type → the type's view) or
 * `#Type:id` (an individual of that type), optionally addressing a passage inside it with a text directive
 * (`#Type:id:~:text=[prefix-,]exact[,-suffix]`, which maps one-to-one onto the Web Annotation TextQuoteSelector the
 * graph persists). Opening such a reference opens the individual's column and reveals the quoted passage.
 */
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { parseRefHref } from "@haibun/core/lib/typed-links.js";
import { renderRef } from "./components/ref-navigation.js";
import { getPropertyDefinition } from "./rels-cache.js";


/**
 * A typed link renders its link text, never its rel. A typed link with no link text (`[:cites](…)`) renders the rel's
 * declared display name and icon.
 */
function displayForLinkText(text: string): string {
	const colon = text.lastIndexOf(":");
	if (colon === -1) return text;
	const words = text.slice(0, colon).trim();
	if (words) return words;
	const rel = text.slice(colon + 1).trim();
	const definition = getPropertyDefinition(rel);
	if (!definition) return text;
	const named = definition.label ?? rel;
	return definition.icon ? `${definition.icon} ${named}` : named;
}

/** Install the reference-link rule: a type-reference link's `link_open … link_close` tokens become one shu-ref. */
export function refLinksPlugin(md: MarkdownIt, isType: (name: string) => boolean): void {
	md.core.ruler.push("shu_ref_links", (state) => {
		for (const block of state.tokens) {
			if (block.type !== "inline" || !block.children) continue;
			const children = block.children;
			for (let i = 0; i < children.length; i++) {
				if (children[i].type !== "link_open") continue;
				const ref = parseRefHref(children[i].attrGet("href"), isType);
				if (!ref) continue;
				let j = i + 1;
				let text = "";
				for (; j < children.length && children[j].type !== "link_close"; j++) {
					if (children[j].type === "text" || children[j].type === "code_inline") text += children[j].content;
				}
				if (j >= children.length) continue; // unbalanced — leave the link as-is
				const tok = new state.Token("html_inline", "", 0);
				tok.content = renderRef(ref.kind, ref.target, text ? displayForLinkText(text) : undefined);
				children.splice(i, j - i + 1, tok);
			}
		}
	});
}

/** The shu-ref attributes a rewritten reference carries; DOMPurify lowercases attribute names, so `linkTarget` is
 *  allowlisted as `linktarget`. */

/** One renderer for every prose surface: built once, since a MarkdownIt carries its plugin rules. */
let proseRenderer: MarkdownIt | undefined;

/** The renderer for a whole body text: block markdown and the inline HTML a source carries, with its in-app
 *  references live. Built once, like the prose renderer. */
let bodyRenderer: MarkdownIt | undefined;

/**
 * Render a whole markdown body with its `#Type` / `#Type:id` links live, so a reference inside a text opens the type or
 * individual in a column. Without this a reference renders as a plain anchor and CLICKING IT NAVIGATES THE PAGE to a
 * hash the app cannot read. A text's own references must not leave the app.
 *
 * Sanitizing is the caller's (each body sink has its own allowlist); `refSanitizeOptions` carries what a rewritten
 * reference needs.
 */
export function renderRefBody(markdown: string, isType: (name: string) => boolean): string {
	if (!bodyRenderer) {
		bodyRenderer = new MarkdownIt({ html: true, linkify: true, typographer: true });
		refLinksPlugin(bodyRenderer, isType);
	}
	return bodyRenderer.render(markdown);
}

/** What a sanitizer must allow through for a rewritten reference to survive: the element and the attributes carrying it. */
export const refSanitizeOptions = { ADD_TAGS: ["shu-ref"], ADD_ATTR: ["kind", "linktarget", "text"] };

/**
 * Render a SHORT piece of prose — a type's description, a step's — with its `#Type` / `#Type:id` links live, so a
 * description names another type by linking to it rather than re-explaining it wherever it comes up. Inline-only: a
 * description is a sentence, so it gets no paragraphs, headings or lists, and no raw HTML — unlike a document body,
 * whose author is the run. Sanitized, because a description travels from the served concern catalog.
 */
export function renderRefProse(text: string, isType: (name: string) => boolean): string {
	if (!proseRenderer) {
		proseRenderer = new MarkdownIt({ html: false, linkify: false, typographer: true });
		refLinksPlugin(proseRenderer, isType);
	}
	return DOMPurify.sanitize(proseRenderer.renderInline(text), refSanitizeOptions);
}
