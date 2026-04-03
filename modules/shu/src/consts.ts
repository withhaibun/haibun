/** Shared constants for custom events and data attributes across shu components. */

export const SHU_EVENT = {
	COLUMN_OPEN: "column-open",
	COLUMN_OPEN_FILTER: "column-open-filter",
	COLUMN_OPEN_MONITOR: "column-open-monitor",
	COLUMN_OPEN_SEQUENCE: "column-open-sequence",
	COLUMN_CLOSE: "column-close",
	COLUMN_ACTIVATE: "column-activate",
	COLUMN_ACTIVATED: "column-activated",
	COLUMN_EXPAND: "column-expand",
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
} as const;

export const SHU_ATTR = {
	DATA_MINIMIZED: "data-minimized",
	PINNED: "pinned",
	ACTIVE: "active",
	CLOSABLE: "closable",
	COLLAPSED: "collapsed",
	COLUMN_TYPE: "column-type",
} as const;
