/**
 * The one hypermedia navigation router, kept free of any custom-element (HTMLElement) definition so it is importable in
 * any context, a component, a graph click handler, a node test, without dragging a DOM class into the module graph.
 * A link is an anchor whose href is the address of a pane (`paneHref`), and the page follows its own addresses
 * (`followPaneLink`): a click opens the addressed pane beside the one in which it was clicked. A typed reference (seqPath /
 * entity / domain / step) is addressed through `refHref`, and a view that isn't an anchor, a row or a card, opens the
 * same pane with `openRef`.
 */
import { ACTIVE_PARAM, COLUMN_PARAM, hashParams, hashWithColumns } from "../derivations/address.js";
import { mergeHashParams } from "../controllers/hash-controller.js";
import { DEEP_LINK_PREFIX } from "../../domains/elements.js";
import { PartSchema } from "@haibun/core/lib/domains/resources.js";
import { ActionSchema } from "@haibun/core/lib/domains/actions.js";
import { StepMethodSchema } from "@haibun/core/lib/steps/domains/step-method.js";
import { formatRecordName } from "@haibun/core/lib/seq-path.js";
import { readingActualityFeature } from "../client-cache/controllers/device-controller.js";
import { REF_DENOTES } from "@haibun/core/lib/domains/typed-links.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { esc, escAttr, stepPathOf, type TRefKind } from "../derivations/markdown.js";
import { paneOfEntry, requestPaneFrom } from "../controllers/pane-controller.js";
import { addsToSelection, columnEntryOf, type DesiredPane } from "../derivations/pane-kinds.js";
import { typeShownIn } from "../controllers/catalog-controller.js";
import { SHU_TAG } from "../../domains/elements.js";

/** The pane a reference opens. ONE reading of (kind, linkTarget), so what a ref's href addresses is what clicking it
 *  opens: a second reading would drift, and the href would then advertise the wrong destination. */
export function desiredPaneFor(kind: TRefKind, linkTarget: Record<string, unknown>): DesiredPane | null {
	// A step is a record, named by the actuality feature being read and its path, and opens as its record's view (CA4D9). A typed
	// fact's subject is its step's path, so a reference to a fact's step opens the step that produced it. Before the page
	// reads an actuality feature, a step's path doesn't name a record.
	const path = stepPathOf(kind, linkTarget);
	if (path !== undefined) {
		const actualityFeature = readingActualityFeature();
		return actualityFeature === undefined
			? null
			: { paneType: "entity", persistedAs: typeShownIn(SHU_TAG.STEP_DETAIL), id: formatRecordName({ actuality: actualityFeature, path }) };
	}
	if (kind === REF_DENOTES.individual && typeof linkTarget.persistedAs === "string" && typeof linkTarget.id === "string") {
		// A part addresses a passage or a fragment of media INSIDE the individual; the pane identity stays the individual:
		// same document, same column, and the part rides along for the column to show.
		const parsed = PartSchema.safeParse(linkTarget.selector);
		const selector = parsed.success ? parsed.data : undefined;
		return { paneType: "entity", persistedAs: linkTarget.persistedAs, id: linkTarget.id, ...(selector ? { selector } : {}) };
	}
	// A type reference opens the type column: its description, schema graph, and individuals.
	if (kind === REF_DENOTES.type && typeof linkTarget.domain === "string") return { paneType: "type", persistedAs: linkTarget.domain };
	// A step reference opens the step as actuality declares it.
	if (kind === "step" && typeof linkTarget.method === "string") return { paneType: "step", method: StepMethodSchema.parse(linkTarget.method) };
	// An action reference opens what the action allows.
	if (kind === "action" && typeof linkTarget.action === "string") return { paneType: "action", action: ActionSchema.parse(linkTarget.action) };
	return null;
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
	requestPaneFrom(source, desired, addToSelection);
}

/** The inline markup for a link to a pane, for a view that renders a string of markup: an anchor whose href is the
 *  pane's address. Without an address, the text alone. */
export function linkHtml(href: string | undefined, text: string, attrs = "", linkClass = "col-link"): string {
	return href ? `<a class="${linkClass}" href="${escAttr(href)}"${attrs}>${esc(text)}</a>` : esc(text);
}
