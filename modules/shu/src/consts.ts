/** Shared constants for custom events and data attributes across shu components. */

/**
 * Per-row property name that the consumer's graph store stamps with the stored
 * vertex-label handle, then `project()` converts to `@type`. The value is the
 * store's literal label handle and must not change — existing rows are filtered by it.
 * Shared across the consumer → @haibun/shu boundary so neither side spells it inline.
 */
export const STORED_TYPE_PROP = "vertexLabel";

/** The hash params an affordance deep-link is carried in: the goal a panel opens, or the waypoint it opens instead.
 *  Written by the chain view and the projection's links, read by the affordances panel and the chain view alike. */
export const AFFORDANCE_PARAM = { GOAL: "aff-goal", WAYPOINT: "aff-waypoint" } as const;

/** What a deep link into the view state begins with: view state is carried in the hash, which a static document can
 *  link to and a page saved for offline reading still keeps. */
export const DEEP_LINK_PREFIX = "#?";

export const SHU_EVENT = {
	COLUMN_OPEN: "column-open",
	// Open an arbitrary pane (a validated DesiredPane in the detail) — the generic bridge an external view (e.g. the
	// polymorphic graph, a separate bundle) uses to reach PaneState, where COLUMN_OPEN only opens an entity pane for a subject.
	PANE_OPEN: "pane-open",
	COLUMN_CLOSE: "column-close",
	PANE_DISMISS: "pane-dismiss",
	STEP_CHOOSE: "step-choose",
	COLUMN_ACTIVATE: "column-activate",
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
	// ←/→ from an expanded thumbnail asks its document column for the previous/next thumbnail IN THE WHOLE RUN. The column
	// owns navigation because under virtualization only the visible window's frames exist in the DOM — a frame cannot find
	// its off-screen siblings itself.
	FRAME_NAV: "frame-nav",
	// An annotation was authored from a body view (select text → annotate); the host reloads so it appears anchored.
	ANNOTATION_CREATED: "annotation-created",
	SORT_CHANGE: "sort-change",
	STATE_CHANGE: "state-change",
	SYNC_AVAILABLE: "sync-available",
} as const;

/** The one glyph marking annotation everywhere it appears — the gutter toggle, the rail markers. A text glyph (the
 *  flipped pencil), not an emoji, so CSS `color` tints it (the has-annotations grey-vs-colour treatment). */
export const ANNOTATION_GLYPH = "✎";

/** The actions bar's extension slot: a concern whose ui declares this slot (with a js asset) is mounted in the bar's
 *  input line. The bar owns the slot, so its name is declared here and consumers import it rather than restating it. */
export const ACTION_BAR_CHAT_SLOT = "action-bar-chat";

/** The permissions area's extension slot: a concern whose ui declares this slot (with a js asset) is mounted inside
 *  the access popover, beside what this session may do. For anything a reader decides by authority rather than by
 *  asking, which belongs with the permissions it decides under rather than beside the conversation. */
export const PERMISSIONS_SLOT = "permissions";

/** An extension in the permissions area says how many items await the reader's decision, and where to read them, so
 *  the access indicator can mark that something is waiting without knowing what kind of thing it is. The mark is a
 *  reference, since a notification that does not lead to its cause leaves the reader to go looking.
 *  Detail: `{ count, kind, target }` — the reference kind and link target a `shu-ref` takes. */
export const AWAITING_DECISION = "awaiting-decision";

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
