/** Shared constants for custom events and data attributes across shu components. */

export const SHU_EVENT = {
	COLUMN_OPEN: "column-open",
	COLUMN_CLOSE: "column-close",
	PANE_DISMISS: "pane-dismiss",
	STEP_CHOOSE: "step-choose",
	COLUMN_ACTIVATE: "column-activate",
	COLUMN_ACTIVATED: "column-activated",
	COLUMN_EXPAND: "column-expand",
	COLUMN_MAXIMIZE: "column-maximize",
	COLUMN_RESIZE: "column-resize",
	COLUMN_MINIMIZE: "column-minimize",
	COLUMNS_CHANGED: "columns-changed",
	CONTEXT_CHANGE: "context-change",
	FILTER_CHANGE: "filter-change",
	GRAPH_FILTER_CHANGE: "graph-filter-change",
	GRAPH_CLUSTER_EXPAND: "graph-cluster-expand",
	GRAPH_NODE_CLICK: "graph-node-click",
	GRAPH_NODE_HOVER: "graph-node-hover",
	GRAPH_NODE_LEAVE: "graph-node-leave",
	RESULTS_CHANGED: "results-changed",
	ROW_CLICK: "row-click",
	SORT_CHANGE: "sort-change",
	PAGE_CHANGE: "page-change",
	STATE_CHANGE: "state-change",
	SYNC_AVAILABLE: "sync-available",
	RESIZE_DRAG: "resize-drag",
	RESIZE_END: "resize-end",
	TIME_SYNC: "time-sync",
	VIEW_ACTIVE: "view-active",
} as const;

export const SHU_TYPE = {
	VIEW_COLLECTION: "shu-view-collection",
	CLOSE_VIEW: "shu-close-view",
} as const;

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
