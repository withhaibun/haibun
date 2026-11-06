/**
 * A text as the page shows it: HTML escaping and a reference's markup. The markdown renderers and a body's HTML by media
 * type are in `markdown-render.ts`, which the views that render markdown load.
 *
 * A reference follows the typed-link grammar (`@haibun/core/lib/domains/typed-links.js`), the grammar from which the server derives
 * facts: an href of `#Type` names a persisted type, `#Type:id` an individual of that type, and a text directive
 * (`#Type:id:~:text=[prefix-,]exact[,-suffix]`) a passage inside it, which maps one-to-one onto the Web Annotation
 * TextQuoteSelector the graph persists. A rendered reference is a `<shu-ref>`, which opens its target in a column.
 */
import { esc } from "@haibun/core/lib/domains/document-content.js";
import { JsonObjectTextSchema } from "@haibun/core/lib/domains/json-text.js";
import { IndividualAddressSchema, REF_DENOTES, parseRefHref } from "@haibun/core/lib/domains/typed-links.js";
import { PartSchema } from "@haibun/core/lib/domains/resources.js";
import { StepMethodSchema } from "@haibun/core/lib/steps/domains/step-method.js";
import { ActionSchema } from "@haibun/core/lib/domains/actions.js";
import { z } from "zod";
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
export function renderRef(ref: TRef, text?: string, inlineImage?: boolean): string {
	const display = text ?? refLabel(ref);
	const imageAttr = inlineImage === true ? ' inline-image="true"' : "";
	return `<shu-ref kind="${escAttr(ref.kind)}" linkTarget="${escAttr(JSON.stringify(ref.target))}" text="${escAttr(display)}"${imageAttr}>${esc(display)}</shu-ref>`;
}

/** What a text's references read from the catalog: whether a name is a persisted type, and what the ontology declares of a
 *  relation. A page holds one context, so each renderer is built once for it. */
export type TRefContext = { isType: (name: string) => boolean; propertyDefinition: (rel: string) => TPropertyDefinition | undefined };

/** Returns the text of a parsed element or fragment, whose text the DOM states. */
export function textOf(node: Node): string {
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

/** The reading style of a record's body text. The body iframe's document and the inline annotated view both use it, so the
 *  annotation gutter doesn't change how the text reads. */
export const BODY_READING_STYLE = "font-family: sans-serif; font-size: 14px; line-height: 1.5;";
