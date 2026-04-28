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
		TWISTY: "app-ask-button",
		CHAT_INPUT: "app-chat-input",
		CHAT_SUBMIT: "app-chat-submit",
		STEP_SELECT: "app-step-select",
		MODE_SELECT: "app-mode-select",
		TYPE_SELECT: "app-type-select",
		FOLDER_SELECT: "app-folder-select",
		TEXT_SEARCH: "app-text-search",
		ADD_FILTER: "app-add-filter",
		SEARCH_GO: "app-search-go",
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
		ROOT: "column-browser",
		COLUMN: "browser-column",
		ENTITY_DETAILS: "entity-details",
		PREDICATE_LINK: "predicate-link",
		PREDICATE_LINK_FIRST: "predicate-link-first",
		BODY_IFRAME: "email-body-iframe",
		REF_SECTION: "ref-section",
		ENTITY_STUB: "entity-stub",
		EDGE_TARGET_FIRST: "edge-target-first",
		ASK_BUTTON: "ask-button",
		CHAT_FORM: "chat-form",
		CHAT_INPUT: "chat-input",
		CHAT_SUBMIT: "chat-submit",
		CHAT_STOP: "chat-stop",
		CHAT_OUTPUT: "chat-output",
		SPINNER: "spinner",
	},
	MONITOR: {
		LOG_STREAM: "monitor-log-stream",
		LOG_ROW: "monitor-log-row",
		SEQUENCE_DIAGRAM: "monitor-sequence-diagram",
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
	},
	DOCUMENT: {
		ROOT: "document-view",
	},
	GRAPH_VIEW: {
		ROOT: "graph-view-toolbar",
	},
} as const;
