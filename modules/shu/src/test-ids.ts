/**
 * Test IDs for Playwright targeting of components defined in @haibun/shu.
 * External-component test ids (declared by domains via getConcerns()) live with
 * those components; shu must not name them here.
 */
export const SHU_TEST_IDS = {
	APP: {
		ROOT: "shu-app",
		HEADER: "shu-header",
		MAIN: "shu-main",
		/** On the page strip: opens and closes the pane docked along the bottom of the page. */
		DOCK_TOGGLE: "app-dock-toggle",
		/** On the page strip: pins the docked pane open against a click elsewhere. */
		DOCK_PIN: "app-dock-pin",
		CHAT_INPUT: "app-chat-input",
		CHAT_SUBMIT: "app-chat-submit",
		CHAT_OUTPUT: "app-chat-output",
		CHAT_TEXT: "app-chat-text",
		CHAT_ACTIVITY: "app-chat-activity",
		/** On a view whose reader scrolled away from the end: the control that states what arrived and returns them to it. */
		CHAT_ARRIVED: "app-chat-arrived",
		/** On a reply where another branch of the conversation leaves the one shown: follows that branch. */
		CHAT_OTHER_BRANCH: "app-chat-other-branch",
		/** On a question in the history: ask it again as it was, or put it in the input to edit, replying where it did. */
		CHAT_ASK_AGAIN: "app-chat-ask-again",
		CHAT_EDIT: "app-chat-edit",
		/** Beside the ask input while an edited question will reply where the original did, with the control that cancels it. */
		CHAT_RESTATING: "app-chat-restating",
		/** On a question: the records its bundle names, each a link. */
		CHAT_CARRIES: "app-chat-carries",
		/** Under the ask: the actions the page delegated to its last turn. */
		TURN_HELD: "app-turn-held",
		/** Under the ask, for an action the last turn was refused: allows it for the page's turns. Its value is the action. */
		TURN_ALLOW: "app-turn-allow",
		/** Under the ask, for an action the page's turns are given: withdraws it. Its value is the action. */
		TURN_WITHDRAW: "app-turn-withdraw",
		SESSION_SELECT: "app-session-select",
		STEP_SELECT: "app-step-select",
		MODE_SELECT: "app-mode-select",
		MODEL_SELECT: "app-model-select",
		/** In the chat's settings where the run offers no model: that it offers none. */
		NO_MODELS: "app-no-models",
		TYPE_SELECT: "app-type-select",
		FOLDER_SELECT: "app-folder-select",
		TEXT_SEARCH: "app-text-search",
		ADD_FILTER: "app-add-filter",
		SEARCH_GO: "app-search-go",
		TIME_OFFSET: "app-time-offset",
		PLAYBACK_POPOVER: "app-playback-popover",
		/** The access indicator, which opens the permissions area. */
		ACCESS_INDICATOR: "app-access-indicator",

		/** The permissions panel, inside the access popover. */
		PERMISSIONS: "app-permissions",
		/** The row saying how many await a decision. A reference, so pressing it opens what it is about. */
		AWAITING: "permissions-awaiting",
		/** An action this reader caches. A reference, so pressing it opens the record of what granted it. */
		HELD: "permissions-held",
		/** The page's own key, as the did:key a holder delegates to. */
		PAGE_KEY: "page-key",
	},
	FILTER: {
		PROPERTY_0: "app-cond-property-0",
		OPERATOR_0: "app-cond-operator-0",
		VALUE_0: "app-cond-value-0",
		REMOVE_0: "app-remove-filter-0",
	},
	QUERY: {
		ROOT: "shu-query",
		TABLE: "query-table",
		FIRST_ROW: "query-row-first",
		ROW: "query-row",
		RESULTS: "query-results",
	},
	QUAD_ITEM: {
		ROOT: "shu-quad-item",
	},
	COLUMN_BROWSER: {
		COLUMN: "browser-column",
		ENTITY_DETAILS: "entity-details",
		/** The record's type, a link to the type's view. */
		ENTITY_TYPE_LINK: "entity-type-link",
		/** One of the classes an `@type` field names, a link to that class's view. */
		TYPE_VALUE: "type-value",
		PREDICATE_LINK: "predicate-link",
		PREDICATE_LINK_FIRST: "predicate-link-first",
		BODY_IFRAME: "email-body-iframe",
		/** The references a body shown in the sandboxed iframe makes, listed beside it where they work. */
		BODY_REFS: "body-refs",
		/** One button per reading of a record's content; the one shown is pressed. */
		BODY_READING: "body-reading-switch",
		REF_SECTION: "ref-section",
		ENTITY_STUB: "entity-stub",
		EDGE_TARGET_FIRST: "edge-target-first",
		SPINNER: "spinner",
		ANNOTATED_BODY: "annotated-body",
		ANNOTATED_CONTENT: "annotated-content",
		ANNOTATION_RAIL: "annotation-rail",
		ANNOTATION_GLYPH_RAIL: "annotation-glyph-rail",
		ANNOTATION_CARD: "annotation-card",
		ANNOTATION_CARD_LINK: "annotation-card-link",
		ANNOTATION_TOGGLE: "annotation-toggle",
		ANNOTATION_HIGHLIGHT: "annotation-highlight",
		ENTITY_CONTROLS: "entity-controls",
		FROM_STORE: "entity-from-store",
	},
	MONITOR: {
		/** What a step produced, shown on its own row: a screenshot taken during it. */
		PRODUCED: "monitor-produced",
		/** Whether the steps run to carry other steps out are shown. */
		SUBSTEPS: "monitor-substeps",
		/** On a substep's row, the step it was run to carry out. */
		ESTABLISHED_BY: "monitor-established-by",
		LOG_STREAM: "monitor-log-stream",
		LOG_ROW: "monitor-log-row",
		/** The run's first row: on the page only once the start of the run has been reached and paged in. */
		FIRST_ROW: "monitor-log-row-first",
	},
	/** The scroll rail every virtualized column and the annotated body share. */
	SCROLLBAR: {
		RAIL: "scrollbar-rail",
		THUMB: "scrollbar-thumb",
		MARKER: "scrollbar-marker",
		CURSOR: "scrollbar-cursor",
		POS_TOP: "scrollbar-pos-top",
		POS_BOTTOM: "scrollbar-pos-bottom",
	},
	SETTINGS: {
		WINDOW_SIZE: "settings-window-size",
	},
	/** A type's or a domain's view: what it is, its schema, its individuals, and the steps that return and take it. */
	TYPE_COLUMN: {
		DESCRIPTION: "type-description",
		SYSTEM_SCHEMA: "type-system-schema",
		SCHEMA_SCOPE: "type-schema-scope",
		SCHEMA_GRAPH: "type-schema-graph",
		VALUES: "type-values",
		RETURNED_BY: "type-returned-by",
		TAKEN_BY: "type-taken-by",
		INSTANCES: "type-instances",
		ERROR: "type-error",
	},
	/** An action, by the steps this page may call that it allows. */
	ACTION_COLUMN: {
		ROOT: "action-column",
		STEP: "action-column-step",
	},
	/** A step as the run declares it: its line, the domain of each argument and of what it returns, and its choice. */
	STEP_DEFINITION: {
		ROOT: "step-definition",
		PATTERN: "step-definition-pattern",
		PARAM: "step-definition-param",
		PRODUCTS: "step-definition-products",
		CHOOSE: "step-definition-choose",
		ERROR: "step-definition-error",
	},
	/** The list of views a deployment declares: its root, and a row named by the component it opens. */
	VIEWS_PICKER: {
		ROOT: "views-picker",
		ROW: "views-picker-row-",
	},
	PLAYBACK: {
		PLAY: "playback-play",
		SPEED: "playback-speed",
		RESTART: "playback-restart",
		LIVE: "playback-live",
	},
	COLUMN_PANE: {
		/** Minimize when the column is open, restore when it is a strip: the one control that owns that state, and on a
		 *  column whose strip caches its own clicks (the log's rail) the only way back to the column. */
		MINIMIZE: "pane-minimize",
		MAXIMIZE: "pane-maximize",
		/** Dock the column along the bottom of the app, or return a docked pane to the strip. */
		DOCK: "pane-dock",
		CONTROLS_TOGGLE: "pane-controls-toggle",
		CLOSE: "pane-close",
		SPINE: "pane-spine",
	},
	/** What the index reports about itself in the strip it collapses to: which search, and how many it found. */
	INDEX_SUMMARY: {
		ROOT: "index-summary",
	},
	/** The client cache view: what the page caches of the run. Every value has its own id, so a feature asserts cache facts
	 *  through the generic steps (`save text from {id} to {var}`, `variable {var} is …`, `matches`) rather than a probe of
	 *  its own: a source's value is `${SOURCE}${level}-${field}` (fields: events, first, newest, page, cached, cached-rows,
	 *  cursor, state); the live count at a level `${LIVE}${level}`; what the device stores of the last run at a level
	 *  `${STORE}${level}-stored` / `-extent`; an IndexedDB store's records `${IDB}${database}-${store}`. */
	CLIENT_CACHE: {
		ROOT: "client-cache-view",
		CURSOR: "client-cache-cursor",
		/** The moment the run is read around, or that its newest records are being followed. */
		READING_AT: "client-cache-reading-at",
		/** When the server last responded to this page, or that it has not. */
		SERVER: "client-cache-server",
		REGISTRY: "client-cache-registry",
		LIVE: "client-cache-live-",
		/** One source's row: this prefix and its level, then `-events`, `-first`, `-newest`, `-page`, `-cached`,
		 *  `-cached-rows`, `-cursor`, or what it is doing: `-loading` before its first read, `-disconnected` while the
		 *  stream is down, `-behind` from an announcement until a read begun after it has finished, `-loaded` when it has
		 *  read and nothing announced is unread, `-ended`, `-unavailable`. A feature waits for the state, never for a
		 *  length of time. */
		SOURCE: "client-cache-source-",
		/** One held execution's row: this prefix and its id, then `-features`, `-reading`, `-began`, `-newest`, `-read`, or
		 *  `-forget` on every run but the one being read. */
		RUN: "client-cache-run-",
		/** The list of executions this device holds. It is there once the device holds one, so it is what says a run
		 *  a page read has been written to the device and can be come back to. */
		HELD: "client-cache-held",
		/** The execution being read, named by what it ran, which is how a reader knows which one they are looking at. */
		READING: "client-cache-reading",
		/** Read the newest execution this device holds other than the one being read. */
		READ_EARLIER: "client-cache-read-earlier",
		/** What the last forget removed: the run and how many of its records went. It is there once a reader has forgotten a
		 *  run and the executions have been read again, so it is the state that says the list no longer holds that run. */
		FORGOTTEN: "client-cache-forgotten",
		IDB: "client-cache-idb-",
	},
	DOCUMENT: {
		ROOT: "document-view",
		/** A heading's block: this prefix and the heading's anchor (core's headingAnchor of its name). */
		HEADING: "doc-heading-",
	},
	/**
	 * The polymorphic graph view: one graph painted as a force cloud, a layered flow, a gantt or a sequence, with the
	 * controls that switch between them. Its ids live here because the view is shu's.
	 */
	CLASS_BROWSER: {
		ROOT: "class-browser-root",
		MODE: "class-browser-mode",
		CONTEXT_VIEW: "class-browser-context",
		FIT: "class-browser-fit",
		ROTATE_XY: "class-browser-rotate-xy",
		ROTATE_Z: "class-browser-rotate-z",
		COPY_GRAPH: "class-browser-copy-graph",
		INDIVIDUALS_VIEW: "class-browser-individuals",
	},
	POLYMORPHIC_VIEW: {
		ROOT: "polymorphic-graph-view-root",
		SCENE: "polymorphic-a-scene",
		GRAPH_CONTAINER: "polymorphic-graph-container",
		A11Y: "polymorphic-a11y",
		/** The control that carries the reading on from where it stopped. */
		A11Y_READ_ON: "polymorphic-a11y-read-on",
		CAMERA: "polymorphic-main-cam",
		VIEW_TYPE: "polymorphic-view-type",
		FLATTEN: "polymorphic-flatten",
		GROUPED: "polymorphic-grouped",
		GROUP_BY: "polymorphic-group-by",
		Z_BASIS: "polymorphic-z-time",
		LABEL_AS_Z: "polymorphic-label-z",
		FIT: "polymorphic-fit",
		FOLLOW: "polymorphic-follow",
		PRUNE: "polymorphic-prune",
		READ: "polymorphic-read",
		/** Each settings group's head icon, keyed by the group it opens (see view-head's SETTINGS_GROUPS): the component
		 *  renders from this map and a driver presses from it, so the two cannot name different controls. */
		SETTINGS: {
			layout: "polymorphic-settings-layout",
			filters: "polymorphic-settings-filters",
			scenes: "polymorphic-settings-scenes",
		},
		ROTATE_XY: "polymorphic-rotate-xy",
		ROTATE_Z: "polymorphic-rotate-z",
		COPY_GRAPH: "polymorphic-copy-graph",
		LATEST_STEP: "polymorphic-latest-step",
		SCENE_PICKER: "polymorphic-scene-picker",
		SCENE_NAME: "polymorphic-scene-name",
		SCENE_SAVE: "polymorphic-scene-save",
		SCENE_ERROR: "polymorphic-scene-error",
	},
	AFFORDANCES: {
		ROOT: "shu-affordances",
		GOALS_LIST: "affordances-goals",
		EMPTY: "affordances-empty",
	},
	DOMAIN_CHAIN: {
		ROOT: "shu-domain-chain",
		GRAPH: "domain-chain-graph",
		CONTROLS: "domain-chain-toolbar",
		ERROR: "domain-chain-error",
		EMPTY: "domain-chain-empty",
		/** What a chain lint report found, and each finding. */
		FINDINGS: "domain-chain-findings",
		FINDING: "domain-chain-finding",
	},
} as const;
