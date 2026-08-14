/**
 * <shu-ref> — a clickable reference to a navigable pane. Every panel that
 * surfaces a structured identifier (seqPath, entity id, domain key, step
 * descriptor) uses this component for click-through to the referenced view.
 * Centralising the click → PaneState routing here
 * keeps the link vocabulary consistent: panels emit `<shu-ref kind="…">`
 * markup and never wire their own click handlers.
 *
 * Attributes:
 *   kind        — "seqPath" | "entity" | "domain" | "step"
 *   linkTarget  — JSON describing the target. Shape varies by kind:
 *                 seqPath → `{ "seqPath": [0,1,2] }`
 *                 entity  → `{ "persistedAs": "Issuer", "id": "..." }`
 *                 step    → `{ "stepperName": "...", "stepName": "..." }`
 *                 domain  — `{ "domain": "..." }`
 *   text        — display label (defaults to a derived label per kind)
 *
 * Click opens the corresponding pane via the shared `PaneState` so the
 * referenced view appears in the column strip, mirroring every other
 * link-driven navigation in the SPA.
 */
import { html, nothing, type TemplateResult } from "lit";
import { parseSeqPath } from "@haibun/core/lib/seq-path.js";
import { esc } from "../util.js";
import { openRef, isRefKind, refHref, defaultLabel, renderRef, type TRefKind } from "./ref-navigation.js";

// The string form of a reference lives with the router, free of any DOM class; re-exported here so its long-standing callers are unmoved.

export class ShuRef extends HTMLElement {
	connectedCallback(): void {
		if (!this.shadowRoot) this.attachShadow({ mode: "open" });
		this.render();
		this.addEventListener("click", this.handleClick);
	}

	disconnectedCallback(): void {
		this.removeEventListener("click", this.handleClick);
	}

	static observedHtmlAttributes = ["kind", "linkTarget", "text"];

	attributeChangedCallback(): void {
		if (this.shadowRoot) this.render();
	}

	private handleClick = (e: Event): void => {
		e.preventDefault();
		e.stopPropagation();
		const kind = this.getAttribute("kind") ?? "";
		const targetRaw = this.getAttribute("linkTarget") ?? "{}";
		if (!isRefKind(kind)) return;
		let target: Record<string, unknown>;
		try {
			target = JSON.parse(targetRaw) as Record<string, unknown>;
		} catch {
			return;
		}
		// Pass the click event as the source so the open routes through PaneState.requestFrom (Miller-column: replaces
		// the unpinned column to the source's right) — the one path every column open uses, not a second implementation.
		openRef(e, kind, target);
	};

	private render(): void {
		if (!this.shadowRoot) return;
		const kind = this.getAttribute("kind") ?? "";
		const text = this.getAttribute("text") ?? defaultLabel(kind, this.getAttribute("linkTarget"));
		// A real href — the address of the thing itself. An anchor without one is not a link: it takes role/tabindex to
		// imitate one, and the browser can neither open it in a tab, copy its address, nor preview it. Clicking still
		// routes through openRef, which opens the pane beside this one rather than navigating.
		const href = this.hrefForRef();
		this.shadowRoot.innerHTML = `<style>
			:host { display: inline; }
			a { color: var(--shu-link); text-decoration: none; cursor: pointer; }
			a:hover { text-decoration: underline; }
			code { font-family: var(--shu-font-family); font-size: 0.95em; }
		</style><a${href ? ` href="${esc(href)}"` : ' role="link" tabindex="0"'}><code>${esc(text)}</code></a>`;
	}

	/** The address of this reference's target, or undefined for a kind with no pane (which stays a non-link). */
	private hrefForRef(): string | undefined {
		const kind = this.getAttribute("kind") ?? "";
		if (!isRefKind(kind)) return undefined;
		try {
			return refHref(kind, JSON.parse(this.getAttribute("linkTarget") ?? "{}") as Record<string, unknown>);
		} catch {
			return undefined; // a malformed linkTarget already renders inert; handleClick refuses it too
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

/**
 * Convenience wrappers — each panel typically calls just one or two of these.
 */
export const refSeqPath = (seqPath: number[], text?: string): string => renderRef("seqPath", { seqPath }, text ?? seqPath.join("."));

export const refDomain = (domain: string, text?: string): string => renderRef("domain", { domain }, text ?? domain);

/**
 * Render a fact-id reference. Typed-fact subjects produced by `dispatchStep`
 * are seqPaths (dot-joined integers including a `-1` for the run root); other
 * fact subjects are plain identifiers. Numeric-segment strings link as
 * step-detail; anything else renders as a non-clickable code span.
 */
export const factIdRef = (id: string): string => {
	const seqPath = parseSeqPath(id);
	if (seqPath) return refSeqPath(seqPath, id);
	return `<code>${esc(id)}</code>`;
};
