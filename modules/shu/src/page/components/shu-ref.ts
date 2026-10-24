/**
 * The lit templates of a reference: every panel that shows a structured identifier (seqPath, entity id, domain key, step,
 * action) renders it through these, so the link vocabulary stays consistent. They write `<shu-ref>` markup, the element
 * `shu-ref-element.ts` defines, and are free of it, so a module that renders a reference imports in any context.
 */
import { html, nothing, type TemplateResult } from "lit";
import { calledParts, factSeqPath } from "@haibun/core/lib/seq-path.js";
import { DENOTES, REF_DENOTES, type TIndividualAddress } from "@haibun/core/lib/domains/typed-links.js";
import type { TContextPattern } from "@haibun/core/lib/conversation/domains/conversation.js";
import { findDomain } from "../controllers/registry-controller.js";
import { edgeRecordType } from "../controllers/catalog-controller.js";
import { stepMethodName, type TStepMethod } from "@haibun/core/lib/steps/domains/step-method.js";
import type { TAction } from "@haibun/core/lib/domains/actions.js";
import type { TDomainKey } from "@haibun/core/lib/domains/domains.js";
import { statedTotal, type TCounted } from "@haibun/core/lib/domains/hypermedia.js";
import { esc, refLabel, renderRef, stepPathRef, type TRefKind } from "../derivations/markdown.js";
import "./shu-ref-element.js";

/**
 * The lit form of the same reference, for a view that renders a template rather than a string of markup: one place
 * determines what a reference is made of, so a panel writing `<shu-ref>` by hand cannot drift from what `renderRef`
 * writes. The display text is also child text, as in the string form, so a surface where the element is undefined
 * shows the text rather than an empty element.
 */
export const refTpl = (kind: TRefKind, linkTarget: Record<string, unknown>, text?: string, testId?: string): TemplateResult => {
	const targetJson = JSON.stringify(linkTarget);
	const display = text ?? refLabel(kind, targetJson);
	return html`<shu-ref data-testid=${testId ?? nothing} kind=${kind} linkTarget=${targetJson} text=${display}>${display}</shu-ref>`;
};

/** A type, as a link to its pane. */
export const typeRef = (label: string, testId?: string): TemplateResult => refTpl(REF_DENOTES.type, { domain: label }, label, testId);

/** A count, as a link to what it counts: a count that stopped at its ceiling reads as a floor. */
export const countRef = (counted: TCounted, href: string, testId?: string): TemplateResult =>
	html`<a class="count" href=${href} data-testid=${testId ?? nothing}>${statedTotal(counted)}</a>`;

/** A record, by its address, as a link to its view. */
export const recordRef = (address: TIndividualAddress, text?: string, testId?: string): TemplateResult => refTpl(REF_DENOTES.individual, address, text ?? address.id, testId);

/** What a field of `label` holds, as a link to the record it names where the type declares the field an edge, and as text
 *  where it doesn't. */
export const fieldRef = (label: string, field: string, value: string, testId?: string): TemplateResult | string => {
	const persistedAs = edgeRecordType(label, field);
	return persistedAs ? recordRef({ persistedAs, id: value }, value, testId) : value;
};

/** An instance's origin as a link to it: an address the browser opens, not a record a pane shows, so the elements under
 *  the link don't take the click. */
export const originLink = (origin: string): TemplateResult => html`<a href=${origin} target="_blank" rel="noopener" @click=${(e: Event) => e.stopPropagation()}>${origin}</a>`;

/** A domain, by its key, as a link to its view: the view of the type it persists as, or of the domain itself. */
export const domainRef = (key: TDomainKey, testId?: string): TemplateResult => refTpl(REF_DENOTES.type, { domain: findDomain(key)?.persistedAs ?? key }, key, testId);

/** A step, by its method, as a link to the step as actuality declares it. */
export const stepRef = (method: TStepMethod, text?: string, testId?: string): TemplateResult => refTpl("step", { method }, text ?? method, testId);

/** An action a caller holds or a step requires, as a link to what it allows. */
export const actionRef = (action: TAction, testId?: string): TemplateResult => refTpl("action", { action }, action, testId);

/** What a step's record names it called, as a link to that step. */
export const calledRef = (called: string): TemplateResult => {
	const { stepperName, actionName } = calledParts(called);
	return stepRef(stepMethodName(stepperName, actionName), called);
};

/** The link to what a context pattern names: its individual, or its type. */
export const patternRef = (pattern: TContextPattern): TemplateResult =>
	pattern.kind === DENOTES.individual
		? refTpl(REF_DENOTES.individual, { persistedAs: pattern.persistedAs, id: pattern.id })
		: refTpl(REF_DENOTES.type, { domain: pattern.persistedAs });

/**
 * Convenience wrappers: each panel typically calls just one or two of these.
 */
const refSeqPath = (path: number[], text?: string): string => {
	const ref = stepPathRef(path);
	return renderRef(ref.kind, ref.target, text ?? path.join("."));
};

/** A reference to the step at `path` within the actuality feature the page reads. */
export const stepPathTpl = (path: readonly number[], text: string, testId?: string): TemplateResult => {
	const ref = stepPathRef(path);
	return refTpl(ref.kind, ref.target, text, testId);
};

export const refDomain = (domain: string, text?: string): string => renderRef("domain", { domain }, text ?? domain);

/** A fact's id as a link to the step that produced it: a fact's id is that step's seqPath, and for one field of its
 *  product, the field. Any other id is text. */
export const factIdRef = (id: string): string => {
	const seqPath = factSeqPath(id);
	return seqPath ? refSeqPath(seqPath, id) : `<code>${esc(id)}</code>`;
};
