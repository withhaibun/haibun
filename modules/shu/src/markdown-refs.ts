/**
 * markdown-refs — a markdown-it plugin that turns an in-app reference link into a <shu-ref>, so a link in prose
 * or a document opens the referenced type or individual in a column (via PaneState) instead of navigating the
 * page. Reuses shu-ref's renderRef + routing; the markdown author only writes a link.
 *
 * A link is a reference when its href is `#Type` (a known persisted type → the type's view) or `#Type:id` (an
 * individual of that type). `Type` MUST be a known persisted type (`isType`), so an ordinary in-page `#anchor`
 * link is left as a plain anchor. The id may itself contain colons (a DID), so the type/id split is on the FIRST
 * colon only.
 *
 * An individual reference may address a passage INSIDE the individual with a text directive — the W3C/WICG Text
 * Fragment syntax, `#Type:id:~:text=[prefix-,]exact[,-suffix]` — which maps one-to-one onto the Web Annotation
 * TextQuoteSelector the graph already persists. Opening such a reference opens the individual's column and reveals
 * the quoted passage. The directive is format-agnostic: it quotes content, not a section-numbering convention.
 */
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { renderRef } from "./components/shu-ref.js";
// Type-only: the quote shape is annotation-resolver's QuoteAnchor (the TextQuoteSelector shape, oa:exact/oa:prefix/oa:suffix).
import type { QuoteAnchor } from "./annotation-resolver.js";

export type TRefHref = { kind: "domain"; target: { domain: string } } | { kind: "entity"; target: { persistedAs: string; id: string; selector?: QuoteAnchor } };

const TEXT_DIRECTIVE = ":~:text=";

/**
 * Parse a Text Fragment directive value (`[prefix-,]exact[,-suffix]`) into a quote selector. The marker dashes are
 * literal in the raw directive (an encoded %2D is text, not a marker), so parts are classified before decoding.
 * A range form (`start,end`) has no TextQuoteSelector equivalent, so it yields no selector.
 */
export function parseTextDirective(directive: string): QuoteAnchor | undefined {
	const parts = directive.split(",");
	let prefix: string | undefined;
	let suffix: string | undefined;
	if (parts.length > 1 && parts[0].endsWith("-")) prefix = decodeURIComponent((parts.shift() ?? "").slice(0, -1));
	if (parts.length > 1 && parts[parts.length - 1].startsWith("-")) suffix = decodeURIComponent((parts.pop() ?? "").slice(1));
	if (parts.length !== 1 || !parts[0]) return undefined;
	const exact = decodeURIComponent(parts[0]);
	return { exact, ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}) };
}

/** Parse a `#Type` / `#Type:id` / `#Type:id:~:text=…` href into a shu-ref kind + target, or null when it is not a type reference. */
export function parseRefHref(href: string | null | undefined, isType: (name: string) => boolean): TRefHref | null {
	if (!href || href[0] !== "#") return null;
	let key = href.slice(1);
	if (!key) return null;
	let selector: QuoteAnchor | undefined;
	const directiveAt = key.indexOf(TEXT_DIRECTIVE);
	if (directiveAt !== -1) {
		selector = parseTextDirective(key.slice(directiveAt + TEXT_DIRECTIVE.length));
		key = key.slice(0, directiveAt);
	}
	const colon = key.indexOf(":");
	if (colon === -1) return isType(key) ? { kind: "domain", target: { domain: key } } : null;
	const persistedAs = key.slice(0, colon);
	const id = key.slice(colon + 1);
	if (!persistedAs || !id || !isType(persistedAs)) return null;
	return { kind: "entity", target: { persistedAs, id, ...(selector ? { selector } : {}) } };
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
				tok.content = renderRef(ref.kind, ref.target, text || undefined);
				children.splice(i, j - i + 1, tok);
			}
		}
	});
}

/** The shu-ref attributes a rewritten reference carries; DOMPurify lowercases attribute names, so `linkTarget` is
 *  allowlisted as `linktarget`. */
const REF_SANITIZE_OPTS = { ADD_TAGS: ["shu-ref"], ADD_ATTR: ["kind", "linktarget", "text"] };

/** One renderer for every prose surface: built once, since a MarkdownIt carries its plugin rules. */
let proseRenderer: MarkdownIt | undefined;

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
	return DOMPurify.sanitize(proseRenderer.renderInline(text), REF_SANITIZE_OPTS);
}
