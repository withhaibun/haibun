/**
 * The one hypermedia navigation router, kept free of any custom-element (HTMLElement) definition so it is importable in
 * any context — a component, a graph click handler, a node test — without dragging a DOM class into the module graph.
 * Maps a typed reference (seqPath / entity / domain / step) to the pane it opens via PaneState.requestFrom, so every
 * node/link navigation routes through one place and the link vocabulary stays consistent. The <shu-ref> element and the
 * graph views both call openRef; none reimplements the routing.
 */
import { esc, escAttr } from "../util.js";
import { PaneState, paneIdOf, type DesiredPane } from "../pane-state.js";
import { QuoteAnchorSchema } from "@haibun/core/lib/resources.js";

export const REF_KIND = ["seqPath", "entity", "domain", "step"] as const;
export type TRefKind = (typeof REF_KIND)[number];

export function isRefKind(v: string | undefined): v is TRefKind {
	return v !== undefined && (REF_KIND as readonly string[]).includes(v);
}

/** The pane a reference opens. ONE reading of (kind, linkTarget), so what a ref's href addresses is what clicking it
 *  opens — a second reading would drift, and the href would then advertise the wrong destination. */
export function desiredPaneFor(kind: TRefKind, linkTarget: Record<string, unknown>): DesiredPane | null {
	// Typed-fact subjects ARE seqPaths, so a seqPath ref doubles as the quad-view link: step-detail loads every quad
	// emitted at that seqPath (including the fact), drillable into individual quads from there.
	if (kind === "seqPath" && Array.isArray(linkTarget.seqPath)) return { paneType: "step-detail", seqPath: linkTarget.seqPath as number[] };
	if (kind === "entity" && typeof linkTarget.persistedAs === "string" && typeof linkTarget.id === "string") {
		// A quote selector addresses a passage INSIDE the individual (a Text Fragment ref); the pane identity stays the
		// individual — same document, same column — and the selector rides along for the column to reveal.
		const parsed = QuoteAnchorSchema.safeParse(linkTarget.selector);
		const selector = parsed.success ? parsed.data : undefined;
		return { paneType: "entity", persistedAs: linkTarget.persistedAs, id: linkTarget.id, ...(selector ? { selector } : {}) };
	}
	// A type reference opens the type column: its description, schema graph, and individuals.
	if (kind === "domain" && typeof linkTarget.domain === "string") return { paneType: "type", persistedAs: linkTarget.domain };
	// step kind: no dedicated pane yet.
	return null;
}

/**
 * The address of what a reference points at — the view showing that one thing, written exactly as the address bar
 * writes a column (`paneIdOf`). A reference is an anchor with this href, so it is a link in the plain HTML sense: it
 * can be focused, opened in a new tab, copied, and previewed — none of which an anchor without an href can do.
 *
 * Clicking does NOT navigate here: the ref opens the pane beside the one it was clicked from (Miller-column), which is
 * a different, composite address. So this addresses the thing itself, not the reader's resulting column set.
 */
export function refHref(kind: TRefKind, linkTarget: Record<string, unknown>): string | undefined {
	const desired = desiredPaneFor(kind, linkTarget);
	return desired ? `#?col=${encodeURIComponent(paneIdOf(desired))}` : undefined;
}

export function openRef(source: Element | Event, kind: TRefKind, linkTarget: Record<string, unknown>): void {
	const desired = desiredPaneFor(kind, linkTarget);
	// A kind with no pane (step) renders non-functional rather than crashing.
	if (desired) PaneState.requestFrom(source, desired);
}

/** The text a reference shows when its caller names none: the identifier itself, read out of the target. */
export function defaultLabel(kind: string | null, targetJson: string | null): string {
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

/**
 * The inline markup for a reference: the string form, kept here with the router rather than with the element that
 * renders it: a text or a table that names an individual builds this, and putting it behind the custom element drags a
 * DOM class into the import path of every module that formats one.
 */
export function renderRef(kind: TRefKind, linkTarget: Record<string, unknown>, text?: string): string {
	const targetJson = JSON.stringify(linkTarget);
	const display = text ?? defaultLabel(kind, targetJson);
	// The display text is also child text: a surface where the element is not defined (the sandboxed body iframe)
	// then shows the text instead of nothing. The defined element's shadow root has no slot, so it never doubles.
	return `<shu-ref kind="${escAttr(kind)}" linkTarget="${escAttr(targetJson)}" text="${escAttr(display)}">${esc(display)}</shu-ref>`;
}
