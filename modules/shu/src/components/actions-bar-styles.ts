/**
 * The actions bar's styles: its overlay and strip, the input line of each mode, the shared output region and the records
 * every mode writes into it.
 */
import { css, type CSSResultGroup } from "lit";
import { chatMessageStyles } from "./shu-chat-message.js";
import { shuBaseStyles, shuIconButtonStyles } from "./styles.js";

const STYLES = css`
	/* A bottom-anchored, translucent overlay: it floats up over the content from the bottom edge instead of taking
	   layout space, so the rows behind it never resize. Self-positioning, drop it into any position:relative host
	   (the app shell or a column view) and it pins to that host's bottom. */
	:host {
		/* Sits above column content and in-column overlays, below a fullscreen modal. */
		position: absolute; left: 0; right: 0; bottom: 0; z-index: 20;
		display: flex; flex-direction: column; min-width: 0; max-height: 100%; overflow: hidden;
	}
	.actions-bar {
		padding: 0; display: flex; flex-direction: column; min-width: 0; overflow: hidden; flex: 1; min-height: 0; position: relative;
		background: color-mix(in srgb, var(--shu-bg-soft) 68%, transparent);
		-webkit-backdrop-filter: blur(14px) saturate(1.4); backdrop-filter: blur(14px) saturate(1.4);
		border-top: var(--shu-border-w) solid var(--shu-border);
		box-shadow: 0 -2px 10px var(--shu-shadow);
	}
	/* The resize grip: a thin bar with a centred grab pill at the TOP edge of the open overlay. */
	.resize-handle {
		flex-shrink: 0; height: 10px; cursor: ns-resize; user-select: none; touch-action: none;
		display: flex; align-items: center; justify-content: center;
	}
	.resize-handle::before { content: ""; width: 40px; height: 4px; border-radius: 2px; background: var(--shu-border); }
	.resize-handle:hover::before { background: var(--shu-fg-faded); }
	.summary-bar {
		display: flex; align-items: center; gap: var(--shu-space-3); padding: var(--shu-space-2) var(--shu-space-4);
		min-height: var(--shu-row-h); flex-shrink: 0;
		user-select: none; margin-top: auto; background: transparent;
		border-top: var(--shu-border-w) solid var(--shu-border);
	}
	.actions-bar.collapsed { box-shadow: none; }
	.actions-bar.collapsed .summary-bar { cursor: pointer; margin-top: 0; border-top: none; }
	.bar-twisty {
		background: transparent; border: none; cursor: pointer; flex-shrink: 0;
		width: var(--shu-icon-btn); height: var(--shu-icon-btn);
		display: inline-flex; align-items: center; justify-content: center;
		font-size: var(--shu-font-md); color: var(--shu-fg); border-radius: var(--shu-radius);
	}
	.bar-twisty:hover { background: var(--shu-bg-hover); }
	/* One line in the bar, since the bar is one line, and a control, because a message a reader cannot read in full is
	   a message they cannot act on: it opens the whole of it, which they can select and copy. */
	.status-area {
		font-size: var(--shu-font-sm); color: var(--shu-fg-muted); padding: 0 var(--shu-space-2); cursor: pointer;
		max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		background: none; border: 0; font-family: inherit; text-align: left;
	}
	.status-full { margin: 0; max-width: 32rem; max-height: 40vh; overflow: auto; user-select: text; white-space: pre-wrap; display: flex; gap: var(--shu-space-2); align-items: flex-start; }
	/* Corner controls are shared pane-icon chips, same box + accent-inverse-when-open as an active column view control.
	   The text toggles (now / access) size to their label instead of the icon's square; the gear keeps the square. */
	/* The one corner-popover surface (a native top-layer popover): floats just above its corner toggle without
	   opening the actions bar. Position (bottom, right edge over its control) is set at show time. */
	.corner-popover {
		width: auto; cursor: default;
		/* display only in the open state: an unconditional display would override the UA's [popover] hidden rule
		   (author origin beats UA origin), leaving a closed popover centred over the page intercepting clicks. */
		display: none;
		padding: var(--shu-space-2) var(--shu-space-3);
		background: var(--shu-bg-elevated); color: var(--shu-fg);
		border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius);
		box-shadow: 0 1px 4px var(--shu-shadow);
		/* a floating panel sizes to its content and never scrolls it, without this the UA's [popover]
		   overflow:auto turns a control's few px of spill into scrollbars */
		overflow: hidden;
	}
	.corner-popover:popover-open { display: inline-flex; align-items: center; }
	shu-breadcrumb { flex: 1; font-size: var(--shu-font-md); min-width: 0; overflow: hidden; }
	/* The negative margin cancels the bar's vertical padding so the buttons take the bar's full height. */
	.corner-controls {
		display: inline-flex; align-items: stretch; gap: var(--shu-space-1); flex-shrink: 0;
		align-self: stretch; margin: calc(-1 * var(--shu-space-2)) 0;
	}
	.corner-controls .pane-icon { height: auto; }
	/* A text toggle sizes to its label; the compound selector outweighs pane-icon's fixed square width. */
	.corner-controls .corner-toggle { width: auto; padding: 0 var(--shu-space-2); }
	.access-indicator, .time-offset { font-size: var(--shu-font-xs); flex-shrink: 0; }
	.access-indicator.awaiting { border-color: var(--shu-accent); }
	/* The indicator carries the count so what awaits is seen before the panel is opened; the panel holds the alert. */
	.access-indicator .awaiting-count { margin-left: var(--shu-space-1); padding: 0 var(--shu-space-1); border-radius: 999px; background: var(--shu-accent); color: var(--shu-bg); font-weight: 700; }
	.filter-bar {
		display: flex; gap: var(--shu-space-2); align-items: center;
		padding: var(--shu-space-2) var(--shu-space-3); flex-wrap: wrap;
		border-bottom: var(--shu-border-w) solid var(--shu-border);
	}
	/* Inputs/selects style is centralised in SHU_BASE (above). The actions-bar only adds layout. */
	.filter-bar .label-select, .filter-bar .select-filter { width: auto; flex: 0 0 auto; }
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
	/* The output region fills from the BOTTOM: a lone entry sits at the bottom edge, new entries land beneath the last,
	   older ones scroll up. margin-top:auto on the first entry claims the free space above when the content is short,
	   and collapses to 0 once it overflows so the scroll (pinned to the newest by scrollToBottom) reaches every entry. */
	shu-activity-history { display: flex; flex-direction: column; font-size: inherit; padding: var(--shu-space-3) var(--shu-space-4); width: 100%; min-width: 0; flex: 1; min-height: 0; overflow-y: auto; }
	shu-activity-history > * { flex-shrink: 0; }
	shu-activity-history > :first-child { margin-top: auto; }
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
	/* The ask pane is the input line; the history above renders the transcript. */
	shu-kihan-chat { display: flex; flex: 0 0 auto; min-width: 0; }
`;

export const ACTIONS_BAR_STYLES: CSSResultGroup = [shuBaseStyles, shuIconButtonStyles, chatMessageStyles, STYLES];
