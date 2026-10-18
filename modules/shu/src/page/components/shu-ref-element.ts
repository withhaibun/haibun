/**
 * <shu-ref>: a link to the view of a structured identifier (a seqPath, a record, a domain, a step or an action). Each panel
 * that shows one uses this element, so the links read one way: a panel writes `<shu-ref kind="…">` markup and doesn't wire
 * its own click handler. The link's href is the address of the referenced pane, which the page follows (`followPaneLink`),
 * opening it beside the pane that holds the link.
 *
 * Attributes, which `renderRef` and `refTpl` write:
 *   kind: "seqPath" | "entity" | "domain" | "step" | "action"
 *   linkTarget: JSON that names the target, by kind: `{ "seqPath": [0,1,2] }`, `{ "persistedAs": "Issuer", "id": "…" }`,
 *               `{ "domain": "…" }`, `{ "method": "…" }` or `{ "action": "…" }`
 *   text: the words the link shows
 */
import { html, css, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { JsonObjectTextSchema } from "@haibun/core/lib/domains/json-text.js";
import { refHref } from "./ref-navigation.js";
import { isRefKind } from "../derivations/markdown.js";
import { ShuElement, EmptyStateSchema, type TLinkedData } from "./shu-element.js";

export class ShuRef extends ShuElement<typeof EmptyStateSchema> {
	/** A reference is part of the view that shows it, so it doesn't contribute to a conversation's context on its own. */
	summarizeForContext(): TLinkedData | null {
		return null;
	}

	static styles = css`
		:host { display: inline; }
		a { color: var(--shu-link); text-decoration: none; }
		a:hover { text-decoration: underline; }
		code { font-family: var(--shu-font-family); font-size: 0.95em; }
	`;

	@property() accessor kind = "";
	@property({ attribute: "linktarget" }) accessor linkTarget = "";
	@property() accessor text = "";

	constructor() {
		super(EmptyStateSchema);
	}

	/** The address of the reference's target, or undefined for a kind without a pane, or markup a body carries whose target
	 *  isn't a JSON object. */
	private href(): string | undefined {
		if (!isRefKind(this.kind)) return undefined;
		const target = JsonObjectTextSchema.safeParse(this.linkTarget);
		return target.success ? refHref(this.kind, target.data) : undefined;
	}

	render(): TemplateResult {
		if (this.kind === "" || this.linkTarget === "") throw new Error("<shu-ref> renders without its kind and its linkTarget, which renderRef and refTpl write");
		const href = this.href();
		const code = html`<code>${this.text}</code>`;
		return href === undefined ? code : html`<a href=${href}>${code}</a>`;
	}
}

defineElement(SHU_TAG.REF, ShuRef);
