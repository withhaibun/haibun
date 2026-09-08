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
		TWISTY: "app-summary-bar",
		PIN: "app-ask-button",
		CHAT_INPUT: "app-chat-input",
		CHAT_SUBMIT: "app-chat-submit",
		CHAT_OUTPUT: "app-chat-output",
		CHAT_TEXT: "app-chat-text",
		SESSION_SELECT: "app-session-select",
		STEP_SELECT: "app-step-select",
		MODE_SELECT: "app-mode-select",
		MODEL_SELECT: "app-model-select",
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
		PREDICATE_LINK: "predicate-link",
		PREDICATE_LINK_FIRST: "predicate-link-first",
		BODY_IFRAME: "email-body-iframe",
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
	/** Moving the shared time cursor on its own: where it IS is the log's scroll rail. */
	/** A bar a run's shape is read from, one per span drawn: its root and each mark carry the span's name (`run` for
	 *  the whole run, `detail` for the region around where a reader is) and a mark also carries its division. */
	TIME_BAR: {
		ROOT: "time-bar-",
		MARK: "time-bar-mark-",
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
		CONTROLS_TOGGLE: "pane-controls-toggle",
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
		/** One held execution's row: this prefix and its id, then `-features`, `-reading`, `-began`, `-newest` or `-read`. */
		RUN: "client-cache-run-",
		/** The list of executions this device holds. It is there once the device holds one, so it is what says a run
		 *  a page read has been written to the device and can be come back to. */
		HELD: "client-cache-held",
		/** The execution being read, named by what it ran, which is how a reader knows which one they are looking at. */
		READING: "client-cache-reading",
		/** Read the newest execution this device holds other than the one being read. */
		READ_EARLIER: "client-cache-read-earlier",
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
		/** Each settings group's head icon, keyed by the group it opens (see view-head's SETTINGS_GROUPS) — the component
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
	},
} as const;
