/**
 * <shu-ref>: a link to the view of a structured identifier (seqPath, entity id, domain key, step, action). Every
 * panel that shows one uses this component, so the link vocabulary stays consistent: panels emit `<shu-ref kind="…">`
 * markup and never wire their own click handlers. The link's href is the address of the referenced pane, which the page
 * follows (`followPaneLink`), opening it beside the pane it was clicked in.
 *
 * Attributes:
 *   kind: "seqPath" | "entity" | "domain" | "step" | "action"
 *   linkTarget: JSON describing the target. Shape varies by kind:
 *                 seqPath → `{ "seqPath": [0,1,2] }`
 *                 entity  → `{ "persistedAs": "Issuer", "id": "..." }`
 *                 step    → `{ "method": "..." }`
 *                 action  → `{ "action": "..." }`
 *                 domain: `{ "domain": "..." }`
 *   text: display label (defaults to a derived label per kind)
 */
import { html, nothing, type TemplateResult } from "lit";
import { calledParts, factSeqPath } from "@haibun/core/lib/seq-path.js";
import { esc } from "../util.js";
import { DENOTES, REF_DENOTES } from "@haibun/core/lib/typed-links.js";
import { isRefKind, refHref, defaultLabel, renderRef, type TRefKind } from "./ref-navigation.js";
import type { TContextPattern } from "../schemas.js";
import { findDomain } from "../rpc-registry.js";
import { stepMethodName } from "@haibun/core/lib/step-registry.js";

export class ShuRef extends HTMLElement {
	connectedCallback(): void {
		if (!this.shadowRoot) this.attachShadow({ mode: "open" });
		this.render();
	}

	static observedHtmlAttributes = ["kind", "linkTarget", "text"];

	attributeChangedCallback(): void {
		if (this.shadowRoot) this.render();
	}

	private render(): void {
		if (!this.shadowRoot) return;
		const kind = this.getAttribute("kind") ?? "";
		const text = this.getAttribute("text") ?? defaultLabel(kind, this.getAttribute("linkTarget"));
		// A real href: the address of the thing itself, which the browser can open in a tab, copy and preview. A kind
		// with no pane is text, not a link that goes nowhere.
		const href = this.hrefForRef();
		const code = `<code>${esc(text)}</code>`;
		this.shadowRoot.innerHTML = `<style>
			:host { display: inline; }
			a { color: var(--shu-link); text-decoration: none; }
			a:hover { text-decoration: underline; }
			code { font-family: var(--shu-font-family); font-size: 0.95em; }
		</style>${href ? `<a href="${esc(href)}">${code}</a>` : code}`;
	}

	/** The address of this reference's target, or undefined for a kind with no pane. */
	private hrefForRef(): string | undefined {
		const kind = this.getAttribute("kind") ?? "";
		if (!isRefKind(kind)) return undefined;
		try {
			return refHref(kind, JSON.parse(this.getAttribute("linkTarget") ?? "{}") as Record<string, unknown>);
		} catch {
			return undefined; // a malformed linkTarget renders as text
		}
	}
}

/**
 * The lit form of the same reference, for a view that renders a template rather than a string of markup: one place
 * decides what a reference is made of, so a panel writing `<shu-ref>` by hand cannot drift from what `renderRef`
 * writes. The display text is also child text, as in the string form, so a surface where the element is undefined
 * shows the text rather than nothing.
 */
export const refTpl = (kind: TRefKind, linkTarget: Record<string, unknown>, text?: string, testId?: string): TemplateResult => {
	const targetJson = JSON.stringify(linkTarget);
	const display = text ?? defaultLabel(kind, targetJson);
	return html`<shu-ref data-testid=${testId ?? nothing} kind=${kind} linkTarget=${targetJson} text=${display}>${display}</shu-ref>`;
};

/** A domain, by its key, as a link to its view: the view of the type it persists as, or of the domain itself. */
export const domainRef = (key: string, testId?: string): TemplateResult => refTpl(REF_DENOTES.type, { domain: findDomain(key)?.persistedAs ?? key }, key, testId);

/** A step, by its method, as a link to the step as the run declares it. */
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
export const refSeqPath = (seqPath: number[], text?: string): string => renderRef("seqPath", { seqPath }, text ?? seqPath.join("."));

export const refDomain = (domain: string, text?: string): string => renderRef("domain", { domain }, text ?? domain);

/** A fact's id as a link to the step that produced it: a fact's id is that step's seqPath, and for one field of its
 *  product, the field. Any other id is text. */
export const factIdRef = (id: string): string => {
	const seqPath = factSeqPath(id);
	return seqPath ? refSeqPath(seqPath, id) : `<code>${esc(id)}</code>`;
};
