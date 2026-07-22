/**
 * <shu-search-summary> — one committed search, recorded into the shared activity history. It holds the exact
 * `viewQuery` snapshot that produced the results; clicking it dispatches SEARCH_RESTORE and the app re-applies
 * that snapshot through shu-graph-query's `products` entry — restoring the search precisely (type, text,
 * filters, sort, access), the same round-trip the URL hash already proves out.
 *
 * Light DOM (an activity-history entry must be visible to test-id walks and text capture).
 */
import type { TemplateResult } from "lit";
import { html } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import type { TViewQuery } from "../view-query.js";

const EmptySchema = z.object({});

/** The human-readable one-line description of a search: type, text, per-field conditions, non-default access. */
export function describeSearch(q: TViewQuery): string {
	const parts: string[] = [];
	if (q.label) parts.push(q.label);
	if (q.q) parts.push(`"${q.q}"`);
	for (const c of q.f) if (c.predicate && c.value) parts.push(`${c.predicate} ${c.operator} ${c.value}${c.operator === "between" && c.value2 ? `..${c.value2}` : ""}`);
	if (q.access !== "private") parts.push(q.access);
	return parts.join(" · ");
}

export class ShuSearchSummary extends ShuElement<typeof EmptySchema> {
	/** A control, not a view of data — contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static schema = EmptySchema;
	static domainSelector = "shu-search-summary";

	/** The exact query this entry restores. Set once at record time; never mutated by later searches. */
	query: TViewQuery | null = null;

	constructor() {
		super(EmptySchema, {});
	}

	createRenderRoot(): HTMLElement {
		return this;
	}

	protected override onConnected(): void {
		this.autoListen(this, "click", () => this.restore());
	}

	/** Dispatch the restore of this entry's exact snapshot. Fail-fast: an entry without a snapshot is a recorder bug. */
	restore(): void {
		if (!this.query) throw new Error("shu-search-summary: restore with no query snapshot — the recorder must set .query before appending");
		this.dispatchEvent(new CustomEvent(SHU_EVENT.SEARCH_RESTORE, { detail: { query: this.query }, bubbles: true, composed: true }));
	}

	/** Take this record out of the history — the same x affordance a step result carries. Removal is purely local:
	 *  the recorder dedups against the live history, so removing an entry lets the same search be recorded again. */
	private onDismiss = (e: Event): void => {
		e.stopPropagation();
		this.remove();
	};

	render(): TemplateResult {
		return html`<button class="dismiss-btn" title="Remove" @click=${this.onDismiss}>x</button><span class="search-summary-text">${this.query ? describeSearch(this.query) : ""}</span>`;
	}
}

customElements.define("shu-search-summary", ShuSearchSummary);
