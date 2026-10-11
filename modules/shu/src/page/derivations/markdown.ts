/**
 * A text as the page shows it: HTML escaping, a reference's markup, the markdown renderers with their in-app references,
 * and a body's HTML by media type.
 *
 * A reference follows the typed-link grammar (`@haibun/core/lib/typed-links.js`), the grammar from which the server derives
 * facts: an href of `#Type` names a persisted type, `#Type:id` an individual of that type, and a text directive
 * (`#Type:id:~:text=[prefix-,]exact[,-suffix]`) a passage inside it, which maps one-to-one onto the Web Annotation
 * TextQuoteSelector the graph persists. A rendered reference is a `<shu-ref>`, which opens its target in a column.
 */
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { esc } from "@haibun/core/lib/document-content.js";
import { jsonCarried, JsonObjectTextSchema } from "@haibun/core/lib/json-text.js";
import { REF_DENOTES, parseRefHref } from "@haibun/core/lib/typed-links.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import type { TPropertyDefinition } from "./catalog.js";

export { esc };

/** Escapes a text for an HTML attribute value. */
export const escAttr = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Encodes a UTF-8 text as base64, a byte at a time, so a long body doesn't exceed the call stack. */
export function utf8ToBase64(str: string): string {
	let binary = "";
	for (const byte of new TextEncoder().encode(str)) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/** The kind of a reference to a step by its path within the execution the page reads. */
const STEP_PATH_KIND = "seqPath";
/** The kinds of reference a `<shu-ref>` names. */
export const REF_KIND = [STEP_PATH_KIND, REF_DENOTES.individual, REF_DENOTES.type, "step", "action"] as const;
export type TRefKind = (typeof REF_KIND)[number];

/** Whether `v` names a kind of reference. */
export const isRefKind = (v: string | null | undefined): v is TRefKind => typeof v === "string" && (REF_KIND as readonly string[]).includes(v);

/** A reference to the step at `path` within the execution the page reads: its kind and its target. */
export const stepPathRef = (path: readonly number[]): { kind: TRefKind; target: Record<string, unknown> } => ({ kind: STEP_PATH_KIND, target: { seqPath: [...path] } });

/** Returns the step path a reference names, where it is a reference to a step by its path. */
export function stepPathOf(kind: string, target: Record<string, unknown>): number[] | undefined {
	if (kind !== STEP_PATH_KIND) return undefined;
	const path = target.seqPath;
	if (!Array.isArray(path) || !path.every((n) => typeof n === "number")) throw new Error(`a reference to a step names its path as ${JSON.stringify(path)}, not numbers`);
	return path;
}

/** Returns the words a reference of `kind` to `targetJson` reads as where its text isn't given, or an empty text where the
 *  element's attributes don't state a kind and a target. */
export function refLabel(kind: string | null, targetJson: string | null): string {
	if (!kind || !targetJson) return "";
	const target = JsonObjectTextSchema.parse(targetJson);
	const path = stepPathOf(kind, target);
	if (path !== undefined) return path.join(".");
	if (kind === REF_DENOTES.individual && typeof target.id === "string") return target.id;
	if (kind === REF_DENOTES.type && typeof target.domain === "string") return target.domain;
	if (kind === "step" && typeof target.method === "string") return target.method;
	if (kind === "action" && typeof target.action === "string") return target.action;
	return "";
}

/** Returns a reference's markup. The words are also its child text, so a surface where the element isn't defined (the
 *  sandboxed body iframe) shows them; the defined element's shadow root doesn't have a slot, so they never show twice. */
export function renderRef(kind: TRefKind, linkTarget: Record<string, unknown>, text?: string): string {
	const targetJson = JSON.stringify(linkTarget);
	const display = text ?? refLabel(kind, targetJson);
	return `<shu-ref kind="${escAttr(kind)}" linkTarget="${escAttr(targetJson)}" text="${escAttr(display)}">${esc(display)}</shu-ref>`;
}

/** What a text's references read from the catalog: whether a name is a persisted type, and what the ontology declares of a
 *  relation. A page holds one context, so each renderer is built once for it. */
export type TRefContext = { isType: (name: string) => boolean; propertyDefinition: (rel: string) => TPropertyDefinition | undefined };

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

/** Installs the reference-link rule: a reference link's `link_open … link_close` tokens become one `<shu-ref>`. */
export function refLinksPlugin(md: MarkdownIt, refs: TRefContext): void {
	md.core.ruler.push("shu_ref_links", (state) => {
		for (const block of state.tokens) {
			if (block.type !== "inline" || !block.children) continue;
			const children = block.children;
			for (let i = 0; i < children.length; i++) {
				const linkOpen = itemAt(children, i);
				if (linkOpen.type !== "link_open") continue;
				const ref = parseRefHref(linkOpen.attrGet("href"), refs.isType);
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
				tok.content = renderRef(ref.kind, ref.target, text ? displayForLinkText(text, refs) : undefined);
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

const bodyRenderers = new WeakMap<TRefContext, MarkdownIt>();
const answerRenderers = new WeakMap<TRefContext, MarkdownIt>();
const proseRenderers = new WeakMap<TRefContext, MarkdownIt>();

/** What a sanitizer allows through for a rewritten reference: the element and its attributes. DOMPurify lowercases attribute
 *  names, so `linkTarget` is allowed as `linktarget`. */
export const refSanitizeOptions = { ADD_TAGS: ["shu-ref"], ADD_ATTR: ["kind", "linktarget", "text"] };

/** Renders a whole markdown body, block markdown and the inline HTML its source carries, with its references live, so a
 *  reference opens its target in a column and doesn't navigate the page to a hash the page doesn't read. Each body sink
 *  sanitizes with its own allowlist and `refSanitizeOptions`. */
export const renderRefBody = (markdown: string, refs: TRefContext): string =>
	rendererFor(bodyRenderers, refs, () => new MarkdownIt({ html: true, linkify: true, typographer: true })).render(markdown);

/** Returns the text of a parsed element or fragment, whose text the DOM states. */
function textOf(node: Node): string {
	const text = node.textContent;
	if (text === null) throw new Error(`a parsed ${node.nodeName} doesn't state its text`);
	return text;
}

/** A reference a rendered text makes: its kind, its target, and the words that name it. */
export type TContentRef = { kind: TRefKind; target: Record<string, unknown>; text: string };

/** Returns the references a rendered text makes, once each: each `<shu-ref>` its markdown became, and each reference link an
 *  HTML text carries. A surface that shows the text without live references, the sandboxed body iframe, lists them beside it. */
export function refsInContent(html: string, refs: TRefContext): TContentRef[] {
	const template = document.createElement("template");
	template.innerHTML = html;
	const found = new Map<string, TContentRef>();
	for (const ref of template.content.querySelectorAll("shu-ref")) {
		const kind = ref.getAttribute("kind");
		if (!isRefKind(kind)) continue;
		const [targetJson, text] = [ref.getAttribute("linkTarget"), ref.getAttribute("text")];
		if (targetJson === null || text === null) throw new Error(`a <shu-ref kind="${kind}"> doesn't carry its linkTarget and its text, which renderRef writes`);
		const target = JsonObjectTextSchema.parse(targetJson);
		found.set(`${kind} ${JSON.stringify(target)}`, { kind, target, text });
	}
	for (const anchor of template.content.querySelectorAll("a[href]")) {
		const ref = parseRefHref(anchor.getAttribute("href"), refs.isType);
		if (ref) found.set(`${ref.kind} ${JSON.stringify(ref.target)}`, { kind: ref.kind, target: ref.target, text: textOf(anchor) });
	}
	return [...found.values()];
}

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

/** The reading style of a record's body text. The body iframe's document and the inline annotated view both use it, so the
 *  annotation gutter doesn't change how the text reads. */
export const BODY_READING_STYLE = "font-family: sans-serif; font-size: 14px; line-height: 1.5;";

const preBlock = (text: string): string => `<pre style="font-family:monospace;white-space:pre-wrap;margin:0;">${esc(text)}</pre>`;

/** Returns a body's HTML by its media type: markdown with its references live, HTML as it reads, JSON indented, and any
 *  other text preformatted. Each surface that shows a `content` value renders it here. Callers sanitize with
 *  `refSanitizeOptions`. */
export function renderContentHtml(raw: string, mediaType: string, refs: TRefContext): string {
	if (mediaType === "text/markdown") return renderRefBody(raw, refs);
	if (mediaType === "text/html") return raw;
	if (mediaType === "application/ld+json" || mediaType === "application/json") {
		const carried = jsonCarried(raw);
		return preBlock(carried === undefined ? raw : JSON.stringify(carried, null, 2)); // a text that isn't JSON shows as it reads
	}
	return preBlock(raw);
}
