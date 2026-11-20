/**
 * The one hypermedia navigation router, kept free of any custom-element (HTMLElement) definition so it is importable in
 * any context, a component, a graph click handler, a node test, without dragging a DOM class into the module graph.
 * A link is an anchor whose href is the address of a pane (`paneHref`), and the page follows its own addresses
 * (`followPaneLink`): a click opens the addressed pane beside the one in which it was clicked. A typed reference (seqPath /
 * entity / domain / step / action) is addressed through `refHref`, and a view that isn't an anchor, a row or a card, opens the
 * same pane with `openRef`.
 */
import { ACTIVE_PARAM, COLUMN_PARAM, hashParams, hashWithColumns } from "../derivations/address.js";
import { mergeHashParams } from "../controllers/hash-controller.js";
import { DEEP_LINK_PREFIX } from "../../domains/elements.js";
import { formatRecordName } from "@haibun/core/lib/seq-path.js";
import { readingActualityFeature } from "../client-cache/controllers/device-controller.js";
import { REF_DENOTES } from "@haibun/core/lib/domains/typed-links.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { html, nothing, type TemplateResult } from "lit";
import { stepPathOf, type TNamedRef, type TRef, type TRefTarget } from "../derivations/markdown.js";
import { paneOfEntry, requestPaneFrom } from "../controllers/pane-controller.js";
import { addsToSelection, columnEntryOf, type DesiredPane } from "../derivations/pane-kinds.js";
import { typeShownIn } from "../controllers/catalog-controller.js";
import type { TEvidence } from "../domains/claims.js";
import { SHU_TAG } from "../../domains/elements.js";

/** The class of a link that opens a pane in the column browser. */
const COL_LINK = "col-link";

/** The pane each kind of reference to a record opens. A part of an individual addresses a passage or a fragment of media inside
 *  it, so the pane stays the individual's and the part rides along. A type opens the type column, a step its declaration, and
 *  an action what it allows. */
const PANE_OF: { [K in TNamedRef["kind"]]: (target: TRefTarget<K>) => DesiredPane } = {
	[REF_DENOTES.individual]: ({ persistedAs, id, selector }) => ({ paneType: "entity", persistedAs, id, ...(selector === undefined ? {} : { selector }) }),
	[REF_DENOTES.type]: ({ domain }) => ({ paneType: "type", persistedAs: domain }),
	step: ({ method }) => ({ paneType: "step", method }),
	action: ({ action }) => ({ paneType: "action", action }),
};

/** The pane a reference opens. ONE reading of a reference, so what a ref's href addresses is what clicking it opens: a second
 *  reading would drift, and the href would then advertise the wrong destination. A step is a record, named by the actuality
 *  feature being read and its path, and opens as its record's view (CA4D9); a typed fact's subject is its step's path, so a
 *  reference to a fact's step opens the step that produced it, and before the page reads an actuality feature a step's path
 *  doesn't name a record. */
export function desiredPaneFor(ref: TRef): DesiredPane | null {
	const path = stepPathOf(ref);
	if (path === undefined) return (PANE_OF[(ref as TNamedRef).kind] as (target: TRef["target"]) => DesiredPane)(ref.target);
	const actualityFeature = readingActualityFeature();
	return actualityFeature === undefined ? null : { paneType: "entity", persistedAs: typeShownIn(SHU_TAG.STEP_DETAIL), id: formatRecordName({ actuality: actualityFeature, path }) };
}

/** The address of a pane, written as the address bar writes a column, so a link to it can be opened in a tab, copied
 *  and previewed. */
export function paneHref(desired: DesiredPane): string {
	return hashWithColumns([columnEntryOf(desired)]);
}

/** What a link in the page addresses: the pane its one column names, and the view state its other params set. */
type TDeepLink = { pane: DesiredPane; state: Record<string, string> };

/** What a link addresses, or null for an href that doesn't name one pane, which the browser follows. A hash that names the
 *  active pane is a layout of the page rather than a link to a view. */
export function deepLinkOf(href: string): TDeepLink | null {
	if (!href.startsWith(DEEP_LINK_PREFIX)) return null;
	const params = hashParams(href);
	if (params.has(ACTIVE_PARAM)) return null;
	const columns = params.getAll(COLUMN_PARAM);
	const pane = columns.length === 1 ? paneOfEntry(itemAt(columns, 0)) : null;
	if (!pane) return null;
	params.delete(COLUMN_PARAM);
	return { pane, state: Object.fromEntries(params) };
}

/** Follow a link: set the view state it names, then open its pane beside the one from which it was followed. */
export function followDeepLink(from: Element | Event, link: TDeepLink, addToSelection = false): void {
	if (Object.keys(link.state).length > 0) mergeHashParams(link.state);
	requestPaneFrom(from, link.pane, addToSelection);
}

/**
 * The address of what a reference points at: the view showing that one thing. Clicking does not navigate there: the
 * page opens the pane beside the one it was clicked from (Miller-column), which is a different, composite address. So
 * this addresses the thing itself, not the reader's resulting column set.
 */
export function refHref(ref: TRef): string | undefined {
	const desired = desiredPaneFor(ref);
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
export function openRef(source: Element | Event, ref: TRef, addToSelection = false): void {
	const desired = desiredPaneFor(ref);
	if (!desired) throw new Error(`a ${ref.kind} reference to ${JSON.stringify(ref.target)} doesn't address a pane`);
	requestPaneFrom(source, desired, addToSelection);
}

/** The address of the passage `evidence` quotes: its source's pane, opened with the passage selected. */
export const passageHref = ({ quote, source }: TEvidence): string | undefined =>
	refHref({ kind: REF_DENOTES.individual, target: { persistedAs: source.label, id: source.id, selector: quote } });

/** The name of a link to the passage that quotes `what`, by where the passage is and the step that extracted it. */
export const passageName = (what: string, { source, extractedBy }: TEvidence): string =>
	`${what} as ${source.label} ${source.id} quotes it${extractedBy === undefined ? "" : `, which step ${extractedBy} extracted`}`;

/** What a link to a pane states beside its address: its test id, its accessible name where its text alone doesn't state where it
 *  goes, and its class where it isn't a column link. */
export type TLinkAttributes = { readonly testId?: string; readonly label?: string; readonly linkClass?: string };

/** A link to a pane: an anchor whose href is the pane's address. Without an address, the text alone. */
export const linkTpl = (href: string | undefined, text: string, attributes?: TLinkAttributes): TemplateResult | string => {
	if (href === undefined) return text;
	const linkClass = attributes?.linkClass === undefined ? COL_LINK : attributes.linkClass;
	return html`<a class=${linkClass} href=${href} data-testid=${attributes?.testId ?? nothing} aria-label=${attributes?.label ?? nothing}>${text}</a>`;
};
