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
import { esc, escAttr } from "../util.js";
import { PaneState } from "../pane-state.js";

const REF_KIND = ["seqPath", "entity", "domain", "step"] as const;
type TRefKind = (typeof REF_KIND)[number];

function isRefKind(v: string): v is TRefKind {
	return (REF_KIND as readonly string[]).includes(v);
}

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
		const text = this.getAttribute("text") ?? defaultLabel(this.getAttribute("kind"), this.getAttribute("linkTarget"));
		this.shadowRoot.innerHTML = `<style>
			:host { display: inline; }
			a { color: var(--shu-link); text-decoration: none; cursor: pointer; }
			a:hover { text-decoration: underline; }
			code { font-family: var(--shu-font-family); font-size: 0.95em; }
		</style><a role="link" tabindex="0"><code>${esc(text)}</code></a>`;
	}
}

/**
 * Render the inline HTML markup for a reference. Use this from any panel that
 * surfaces a structured identifier instead of formatting a bare `<code>` tag.
 */
export function renderRef(kind: TRefKind, linkTarget: Record<string, unknown>, text?: string): string {
	const targetJson = JSON.stringify(linkTarget);
	const display = text ?? defaultLabel(kind, targetJson);
	return `<shu-ref kind="${escAttr(kind)}" linkTarget="${escAttr(targetJson)}" text="${escAttr(display)}"></shu-ref>`;
}

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

function parseSeqPath(id: string): number[] | null {
	if (!/^-?\d+(\.-?\d+)*$/.test(id)) return null;
	return id.split(".").map((p) => Number.parseInt(p, 10));
}

function defaultLabel(kind: string | null, targetJson: string | null): string {
	if (!kind || !targetJson) return "";
	try {
		const target = JSON.parse(targetJson) as Record<string, unknown>;
		if (kind === "seqPath" && Array.isArray(target.seqPath)) return (target.seqPath as number[]).join(".");
		if (kind === "entity" && typeof target.id === "string") return target.id;
		if (kind === "domain" && typeof target.domain === "string") return target.domain;
		if (kind === "step" && typeof target.stepperName === "string" && typeof target.stepName === "string") return `${target.stepperName}.${target.stepName}`;
	} catch {
		// fallthrough
	}
	return "";
}

function openRef(source: Element | Event, kind: TRefKind, linkTarget: Record<string, unknown>): void {
	if (kind === "seqPath" && Array.isArray(linkTarget.seqPath)) {
		// Typed-fact subjects ARE seqPaths, so a seqPath ref doubles as the
		// quad-view link: step-detail loads every quad emitted at that seqPath
		// (including the fact), drillable into individual quads from there.
		PaneState.requestFrom(source, { paneType: "step-detail", seqPath: linkTarget.seqPath as number[] });
		return;
	}
	if (kind === "entity" && typeof linkTarget.persistedAs === "string" && typeof linkTarget.id === "string") {
		PaneState.requestFrom(source, { paneType: "entity", persistedAs: linkTarget.persistedAs, id: linkTarget.id });
		return;
	}
	if (kind === "domain" && typeof linkTarget.domain === "string") {
		// A type reference opens the type column: its description, schema graph, and individuals.
		PaneState.requestFrom(source, { paneType: "type", persistedAs: linkTarget.domain });
		return;
	}
	// step kind: no dedicated pane yet — fall through (no-op), so the component
	// renders as a non-functional link rather than crashing.
}
