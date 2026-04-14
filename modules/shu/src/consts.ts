/** Shared constants for custom events and data attributes across shu components. */

export const SHU_EVENT = {
	COLUMN_OPEN: "column-open",
	COLUMN_OPEN_FILTER: "column-open-filter",
	COLUMN_OPEN_MONITOR: "column-open-monitor",
	COLUMN_OPEN_SEQUENCE: "column-open-sequence",
	COLUMN_OPEN_RELATED: "column-open-related",
	COLUMN_OPEN_GRAPH: "column-open-graph",
	COLUMN_OPEN_STEP: "column-open-step",
	COLUMN_OPEN_DOCUMENT: "column-open-document",
	COLUMN_CLOSE: "column-close",
	COLUMN_ACTIVATE: "column-activate",
	COLUMN_ACTIVATED: "column-activated",
	COLUMN_EXPAND: "column-expand",
	COLUMN_MAXIMIZE: "column-maximize",
	COLUMN_RESIZE: "column-resize",
	COLUMN_MINIMIZE: "column-minimize",
	COLUMNS_CHANGED: "columns-changed",
	CONTEXT_CHANGE: "context-change",
	FILTER_CHANGE: "filter-change",
	RESULTS_CHANGED: "results-changed",
	ROW_CLICK: "row-click",
	SORT_CHANGE: "sort-change",
	PAGE_CHANGE: "page-change",
	STATE_CHANGE: "state-change",
	SYNC_AVAILABLE: "sync-available",
	RESIZE_DRAG: "resize-drag",
	RESIZE_END: "resize-end",
	TIME_SYNC: "time-sync",
} as const;

/** Maps `view` product values to the column-open events they trigger. */
export const VIEW_EVENTS: Record<string, string> = {
	monitor: SHU_EVENT.COLUMN_OPEN_MONITOR,
	sequence: SHU_EVENT.COLUMN_OPEN_SEQUENCE,
	graph: SHU_EVENT.COLUMN_OPEN_GRAPH,
	document: SHU_EVENT.COLUMN_OPEN_DOCUMENT,
};

export const SHU_ATTR = {
	DATA_MINIMIZED: "data-minimized",
	DATA_MAXIMIZED: "data-maximized",
	PINNED: "pinned",
	ACTIVE: "active",
	CLOSABLE: "closable",
	COLLAPSED: "collapsed",
	SHOW_CONTROLS: "data-show-controls",
	COLUMN_TYPE: "column-type",
} as const;
