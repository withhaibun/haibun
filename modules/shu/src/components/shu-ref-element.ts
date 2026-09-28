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
import { SHU_TAG } from "../consts.js";
import { defineElement } from "../define-element.js";
import { esc } from "../util.js";
import { isRefKind, refHref, defaultLabel } from "./ref-navigation.js";

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
		// without a pane is text, not a link that doesn't lead to a pane.
		const href = this.hrefForRef();
		const code = `<code>${esc(text)}</code>`;
		this.shadowRoot.innerHTML = `<style>
			:host { display: inline; }
			a { color: var(--shu-link); text-decoration: none; }
			a:hover { text-decoration: underline; }
			code { font-family: var(--shu-font-family); font-size: 0.95em; }
		</style>${href ? `<a href="${esc(href)}">${code}</a>` : code}`;
	}

	/** The address of this reference's target, or undefined for a kind without a pane. */
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

defineElement(SHU_TAG.REF, ShuRef);
