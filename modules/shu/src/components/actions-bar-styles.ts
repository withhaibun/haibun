/**
 * The actions bar's styles: its body, the input line of each mode, the shared output region and the records every mode
 * writes into it.
 */
import { css, type CSSResultGroup } from "lit";
import { chatMessageStyles } from "./shu-chat-message.js";
import { shuBaseStyles, shuIconButtonStyles } from "./styles.js";

const STYLES = css`
	/* The view of its pane: the pane places it, docked along the bottom or as a column, and gives it its size. */
	:host { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
	.actions-bar { padding: 0; display: flex; flex-direction: column; min-width: 0; overflow: hidden; flex: 1; min-height: 0; position: relative; }
	.filter-bar {
		display: flex; gap: var(--shu-space-2); align-items: center;
		padding: var(--shu-space-2) var(--shu-space-3); flex-wrap: wrap;
		border-bottom: var(--shu-border-w) solid var(--shu-border);
	}
	/* Inputs/selects style is centralised in SHU_BASE (above). The actions-bar only adds layout. */
	.filter-bar .select-filter { width: auto; flex: 0 0 auto; }
	.filter-bar .text-search { flex: 1 1 20ch; min-width: 16ch; }
	.compound-filters { display: flex; gap: var(--shu-space-1); flex-wrap: wrap; margin-left: auto; }
	.filter-group {
		display: inline-flex; gap: var(--shu-space-1); align-items: center;
		background: var(--shu-bg-input); border-radius: var(--shu-radius);
		padding: var(--shu-space-1) var(--shu-space-2);
		flex: 0 0 auto;
	}
	.filter-group select, .filter-group input { width: auto; }
	.filter-group .cond-property { max-width: 10em; }
	.filter-group .cond-operator { max-width: 5em; }
	.filter-group .cond-value, .filter-group .cond-value2 { max-width: 8em; }
	.filter-group .remove-filter { border: none; background: none; color: var(--shu-fg-faded); padding: 0 var(--shu-space-1); cursor: pointer; }
	.filter-group .remove-filter:hover { color: var(--shu-error); }
	.filter-bar .add-filter, .filter-bar .search-go {
		font: inherit; padding: var(--shu-space-1) var(--shu-space-4); border: var(--shu-border-w) solid var(--shu-border);
		background: var(--shu-bg-elevated); color: var(--shu-fg); cursor: pointer; flex: 0 0 auto;
		border-radius: var(--shu-radius);
		min-height: var(--shu-input-h);
	}
	.filter-bar .add-filter:hover, .filter-bar .search-go:hover { background: var(--shu-bg-hover); }
	.filter-bar .search-go { background: var(--shu-accent); color: var(--shu-accent-fg); border-color: var(--shu-accent); }
	shu-step-caller {
		display: block; padding: var(--shu-space-3); margin: var(--shu-space-2) var(--shu-space-4);
		background: var(--shu-bg-elevated); border-radius: var(--shu-radius); border: var(--shu-border-w) solid var(--shu-border);
	}
	.mode-select { flex-shrink: 0; width: auto; min-width: 5em; }
	/* THE shared output region: every mode's activity records scroll here; the input line beneath is what changes. */
	/* The output region fills from the BOTTOM: a lone entry rests at the bottom edge, new entries land beneath the last,
	   older ones scroll up. margin-top:auto on the first entry claims the free space above when the content is short,
	   and collapses to 0 once it overflows so the scroll (pinned to the newest by scrollToBottom) reaches every entry. */
	shu-activity-history { display: flex; flex-direction: column; font-size: inherit; padding: var(--shu-space-3) var(--shu-space-4); width: 100%; min-width: 0; flex: 1; min-height: 0; overflow-y: auto; }
	shu-activity-history > * { flex-shrink: 0; }
	shu-activity-history > :first-child { margin-top: auto; }
	/* What arrived after the reader's place stays in view while they read where they are, so the press that takes them
	   back to the end is reachable from wherever they are. */
	shu-activity-history > .arrived { position: sticky; bottom: 0; align-self: center; }
	shu-search-summary { display: block; cursor: pointer; padding: var(--shu-space-1) var(--shu-space-3); border-radius: var(--shu-radius); }
	shu-search-summary:hover { background: var(--shu-bg-elevated); }
	shu-search-summary .search-summary-text::before { content: "\\1F50D\\00A0"; }
	/* The same x affordance a step result carries (shu-step-caller .dismiss-btn): the entry is light DOM, so its host scope styles it. */
	shu-search-summary .dismiss-btn {
		float: right; background: none; border: none; color: var(--shu-fg-faded);
		cursor: pointer; font-size: var(--shu-font-sm);
		padding: 0 var(--shu-space-2); line-height: 1; width: auto;
	}
	shu-search-summary .dismiss-btn:hover { color: var(--shu-error); }
	.input-line {
		display: flex; gap: var(--shu-space-2); align-items: stretch;
		padding: var(--shu-space-3) var(--shu-space-4); flex-shrink: 0;
	}
	.step-combo { flex: 1 1 280px; min-width: 12ch; width: auto; }

`;

export const ACTIONS_BAR_STYLES: CSSResultGroup = [shuBaseStyles, shuIconButtonStyles, chatMessageStyles, STYLES];
