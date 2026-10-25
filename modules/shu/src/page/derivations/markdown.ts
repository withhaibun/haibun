/**
 * A text as the page shows it: HTML escaping, a reference's markup, the markdown renderers with their in-app references,
 * and a body's HTML by media type.
 *
 * A reference follows the typed-link grammar (`@haibun/core/lib/domains/typed-links.js`), the grammar from which the server derives
 * facts: an href of `#Type` names a persisted type, `#Type:id` an individual of that type, and a text directive
 * (`#Type:id:~:text=[prefix-,]exact[,-suffix]`) a passage inside it, which maps one-to-one onto the Web Annotation
 * TextQuoteSelector the graph persists. A rendered reference is a `<shu-ref>`, which opens its target in a column.
 */
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { esc, headingAnchor } from "@haibun/core/lib/domains/document-content.js";
import { jsonCarried, JsonObjectTextSchema } from "@haibun/core/lib/domains/json-text.js";
import { IndividualAddressSchema, REF_DENOTES, parseRefHref } from "@haibun/core/lib/domains/typed-links.js";
import { PartSchema } from "@haibun/core/lib/domains/resources.js";
import { StepMethodSchema } from "@haibun/core/lib/steps/domains/step-method.js";
import { ActionSchema } from "@haibun/core/lib/domains/actions.js";
import { z } from "zod";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
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

/** The kind of a reference to a step by its path within the actuality feature the page reads. */
const STEP_PATH_KIND = "seqPath";

/** A kind of reference: the schema of the target it names, read at the boundary where a reference arrives as text, an
 *  element's attributes, an event's detail or a remedy, and the words it reads as where its text isn't given. */
const refKind = <S extends z.ZodType<Record<string, unknown>>>(target: S, label: (named: z.infer<S>) => string) => ({ target, label });

/** The kinds of reference a `<shu-ref>` names: a step by its path within the actuality feature the page reads, an individual
 *  (or a part of it), a type, a step by its method, and an action. */
export const REF_KINDS = {
	[STEP_PATH_KIND]: refKind(z.object({ seqPath: z.array(z.number()) }), ({ seqPath }) => seqPath.join(".")),
	[REF_DENOTES.individual]: refKind(IndividualAddressSchema.extend({ selector: PartSchema.optional() }), ({ id }) => id),
	[REF_DENOTES.type]: refKind(z.object({ domain: z.string() }), ({ domain }) => domain),
	step: refKind(z.object({ method: StepMethodSchema }), ({ method }) => method),
	action: refKind(z.object({ action: ActionSchema }), ({ action }) => action),
} as const;
export type TRefKind = keyof typeof REF_KINDS;
/** The target a reference of kind `K` names. */
export type TRefTarget<K extends TRefKind> = z.infer<(typeof REF_KINDS)[K]["target"]>;
/** A reference: its kind and the target that kind names. */
export type TRef = { [K in TRefKind]: { kind: K; target: TRefTarget<K> } }[TRefKind];

/** Whether `v` names a kind of reference. */
export const isRefKind = (v: string | null | undefined): v is TRefKind => typeof v === "string" && Object.hasOwn(REF_KINDS, v);

/** The reference a kind and a target that arrived as data state, or undefined where the kind isn't a reference's or the target
 *  isn't what the kind names. */
export function refOf(kind: string | null | undefined, target: unknown): TRef | undefined {
	if (!isRefKind(kind)) return undefined;
	const parsed = REF_KINDS[kind].target.safeParse(target);
	return parsed.success ? ({ kind, target: parsed.data } as TRef) : undefined;
}

/** A reference to a record by what it names, rather than to a step by its path. */
export type TNamedRef = Exclude<TRef, { kind: typeof STEP_PATH_KIND }>;

/** The path of the step a reference names, where it names a step by its path. */
export const stepPathOf = (ref: TRef): number[] | undefined => (ref.kind === STEP_PATH_KIND ? ref.target.seqPath : undefined);

/** A reference to the step at `path` within the actuality feature the page reads. */
export const stepPathRef = (path: readonly number[]): TRef => ({ kind: STEP_PATH_KIND, target: { seqPath: [...path] } });

/** The words a reference reads as where its text isn't given. */
export const refLabel = ({ kind, target }: TRef): string => (REF_KINDS[kind].label as (named: TRef["target"]) => string)(target);

/** Returns a reference's markup. The words are also its child text, so a surface where the element isn't defined (the
 *  sandboxed body iframe) shows them; the defined element's shadow root doesn't have a slot, so they never show twice. */
export function renderRef(ref: TRef, text?: string): string {
	const display = text ?? refLabel(ref);
	return `<shu-ref kind="${escAttr(ref.kind)}" linkTarget="${escAttr(JSON.stringify(ref.target))}" text="${escAttr(display)}">${esc(display)}</shu-ref>`;
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
export const refSanitizeOptions = { ADD_TAGS: ["shu-ref"], ADD_ATTR: ["kind", "linktarget", "text"] };

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

/** Returns the text of a parsed element or fragment, whose text the DOM states. */
function textOf(node: Node): string {
	const text = node.textContent;
	if (text === null) throw new Error(`a parsed ${node.nodeName} doesn't state its text`);
	return text;
}

/** A reference a rendered text makes, and the words that name it. */
export type TContentRef = { ref: TRef; text: string };

/** Returns the references a rendered text makes, once each: each `<shu-ref>` its markdown became, and each reference link an
 *  HTML text carries. A surface that shows the text without live references, the sandboxed body iframe, lists them beside it. */
export function refsInContent(html: string, refs: TRefContext): TContentRef[] {
	const template = document.createElement("template");
	template.innerHTML = html;
	const found = new Map<string, TContentRef>();
	for (const element of template.content.querySelectorAll("shu-ref")) {
		const kind = element.getAttribute("kind");
		if (!isRefKind(kind)) continue;
		const [targetJson, text] = [element.getAttribute("linkTarget"), element.getAttribute("text")];
		if (targetJson === null || text === null) throw new Error(`a <shu-ref kind="${kind}"> doesn't carry its linkTarget and its text, which renderRef writes`);
		const ref = refOf(kind, JsonObjectTextSchema.parse(targetJson));
		if (ref === undefined) throw new Error(`a <shu-ref kind="${kind}"> names a target that its kind doesn't name: ${targetJson}`);
		found.set(`${kind} ${JSON.stringify(ref.target)}`, { ref, text });
	}
	for (const anchor of template.content.querySelectorAll("a[href]")) {
		const ref = parseRefHref(anchor.getAttribute("href"), refs.isType);
		if (ref) found.set(`${ref.kind} ${JSON.stringify(ref.target)}`, { ref, text: textOf(anchor) });
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
