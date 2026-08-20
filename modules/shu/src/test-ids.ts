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
		/** An action this reader holds. A reference, so pressing it opens the record of what granted it. */
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
	},
	/** The scroll rail every virtualized column and the annotated body share. */
	SCROLLBAR: {
		RAIL: "scrollbar-rail",
		THUMB: "scrollbar-thumb",
		MARKER: "scrollbar-marker",
		POS_TOP: "scrollbar-pos-top",
		POS_BOTTOM: "scrollbar-pos-bottom",
	},
	SETTINGS: {
		WINDOW_SIZE: "settings-window-size",
	},
	/** Moving the shared time cursor on its own: where it IS is the log's scroll rail. */
	PLAYBACK: {
		ROOT: "shu-playback",
		PLAY: "playback-play",
		SPEED: "playback-speed",
		RESTART: "playback-restart",
	},
	COLUMN_PANE: {
		MAXIMIZE: "pane-maximize",
		CONTROLS_TOGGLE: "pane-controls-toggle",
		SPINE: "pane-spine",
	},
	/** What the index says about itself in the strip it collapses to: which search, and how many it found. */
	INDEX_SUMMARY: {
		ROOT: "index-summary",
	},
	DOCUMENT: {
		ROOT: "document-view",
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
