/** Shared constants for custom events and data attributes across shu components. */

/**
 * Per-row property name that the consumer's graph store stamps with the stored
 * vertex-label handle, then `project()` converts to `@type`. The value is the
 * store's literal label handle and must not change — existing rows are filtered by it.
 * Shared across the consumer → @haibun/shu boundary so neither side spells it inline.
 */
export const STORED_TYPE_PROP = "vertexLabel";

export const SHU_EVENT = {
	COLUMN_OPEN: "column-open",
	// Open an arbitrary pane (a validated DesiredPane in the detail) — the generic bridge an external view (e.g. the
	// fisheye graph, a separate bundle) uses to reach PaneState, where COLUMN_OPEN only opens an entity pane for a subject.
	PANE_OPEN: "pane-open",
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
	// A recorded search summary was clicked: restore its exact viewQuery snapshot (detail: { query: TViewQuery }).
	SEARCH_RESTORE: "search-restore",
	GRAPH_FILTER_CHANGE: "graph-filter-change",
	// Hovering a type in the filter previews it: views dim every other type so the hovered one stands out. null = preview ended.
	GRAPH_TYPE_PREVIEW: "graph-type-preview",
	GRAPH_CLUSTER_EXPAND: "graph-cluster-expand",
	GRAPH_NODE_CLICK: "graph-node-click",
	GRAPH_NODE_HOVER: "graph-node-hover",
	GRAPH_NODE_LEAVE: "graph-node-leave",
	ROW_CLICK: "row-click",
	// A thumbnail asks its document column to move the global time cursor to the step row it belongs to (the column owns
	// the start-time → absolute-time mapping). Composed so it crosses the column's shadow boundary from the framed artifact.
	CURSOR_TO_ROW: "cursor-to-row",
	SORT_CHANGE: "sort-change",
	PAGE_CHANGE: "page-change",
	STATE_CHANGE: "state-change",
	SYNC_AVAILABLE: "sync-available",
	VIEW_ACTIVE: "view-active",
} as const;

export const SHU_TYPE = {
	VIEW_COLLECTION: "shu-view-collection",
	CLOSE_VIEW: "shu-close-view",
} as const;

export const SHU_ATTR = {
	DATA_MINIMIZED: "data-minimized",
	DATA_MAXIMIZED: "data-maximized",
	DATA_CONTROLS_ON: "data-controls-on",
	PINNED: "pinned",
	ACTIVE: "active",
	CLOSABLE: "closable",
	COLLAPSED: "collapsed",
	IS_LAST: "is-last",
	SHOW_CONTROLS: "data-show-controls",
	COLUMN_TYPE: "column-type",
} as const;
