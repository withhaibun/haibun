/**
 * <shu-index-summary> — what the index is showing, in one line, for the spine it collapses to.
 *
 * The index is a search: a type, some text, some conditions, an access level, and a number of results. Collapsed,
 * there is no room for the results, but there is room to say which search they came from and how many there are, so
 * the strip still answers what is behind it.
 *
 * It is told by the same CONTEXT_CHANGE the index already publishes for the actions bar, so nothing new is dispatched
 * for the spine. Other columns publish that context too, and theirs is a different search; only the index's own is
 * read here, which is why the source is checked rather than the event alone.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { SHU_EVENT } from "../consts.js";
import { describeSearch } from "./shu-search-summary.js";
import type { TViewQuery } from "../view-query.js";

const EmptySchema = z.object({});

/** The tag whose context is the index's. A context published by any other column describes a different search. */
const INDEX_TAG = "SHU-GRAPH-QUERY";

/** What the index publishes about the search it is showing. */
type TIndexContext = { label?: string | null; textQuery?: string | null; conditions?: TViewQuery["f"]; accessLevel?: string; total?: number };

export class ShuIndexSummary extends ShuElement<typeof EmptySchema> {
	/** A one-line reading of a view the model can already read in full when the index is open. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

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

	private context: TIndexContext | null = null;

	constructor() {
		super(EmptySchema, {});
	}

	protected override onConnected(): void {
		// The index is not an ancestor of this element (it renders into the pane from outside it), so its context does
		// not bubble through here. The document is where both meet.
		this.autoListen(document, SHU_EVENT.CONTEXT_CHANGE, (e: Event) => {
			if ((e.target as Element | null)?.tagName !== INDEX_TAG) return;
			this.context = (e as CustomEvent).detail ?? null;
			this.requestUpdate();
		});
	}

	render(): TemplateResult {
		const c = this.context;
		if (!c) return html``;
		const described = describeSearch({ label: c.label ?? null, q: c.textQuery ?? null, f: c.conditions ?? [], access: c.accessLevel } as TViewQuery);
		return html`${described}${described ? " · " : ""}<span class="count">${c.total ?? 0}</span>`;
	}
}

customElements.define("shu-index-summary", ShuIndexSummary);
