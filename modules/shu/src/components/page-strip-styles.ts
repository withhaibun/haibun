/**
 * The page strip's styles: the strip, its status, its breadcrumb, its corner controls and the popover they open.
 */
import { css, type CSSResultGroup } from "lit";
import { shuBaseStyles, shuIconButtonStyles } from "./styles.js";

const STYLES = css`
	/* The page's chrome along the bottom, in the app's flow below the columns. A docked pane stands above it. */
	:host { display: block; flex: none; position: relative; z-index: 21; background: var(--shu-bg-soft); }
	.page-strip {
		display: flex; align-items: center; gap: var(--shu-space-3); padding: var(--shu-space-2) var(--shu-space-4);
		min-height: var(--shu-row-h); user-select: none;
		border-top: var(--shu-border-w) solid var(--shu-border);
	}
	.dock-toggle { flex-shrink: 0; }
	/* One line in the strip, since the strip is one line, and a control, because a message a reader cannot read in full is
	   a message they cannot act on: it opens the whole of it, which they can select and copy. */
	.status-area {
		font-size: var(--shu-font-sm); color: var(--shu-fg-muted); padding: 0 var(--shu-space-2); cursor: pointer;
		max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		background: none; border: 0; font-family: inherit; text-align: left;
	}
	.status-full { margin: 0; max-width: 32rem; max-height: 40vh; overflow: auto; user-select: text; white-space: pre-wrap; display: flex; gap: var(--shu-space-2); align-items: flex-start; }
	/* Corner controls are shared pane-icon chips, same box + accent-inverse-when-open as an active column view control.
	   The text toggles (now / access) size to their label instead of the icon's square; the gear keeps the square. */
	/* The one corner-popover surface (a native top-layer popover): floats just above its corner toggle. Position (bottom,
	   right edge over its control) is set at show time. */
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
	/* The negative margin cancels the strip's vertical padding so the buttons take the strip's full height. */
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
`;

export const PAGE_STRIP_STYLES: CSSResultGroup = [shuBaseStyles, shuIconButtonStyles, STYLES];
