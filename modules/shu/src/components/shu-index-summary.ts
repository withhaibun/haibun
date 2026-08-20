/**
 * <shu-index-summary> — what the index is showing, in one line, for the spine it collapses to.
 *
 * The index is a search: a type, some text, some conditions, an access level, and a number of results. Collapsed,
 * there is no room for the results, but there is room to say which search they came from and how many there are, so
 * the strip still answers what is behind it.
 *
 * The search itself is the shared `viewQuery`, read in render: ShuElement is a SignalWatcher, so reading it there
 * subscribes this view to it and the strip follows the search without being told about it. The count is not part of
 * the query — it is what the index found — so that one number comes from the context the index already publishes for
 * the actions bar. Other columns publish that context too, about their own subject, which is why the source is
 * checked rather than the event alone.
 */
import { html, css, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { SHU_EVENT } from "../consts.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { describeSearch } from "./shu-search-summary.js";
import { ShuGraphQuery } from "./shu-graph-query.js";
import { viewQuery } from "../view-query.js";

const EmptySchema = z.object({});

/** What the strip says the column is. The index pane carries no label — an open index shows no header — so the strip
 *  would otherwise be the only column that does not say what it is. */
const INDEX_NAME = "Index";

export class ShuIndexSummary extends ShuElement<typeof EmptySchema> {
	/** A one-line reading of a view the model can already read in full when the index is open. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static schema = EmptySchema;
	static domainSelector = "shu-index-summary";

	static styles = [
		shuBaseStyles,
		css`
		/* Down the strip, the same turn the pane gives its label, so the summary reads as a continuation of it. */
		:host {
			display: block; writing-mode: vertical-lr; text-orientation: mixed;
			padding: var(--shu-space-2) 0;
			font: var(--shu-font-sm) var(--shu-font-family); color: var(--shu-fg-muted);
			overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		}
		.count { color: var(--shu-fg); font-weight: 500; }
	`,
	];

	/** How many the index found. Not in the query — the query says what was asked, this says what came back. */
	@state() private accessor found: number | null = null;

	constructor() {
		super(EmptySchema, {});
	}

	protected override onConnected(): void {
		// The index is not an ancestor of this element (it renders into the pane from outside it), so its context does
		// not bubble through here. The document is where both meet.
		this.autoListen(document, SHU_EVENT.CONTEXT_CHANGE, (e: Event) => {
			if ((e.target as Element | null)?.tagName.toLowerCase() !== ShuGraphQuery.domainSelector) return;
			const total = (e as CustomEvent).detail?.total;
			this.found = typeof total === "number" ? total : null;
		});
	}

	render(): TemplateResult {
		// Which column, then which search, then how many it found — in that order, so the strip answers what it is
		// before it answers what is in it, and still says what it is before any search has been made.
		const said = [INDEX_NAME, describeSearch(viewQuery.current)].filter(Boolean).join(" · ");
		return html`<span data-testid=${SHU_TEST_IDS.INDEX_SUMMARY.ROOT}
			>${said}${this.found === null ? "" : html` · <span class="count">${this.found}</span>`}</span
		>`;
	}
}

customElements.define(ShuIndexSummary.domainSelector, ShuIndexSummary);
