/** Shared constants for custom events and data attributes across shu components. */
import { ChatRoleSchema } from "./schemas.js";
import { ChatStatusSchema } from "@haibun/core/lib/conversation/domains/conversation.js";

/** How many occurrences the browser holds between batches, and so the most a batch of them holds. The size is fixed, so
 *  the buffer doesn't grow while a batch is in flight. */
export const CLIENT_RING = 240;

/**
 * The per-row property that the consumer's graph store sets to the stored vertex-label handle. `project()` converts it to
 * `@type`. The value is the store's literal label handle. It must not change, since existing rows are filtered by it.
 * The consumer and @haibun/shu both import it, so the name is spelled in one place.
 */
export const STORED_TYPE_PROP = "vertexLabel";

/** The hash params that carry an affordance deep-link: the goal a panel opens, or the waypoint it opens instead. The
 *  chain view and the projection's links write them. The affordances panel and the chain view read them. */
export const AFFORDANCE_PARAM = { GOAL: "aff-goal", WAYPOINT: "aff-waypoint" } as const;

/** The custom property a docked pane sets on its positioning host to the height of its closed strip. The host reserves
 *  that height, so the closed pane doesn't cover content. */
export const DOCK_FOOTPRINT = "--shu-dock-h";

/** The custom property the page strip sets on its positioning host to its height. A docked pane is positioned above it. */
export const PAGE_STRIP_FOOTPRINT = "--shu-page-strip-h";

/** The hash param that addresses the conversation the ask pane shows, by its session's seqPath. */
export const CONVERSATION_PARAM = "ask";

/** The prefix of a deep link into the view state. The hash carries view state, so a static document can link to it and a
 *  page saved for offline reading keeps it. */
export const DEEP_LINK_PREFIX = "#?";

/** Where the site serves its JSON-LD @context: the well-known address, and its alias under the namespace. */
export const CONTEXT_DOCUMENT = { wellKnown: "/.well-known/haibun-context.jsonld", namespace: "/ns/context.jsonld" } as const;

export const SHU_EVENT = {
	/** A view in the graph bundle opens a pane (a `TPaneOpen` detail): that bundle's panes aren't the page's. */
	PANE_OPEN: "pane-open",
	COLUMN_CLOSE: "column-close",
	PANE_DISMISS: "pane-dismiss",
	STEP_CHOOSE: "step-choose",
	/** A reader forks the conversation at a question from the history, asking it again as it was or edited (a `TQuestionFork` detail). */
	QUESTION_FORK: "question-fork",
	COLUMN_ACTIVATE: "column-activate",
	COLUMN_EXPAND: "column-expand",
	COLUMN_MAXIMIZE: "column-maximize",
	COLUMN_RESIZE: "column-resize",
	COLUMN_MINIMIZE: "column-minimize",
	/** A pane docks along the bottom of the app, or returns to the strip. */
	COLUMN_DOCK: "column-dock",
	/** A reader chooses the type the page searches from the types the page strip offers. */
	TYPE_CHOOSE: "type-choose",
	CONTEXT_CHANGE: "context-change",
	/** Returns a view to the live edge and resumes tailing. A view that tails listens for this event. It is the only way
	 *  to resume tailing after a reader presses a rail at a moment, since a press keeps its position. */
	GO_LIVE: "shu-go-live",
	FILTER_CHANGE: "filter-change",
	// A reader clicked a recorded search summary, and the app restores its viewQuery snapshot (detail: { query: TViewQuery }).
	SEARCH_RESTORE: "search-restore",
	GRAPH_FILTER_CHANGE: "graph-filter-change",
	// Hovering a type in the filter previews it, and views dim every other type. A null type ends the preview.
	GRAPH_TYPE_PREVIEW: "graph-type-preview",
	GRAPH_CLUSTER_EXPAND: "graph-cluster-expand",
	GRAPH_NODE_CLICK: "graph-node-click",
	GRAPH_NODE_HOVER: "graph-node-hover",
	GRAPH_NODE_LEAVE: "graph-node-leave",
	ROW_CLICK: "row-click",
	// A thumbnail requests that its document column move the global time cursor to the thumbnail's step row. The column
	// holds the start-time → absolute-time mapping. The event is composed, so it crosses the column's shadow boundary from
	// the framed artifact.
	CURSOR_TO_ROW: "cursor-to-row",
	// ←/→ on an expanded thumbnail requests the previous or next thumbnail from its document column. The column selects
	// across every thumbnail of actuality, not only the rendered ones. The column handles navigation because virtualization
	// renders only the visible window's frames in the DOM, so a frame doesn't find its off-screen siblings.
	FRAME_NAV: "frame-nav",
	// A reader authored an annotation from a body view (select text → annotate). The host reloads, so the annotation renders at its anchor.
	ANNOTATION_CREATED: "annotation-created",
	SORT_CHANGE: "sort-change",
	STATE_CHANGE: "state-change",
	SYNC_AVAILABLE: "sync-available",
	/** A step caller ran its step, and the step succeeded or failed. Both events bubble out of the caller's view. The view expands in place. */
	STEP_SUCCESS: "step-success",
	STEP_ERROR: "step-error",
} as const;

