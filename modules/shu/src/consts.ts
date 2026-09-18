/** Shared constants for custom events and data attributes across shu components. */
import { ChatRoleSchema, ChatStatusSchema } from "./schemas.js";

/**
 * Per-row property name that the consumer's graph store stamps with the stored
 * vertex-label handle, then `project()` converts to `@type`. The value is the
 * store's literal label handle and must not change, existing rows are filtered by it.
 * Shared across the consumer → @haibun/shu boundary so neither side spells it inline.
 */
export const STORED_TYPE_PROP = "vertexLabel";

/** The hash params an affordance deep-link is carried in: the goal a panel opens, or the waypoint it opens instead.
 *  Written by the chain view and the projection's links, read by the affordances panel and the chain view alike. */
export const AFFORDANCE_PARAM = { GOAL: "aff-goal", WAYPOINT: "aff-waypoint" } as const;

/** The custom property a docked pane sets on its positioning host to the height of its closed strip, which the host
 *  reserves so no content sits behind the closed pane. */
export const DOCK_FOOTPRINT = "--shu-dock-h";

/** The custom property the page strip sets on its positioning host to its height, which a docked pane stands above. */
export const PAGE_STRIP_FOOTPRINT = "--shu-page-strip-h";

/** The hash param that addresses the conversation the ask is open on, by its session's seqPath. */
export const CONVERSATION_PARAM = "ask";

/** What a deep link into the view state begins with: view state is carried in the hash, which a static document can
 *  link to and a page saved for offline reading still keeps. */
export const DEEP_LINK_PREFIX = "#?";

export const SHU_EVENT = {
	COLUMN_OPEN: "column-open",
	// Open an arbitrary pane (a validated DesiredPane in the detail): the generic bridge an external view (e.g. the
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
	/** A pane docks along the bottom of the app, or returns to the strip. */
	COLUMN_DOCK: "column-dock",
	/** A reader chooses the type the page searches, which the page strip offers. */
	TYPE_CHOOSE: "type-choose",
	CONTEXT_CHANGE: "context-change",
	/** Return to the live edge and tail it again. Any view that tails answers this; it is the one way the tail is
	 *  re-engaged after a reader has pressed a rail to a moment, since a press is meant to stay where it was put. */
	GO_LIVE: "shu-go-live",
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
	// owns navigation because under virtualization only the visible window's frames exist in the DOM: a frame cannot find
	// its off-screen siblings itself.
	FRAME_NAV: "frame-nav",
	// An annotation was authored from a body view (select text → annotate); the host reloads so it appears anchored.
	ANNOTATION_CREATED: "annotation-created",
	SORT_CHANGE: "sort-change",
	STATE_CHANGE: "state-change",
	SYNC_AVAILABLE: "sync-available",
	/** A step caller ran its step: it succeeded, or it failed. Both bubble out of the caller's view, which grows in place. */
	STEP_SUCCESS: "step-success",
	STEP_ERROR: "step-error",
} as const;

/** The one glyph marking annotation everywhere it appears: the gutter toggle, the rail markers. A text glyph (the
 *  flipped pencil), not an emoji, so CSS `color` tints it (the has-annotations grey-vs-colour treatment). */
export const ANNOTATION_GLYPH = "✎";

/** The actions bar's extension slot: a concern whose ui declares this slot (with a js asset) is mounted in the bar's
 *  input line, in every mode. For anything a reader uses to put something INTO that line, dictation among them, which
 *  serves a step and a question alike. The bar owns the slot, so its name is declared here and consumers import it
 *  rather than restating it. */
export const ACTION_BAR_CHAT_SLOT = "action-bar-chat";
/** The address key the chat writes the place its reader holds on the run's timeline under, beside the session. */
export const CHAT_VIEW_PARAM = "ask-at";

/** The ask's own extension slot: mounted in the bar's input line under ask mode alone. For anything about the ask
 *  itself, what a question would carry among them, which says nothing to a reader searching or running a step. */
export const ACTION_BAR_ASK_SLOT = "action-bar-ask";

/** The permissions area's extension slot: a concern whose ui declares this slot (with a js asset) is mounted inside
 *  the access popover, beside what this session may do. For anything a reader decides by authority rather than by
 *  asking, which belongs with the permissions it decides under rather than beside the conversation. */
export const PERMISSIONS_SLOT = "permissions";

/** An extension in the permissions area says how many items await the reader's decision, and where to read them, so
 *  the access indicator can mark that something is waiting without knowing what kind of thing it is. The mark is a
 *  reference, since a notification that does not lead to its cause leaves the reader to go looking.
 *  Detail: `{ count, kind, target }`: the reference kind and link target a `shu-ref` takes. */
export const AWAITING_DECISION = "awaiting-decision";

export const SHU_TYPE = {
	VIEW_COLLECTION: "shu-view-collection",
} as const;

/** Whether a declared ui component is one of the marker types above rather than an element a column can hold. */
export const isMarkerType = (component: string): boolean => (Object.values(SHU_TYPE) as string[]).includes(component);

/** The column container every view sits in. Named once: a view asks for its hosting column by this. */
/** Every built-in shu element, by its tag: what the registry defines, a step opens (`productsDomain`), a domain
 *  declares (`ui.component`), a component looks for in its tree and a test looks for on the page. One name each, here,
 *  so no file spells a tag again; a component that is also a domain exposes its own as `static domainSelector`. */
