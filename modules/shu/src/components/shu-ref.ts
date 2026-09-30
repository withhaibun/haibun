/**
 * The lit templates of a reference: every panel that shows a structured identifier (seqPath, entity id, domain key, step,
 * action) renders it through these, so the link vocabulary stays consistent. They write `<shu-ref>` markup, the element
 * `shu-ref-element.ts` defines, and are free of it, so a module that renders a reference imports in any context.
 */
import { html, nothing, type TemplateResult } from "lit";
import { calledParts, factSeqPath } from "@haibun/core/lib/seq-path.js";
import { esc } from "../util.js";
import { DENOTES, REF_DENOTES } from "@haibun/core/lib/typed-links.js";
import { defaultLabel, renderRef, type TRefKind } from "./ref-navigation.js";
import type { TContextPattern } from "../schemas.js";
import { findDomain } from "../rpc-registry.js";
import { edgeRecordType } from "../rels-cache.js";
import { stepMethodName } from "@haibun/core/lib/step-registry.js";

/**
 * The lit form of the same reference, for a view that renders a template rather than a string of markup: one place
 * decides what a reference is made of, so a panel writing `<shu-ref>` by hand cannot drift from what `renderRef`
 * writes. The display text is also child text, as in the string form, so a surface where the element is undefined
 * shows the text rather than an empty element.
 */
export const refTpl = (kind: TRefKind, linkTarget: Record<string, unknown>, text?: string, testId?: string): TemplateResult => {
	const targetJson = JSON.stringify(linkTarget);
	const display = text ?? defaultLabel(kind, targetJson);
	return html`<shu-ref data-testid=${testId ?? nothing} kind=${kind} linkTarget=${targetJson} text=${display}>${display}</shu-ref>`;
};

/** A record, by its type and id, as a link to its view. */
export const recordRef = (persistedAs: string, id: string, text?: string, testId?: string): TemplateResult =>
	refTpl(REF_DENOTES.individual, { persistedAs, id }, text ?? id, testId);

/** What a field of `label` holds, as a link to the record it names where the type declares the field an edge, and as text
 *  where it doesn't. */
export const fieldRef = (label: string, field: string, value: string, testId?: string): TemplateResult | string => {
	const persistedAs = edgeRecordType(label, field);
	return persistedAs ? recordRef(persistedAs, value, value, testId) : value;
};

/** An instance's origin as a link to it: an address the browser opens, not a record a pane shows, so the elements under
 *  the link don't take the click. */
export const originLink = (origin: string): TemplateResult => html`<a href=${origin} target="_blank" rel="noopener" @click=${(e: Event) => e.stopPropagation()}>${origin}</a>`;

/** A domain, by its key, as a link to its view: the view of the type it persists as, or of the domain itself. */
export const domainRef = (key: string, testId?: string): TemplateResult => refTpl(REF_DENOTES.type, { domain: findDomain(key)?.persistedAs ?? key }, key, testId);

/** A step, by its method, as a link to the step as actuality declares it. */
export const stepRef = (method: string, text?: string, testId?: string): TemplateResult => refTpl("step", { method }, text ?? method, testId);

/** An action a caller holds or a step requires, as a link to what it allows. */
export const actionRef = (action: string, testId?: string): TemplateResult => refTpl("action", { action }, action, testId);

/** What a step's record says it called, as a link to that step. */
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
const refSeqPath = (seqPath: number[], text?: string): string => renderRef("seqPath", { seqPath }, text ?? seqPath.join("."));

export const refDomain = (domain: string, text?: string): string => renderRef("domain", { domain }, text ?? domain);

/** A fact's id as a link to the step that produced it: a fact's id is that step's seqPath, and for one field of its
 *  product, the field. Any other id is text. */
export const factIdRef = (id: string): string => {
	const seqPath = factSeqPath(id);
	return seqPath ? refSeqPath(seqPath, id) : `<code>${esc(id)}</code>`;
};
