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
		TIMELINE_POPOVER: "app-timeline-popover",
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
		SEQUENCE_DIAGRAM: "monitor-sequence-diagram",
	},
	SETTINGS: {
		WINDOW_SIZE: "settings-window-size",
	},
	TIMELINE: {
		ROOT: "shu-timeline",
		SLIDER: "timeline-slider",
		PLAY_PAUSE: "timeline-play",
		SPEED: "timeline-speed",
		RESTART: "timeline-restart",
		TIME_DISPLAY: "timeline-time",
	},
	COLUMN_PANE: {
		MAXIMIZE: "pane-maximize",
		CONTROLS_TOGGLE: "pane-controls-toggle",
	},
	DOCUMENT: {
		ROOT: "document-view",
	},
	GRAPH_VIEW: {
		ROOT: "graph-view-toolbar",
		CONTROLS: "graph-view-toolbar",
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