export const SHU_TAG = {
	PERMISSIONS: "shu-permissions",
	GRAPH_QUERY: "shu-graph-query",
	RESULT_TABLE: "shu-result-table",
	COLUMN_PANE: "shu-column-pane",
	COLUMN_STRIP: "shu-column-strip",
	ENTITY_COLUMN: "shu-entity-column",
	FILTER_COLUMN: "shu-filter-column",
	ACTIONS_BAR: "shu-actions-bar",
	PAGE_STRIP: "shu-page-strip",
	KIHAN_CHAT: "shu-kihan-chat",
	CHAT_MESSAGE: "shu-chat-message",
	BREADCRUMB: "shu-breadcrumb",
	COMBOBOX: "shu-combobox",
	SPINNER: "shu-spinner",
	STEP_CALLER: "shu-step-caller",
	MONITOR_COLUMN: "shu-monitor-column",
	POLYMORPHIC_GRAPH_VIEW: "shu-polymorphic-graph-view",
	THREAD_COLUMN: "shu-thread-column",
	STEP_DETAIL: "shu-step-detail",
	INDEX_SUMMARY: "shu-index-summary",
	PLAYBACK: "shu-playback",
	DOCUMENT_COLUMN: "shu-document-column",
	CLIENT_CACHE_COLUMN: "shu-client-cache-column",
	PRODUCT_VIEW: "shu-product-view",
	VIEWS_PICKER: "shu-views-picker",
	AFFORDANCES_PANEL: "shu-affordances-panel",
	DOMAIN_CHAIN_VIEW: "shu-domain-chain-view",
	GRAPH: "shu-graph",
	COPY_BUTTON: "shu-copy-button",
	REF: "shu-ref",
	TYPE_COLUMN: "shu-type-column",
	THEME_SWITCH: "shu-theme-switch",
	ACTIVITY_HISTORY: "shu-activity-history",
	WINDOW_SIZE: "shu-window-size",
	SEARCH_SUMMARY: "shu-search-summary",
} as const;

/** The index pane's identity: the column every other one is opened from, and the only one the app builds itself. */
export const INDEX_PANE_KEY = "query";

/** The slot a column's spine view is assigned to: what the column shows in the narrow strip it collapses to. A
 *  collapsed pane renders this slot and not the default one, so only one of the two views is ever rendered. */
export const SPINE_SLOT = "spine";

/** The slot the breadcrumb's search entry holds, where the page strip puts the control that says the search. */
export const SEARCH_SLOT = "search";

export const SHU_ATTR = {
	DATA_MINIMIZED: "data-minimized",
	/** Declared by an overlay while it covers the views beneath it. A framing aims what it frames clear of everything
	 *  carrying this, and re-aims when one appears or goes, so a reader is never shown a node under a panel. */
	DATA_COVERS_VIEWS: "data-covers-views",
	DATA_MAXIMIZED: "data-maximized",
	/** A pane docked along the bottom of the app, where every other pane is a column in the strip. */
	DOCKED: "docked",
	/** Declared by an element whose controls open, close and pin the docked pane, so a click in it isn't a click
	 *  elsewhere that closes the pane. */
	DOCK_CONTROLS: "data-dock-controls",
	DATA_CONTROLS_ON: "data-controls-on",
	PINNED: "pinned",
	ACTIVE: "active",
	CLOSABLE: "closable",
	COLLAPSED: "collapsed",
	HAS_SPINE: "has-spine",
	SPINE: "spine",
	GROWS: "grows",
	IS_LAST: "is-last",
	SHOW_CONTROLS: "data-show-controls",
	COLUMN_TYPE: "column-type",
	/** Reflected by a chat message from the message it renders: its role, turn status, turn seqPath and recorded comment. */
	DATA_ROLE: "data-role",
	DATA_STATUS: "data-status",
	DATA_RECORD: "data-record",
} as const;

/** What a transcript's chat message matches, by the attributes it reflects. A selector places one of them in the
 *  transcript (`:nth-child(n of match)`), since a message's tag alone does not tell a question from an answer. Single
 *  quotes let a feature embed a selector in a quoted step argument. */
export const CHAT_MESSAGE_MATCH = {
	QUESTION: `[${SHU_ATTR.DATA_ROLE}='${ChatRoleSchema.enum.user}']`,
	/** A question on the branch the transcript shows. */
	SHOWN_QUESTION: `[${SHU_ATTR.DATA_ROLE}='${ChatRoleSchema.enum.user}']:not([hidden])`,
	/** An answer whose turn completed. */
	COMPLETED_REPLY: `[${SHU_ATTR.DATA_ROLE}='${ChatRoleSchema.enum.llm}'][${SHU_ATTR.DATA_STATUS}='${ChatStatusSchema.enum.completed}']`,
} as const;

/** The methods a view names when it asks the service for a run's events or for the whole graph, grouped and clustered.
 *  Named here, with every other repeated literal, because both the caller and the report writer spell them. */
export const RPC_METHOD = {
	CLUSTERED_QUADS: "GraphSourceStepper-getClusteredQuads",
	/** The affordances on offer, as a read: what the panel and the chain view ask for to stay current. */
	AFFORDANCES_ON_OFFER: "GoalResolutionStepper-affordancesOnOffer",
	AFFORDANCES_ON_OFFER_AS_OF: "GoalResolutionStepper-affordancesOnOfferAsOf",
} as const;