/** The glyph that marks an annotation in the gutter toggle and the rail markers. It is a text glyph (the flipped pencil)
 *  and not an emoji, so CSS `color` tints it for the has-annotations grey or colour treatment. */
export const ANNOTATION_GLYPH = "✎";

/** The actions bar's extension slot. A concern whose ui declares this slot with a js asset is mounted in the bar's input
 *  line in every mode. The slot holds controls a reader uses to enter text into that line, such as dictation, which
 *  serves a step and a question alike. The bar defines the slot, so its name is declared here and consumers import it. */
export const ACTION_BAR_CHAT_SLOT = "action-bar-chat";
/** The address key that holds the chat reader's place on actuality's timeline. The chat writes it beside the session. */
export const CHAT_VIEW_PARAM = "ask-at";

/** The `ask` mode's extension slot. It is mounted in the bar's input line in `ask` mode only. It holds controls for the
 *  question itself, such as what a question carries. Those controls don't concern a reader who searches or runs a step. */
export const ACTION_BAR_ASK_SLOT = "action-bar-ask";

/** The permissions area's extension slot. A concern whose ui declares this slot with a js asset is mounted inside the
 *  access popover, beside what this session may do. It holds controls for decisions a reader makes by authority and not
 *  by a question. Such a control is placed with the permissions that govern the decision, not beside the conversation. */
export const PERMISSIONS_SLOT = "permissions";

/** An extension in the permissions area dispatches this event with how many items await the reader's decision and
 *  where to read them. The access indicator marks the waiting items without depending on their kind. The mark is a
 *  reference, so the reader follows it to the items.
 *  Detail: `{ count, kind, target }`, with the reference kind and link target a `shu-ref` takes. */
export const AWAITING_DECISION = "awaiting-decision";

export const SHU_TYPE = { VIEW_COLLECTION: "shu-view-collection" } as const;

/** Whether a declared ui component is one of the marker types above rather than an element a column can hold. */
export const isMarkerType = (component: string): boolean => (Object.values(SHU_TYPE) as string[]).includes(component);

/** The element that holds a page's hydration: its settings, and the actuality a record of the page carries. */
export const HYDRATION_ID = "shu-hydration";

/** Every built-in shu element, by its tag: what the registry defines, a step opens (`productsDomain`), a domain declares
 *  (`ui.component`), a component selects in its tree and a test selects on the page. Each tag is named once here, so a
 *  file doesn't spell a tag again. A component that is also a domain exposes its own tag as `static domainSelector`. */
export const SHU_TAG = {
	/** The page a reader opens: the strip of panes, the page strip and the query, or why the page didn't open. */
	PAGE: "shu-page",
	/** A refusal's cause and its remedy as a control. */
	REFUSAL: "shu-refusal",
	PERMISSIONS: "shu-permissions",
	PAGE_KEY: "shu-page-key",
	GRAPH_QUERY: "shu-graph-query",
	RESULT_TABLE: "shu-result-table",
	/** The column container that holds every view. A view selects its hosting column by this tag. */
	COLUMN_PANE: "shu-column-pane",
	COLUMN_STRIP: "shu-column-strip",
	ENTITY_COLUMN: "shu-entity-column",
	FILTER_COLUMN: "shu-filter-column",
	ACTIONS_BAR: "shu-actions-bar",
	PAGE_STRIP: "shu-page-strip",
	ASK: "shu-ask",
	CHAT_MESSAGE: "shu-chat-message",
	BREADCRUMB: "shu-breadcrumb",
	COMBOBOX: "shu-combobox",
	SPINNER: "shu-spinner",
	STEP_CALLER: "shu-step-caller",
	MONITOR_COLUMN: "shu-monitor-column",
	POLYMORPHIC_GRAPH_VIEW: "shu-polymorphic-graph-view",
	THREAD_COLUMN: "shu-thread-column",
	STEP_DETAIL: "shu-step-detail",
	STEP_DEFINITION: "shu-step-definition",
	ACTION_COLUMN: "shu-action-column",
	INDEX_SUMMARY: "shu-index-summary",
	PLAYBACK: "shu-playback",
	DOCUMENT_COLUMN: "shu-document-column",
	CLIENT_CACHE_COLUMN: "shu-client-cache-column",
	PRODUCT_VIEW: "shu-product-view",
	VIEWS_PICKER: "shu-views-picker",
	AFFORDANCES_PANEL: "shu-affordances-panel",
	DOMAIN_CHAIN_VIEW: "shu-domain-chain-view",
	COPY_BUTTON: "shu-copy-button",
	REF: "shu-ref",
	TYPE_COLUMN: "shu-type-column",
	THEME_SWITCH: "shu-theme-switch",
	ACTIVITY_HISTORY: "shu-activity-history",
	WINDOW_SIZE: "shu-window-size",
	SEARCH_SUMMARY: "shu-search-summary",
	GRAPH_FILTER: "shu-graph-filter",
	CHIP_GROUP: "shu-chip-group",
	CLASS_BROWSER: "shu-class-browser",
	GRAPH_SCENE: "shu-graph-scene",
	SCROLLBAR: "shu-scrollbar",
	ARTIFACT_FRAME: "shu-artifact-frame",
	VIRTUAL_COLUMN: "shu-virtual-column",
	POLYMORPHIC_SETTINGS: "shu-polymorphic-settings",
	FIELD: "shu-field",
	ANNOTATED_BODY: "shu-annotated-body",
} as const;

