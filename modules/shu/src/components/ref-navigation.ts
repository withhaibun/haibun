/**
 * The one hypermedia navigation router, kept free of any custom-element (HTMLElement) definition so it is importable in
 * any context, a component, a graph click handler, a node test, without dragging a DOM class into the module graph.
 * A link is an anchor whose href is the address of a pane (`paneHref`), and the page follows its own addresses
 * (`followPaneLink`): a click opens the addressed pane beside the one it was clicked in. A typed reference (seqPath /
 * entity / domain / step) is addressed through `refHref`, and a view that isn't an anchor, a row or a card, opens the
 * same pane with `openRef`.
 */
import { esc, escAttr } from "../util.js";
import { PaneState, addsToSelection, columnEntryOf, parseColEntry, type DesiredPane } from "../pane-state.js";
import { ACTIVE_PARAM, COLUMN_PARAM, hashParams, hashWithColumns, mergeHashParams } from "../view-hash.js";
import { DEEP_LINK_PREFIX } from "../consts.js";
import { QuoteAnchorSchema } from "@haibun/core/lib/resources.js";
import { REF_DENOTES } from "@haibun/core/lib/typed-links.js";

export const REF_KIND = ["seqPath", REF_DENOTES.individual, REF_DENOTES.type, "step", "action"] as const;
export type TRefKind = (typeof REF_KIND)[number];

export function isRefKind(v: string | undefined): v is TRefKind {
	return v !== undefined && (REF_KIND as readonly string[]).includes(v);
}

/** The pane a reference opens. ONE reading of (kind, linkTarget), so what a ref's href addresses is what clicking it
 *  opens: a second reading would drift, and the href would then advertise the wrong destination. */
export function desiredPaneFor(kind: TRefKind, linkTarget: Record<string, unknown>): DesiredPane | null {
	// Typed-fact subjects ARE seqPaths, so a seqPath ref doubles as the quad-view link: step-detail loads every quad
	// emitted at that seqPath (including the fact), drillable into individual quads from there.
	if (kind === "seqPath" && Array.isArray(linkTarget.seqPath)) return { paneType: "step-detail", seqPath: linkTarget.seqPath as number[] };
	if (kind === REF_DENOTES.individual && typeof linkTarget.persistedAs === "string" && typeof linkTarget.id === "string") {
		// A quote selector addresses a passage INSIDE the individual (a Text Fragment ref); the pane identity stays the
		// individual: same document, same column, and the selector rides along for the column to reveal.
		const parsed = QuoteAnchorSchema.safeParse(linkTarget.selector);
		const selector = parsed.success ? parsed.data : undefined;
		return { paneType: "entity", persistedAs: linkTarget.persistedAs, id: linkTarget.id, ...(selector ? { selector } : {}) };
	}
	// A type reference opens the type column: its description, schema graph, and individuals.
	if (kind === REF_DENOTES.type && typeof linkTarget.domain === "string") return { paneType: "type", persistedAs: linkTarget.domain };
	// A step reference opens the step as the run declares it.
	if (kind === "step" && typeof linkTarget.method === "string") return { paneType: "step", method: linkTarget.method };
	// An action reference opens what the action allows.
	if (kind === "action" && typeof linkTarget.action === "string") return { paneType: "action", action: linkTarget.action };
	return null;
}

/** The address of a pane, written as the address bar writes a column, so a link to it can be opened in a tab, copied
 *  and previewed. */
export function paneHref(desired: DesiredPane): string {
	return hashWithColumns([columnEntryOf(desired)]);
}

/** What a link in the page addresses: the pane its one column names, and the view state its other params set. */
export type TDeepLink = { pane: DesiredPane; state: Record<string, string> };

/** What a link addresses, or null for an href that doesn't name one pane, which the browser follows. A hash that names the
 *  active pane is a layout of the page rather than a link to a view. */
export function deepLinkOf(href: string): TDeepLink | null {
	if (!href.startsWith(DEEP_LINK_PREFIX)) return null;
	const params = hashParams(href);
	if (params.has(ACTIVE_PARAM)) return null;
	const columns = params.getAll(COLUMN_PARAM);
	const pane = columns.length === 1 ? parseColEntry(columns[0]) : null;
	if (!pane) return null;
	params.delete(COLUMN_PARAM);
	return { pane, state: Object.fromEntries(params) };
}

/** Follow a link: set the view state it names, then open its pane beside the one it was followed from. */
export function followDeepLink(from: Element | Event, link: TDeepLink, addToSelection = false): void {
	if (Object.keys(link.state).length > 0) mergeHashParams(link.state);
	PaneState.requestFrom(from, link.pane, addToSelection);
}

/**
 * The address of what a reference points at: the view showing that one thing. Clicking does not navigate there: the
 * page opens the pane beside the one it was clicked from (Miller-column), which is a different, composite address. So
 * this addresses the thing itself, not the reader's resulting column set.
 */
export function refHref(kind: TRefKind, linkTarget: Record<string, unknown>): string | undefined {
	const desired = desiredPaneFor(kind, linkTarget);
	return desired ? paneHref(desired) : undefined;
}

/** Follow a click on a link to a pane, in the capture phase at the page's root: the pane opens beside the one the link
 *  was clicked in, and the elements under the link don't take the click. A link to anything else is left to the browser. */
export function followPaneLink(e: MouseEvent): void {
	if (e.button !== 0) return;
	const link = e.composedPath().find((target): target is HTMLAnchorElement => target instanceof HTMLAnchorElement);
	const addressed = link ? deepLinkOf(link.getAttribute("href") ?? "") : null;
	if (!addressed) return;
	e.preventDefault();
	e.stopPropagation();
	followDeepLink(e, addressed, addsToSelection(e));
}

/** Open what a reference points at from a view that isn't a link. */
export function openRef(source: Element | Event, kind: TRefKind, linkTarget: Record<string, unknown>, addToSelection = false): void {
	const desired = desiredPaneFor(kind, linkTarget);
	if (!desired) throw new Error(`a ${kind} reference to ${JSON.stringify(linkTarget)} doesn't address a pane`);
	PaneState.requestFrom(source, desired, addToSelection);
}

/** The inline markup for a link to a pane, for a view that renders a string of markup: an anchor whose href is the
 *  pane's address. Without an address, the text alone. */
export function linkHtml(href: string | undefined, text: string, attrs = "", linkClass = "col-link"): string {
	return href ? `<a class="${linkClass}" href="${escAttr(href)}"${attrs}>${esc(text)}</a>` : esc(text);
}

/** The text a reference shows when its caller doesn't name one: the identifier itself, read out of the target. */
export function defaultLabel(kind: string | null, targetJson: string | null): string {
	if (!kind || !targetJson) return "";
	const target = JSON.parse(targetJson) as Record<string, unknown>;
	if (kind === "seqPath" && Array.isArray(target.seqPath)) return (target.seqPath as number[]).join(".");
	if (kind === REF_DENOTES.individual && typeof target.id === "string") return target.id;
	if (kind === REF_DENOTES.type && typeof target.domain === "string") return target.domain;
	if (kind === "step" && typeof target.method === "string") return target.method;
	if (kind === "action" && typeof target.action === "string") return target.action;
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
	// then shows the text instead of an empty element. The defined element's shadow root doesn't have a slot, so it never doubles.
	return `<shu-ref kind="${escAttr(kind)}" linkTarget="${escAttr(targetJson)}" text="${escAttr(display)}">${esc(display)}</shu-ref>`;
}