/** The index pane's key. Every other column is opened from the index pane, and the app builds only the index pane itself. */
export const INDEX_PANE_KEY = "query";

/** The slot that holds a column's spine view, which the column shows when it collapses to a narrow strip. A collapsed
 *  pane renders this slot and not the default one, so only one of the two views is rendered at a time. */
export const SPINE_SLOT = "spine";

/** The slot the breadcrumb's search entry holds, where the page strip puts the control that names the search. */
export const SEARCH_SLOT = "search";

export const SHU_ATTR = {
	DATA_MINIMIZED: "data-minimized",
	/** On a view opened at a moment of actuality's history: that moment, which the view shows (`TimelineViewController`). */
	SNAPSHOT_TIME: "data-snapshot-time",
	/** On an image or frame an artifact frame holds: the address of actuality's artifact it shows once the page has read it. */
	DATA_ARTIFACT: "data-artifact",
	/** Declared by an overlay while it covers the views beneath it. A framing positions its subject clear of every element
	 *  that carries this attribute, and repositions when one is added or removed, so a node isn't rendered under a panel. */
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

/** The selectors a transcript's chat message matches, by the attributes it reflects. A selector places one of them in
 *  the transcript (`:nth-child(n of match)`), since a message's tag doesn't distinguish a question from a response.
 *  Single quotes let a feature embed a selector in a quoted step argument. */
export const CHAT_MESSAGE_MATCH = {
	QUESTION: `[${SHU_ATTR.DATA_ROLE}='${ChatRoleSchema.enum.user}']`,
	/** A question on the branch the transcript shows. */
	SHOWN_QUESTION: `[${SHU_ATTR.DATA_ROLE}='${ChatRoleSchema.enum.user}']:not([hidden])`,
	/** A response whose turn completed. */
	COMPLETED_REPLY: `[${SHU_ATTR.DATA_ROLE}='${ChatRoleSchema.enum.llm}'][${SHU_ATTR.DATA_STATUS}='${ChatStatusSchema.enum.completed}']`,
} as const;

/** The methods a view names when it requests the service's whole graph grouped into clusters, or the affordances on
 *  offer. They are named here with every other repeated literal, so a caller doesn't spell them. */
export const RPC_METHOD = {
	CLUSTERED_QUADS: "GraphSourceStepper-getClusteredQuads",
	/** The affordances on offer, as a read. The panel and the chain view request it to stay current. */
	AFFORDANCES_ON_OFFER: "LogicStepper-affordancesOnOffer",
	AFFORDANCES_ON_OFFER_AS_OF: "LogicStepper-affordancesOnOfferAsOf",
} as const;

/** The classes a row takes against the time cursor: after it (dimmed), and the cursor's row. `SHU_BASE` styles both. */
export const TIME_SYNC_CLASS = { FUTURE: "future-event", CURRENT: "time-current" } as const;

/** The settings groups a host can offer, by name. */
export const SETTINGS_GROUP = { layout: "layout", filters: "filters", scenes: "scenes" } as const;
export type TSettingsGroup = (typeof SETTINGS_GROUP)[keyof typeof SETTINGS_GROUP];
