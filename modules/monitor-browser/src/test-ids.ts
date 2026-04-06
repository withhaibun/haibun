export const TEST_IDS = {
	APP: {
		ROOT: "app-root",
		HEADER: "app-header",
		MAIN: "app-main",
		TIMELINE: "app-timeline",
		DETAILS_PANEL: "app-details-panel",
	},
	HEADER: {
		TITLE: "header-title",
		STATUS_BADGE: "header-status-badge",
		VIEW_MODES: "header-view-modes",
		BUTTON_VIEW_LOG: "button-view-log",
		BUTTON_VIEW_RAW: "button-view-raw",
		BUTTON_VIEW_DOCUMENT: "button-view-document",
		ARTIFACT_ICONS: "header-artifact-icons",
		TOGGLE_SEQUENCE: "header-toggle-sequence",
		TOGGLE_QUAD: "header-toggle-quad",
		TOGGLE_DEBUG: "header-toggle-debug",
		LOG_LEVEL: "header-log-level",
		MAX_DEPTH: "header-max-depth",
	},
	VIEWS: {
		LOG: "view-log",
		RAW: "view-raw",
		DOCUMENT: "view-document",
		LATEST_EVENT: "view-latest-event",
		FIRST_ROW: "view-first-row",
	},
	DETAILS: {
		RESIZE_HANDLE: "details-resize-handle",
		HEADER: "details-header",
		CLOSE_BUTTON: "details-close-button",
		RAW_SOURCE: "details-raw-source",
		ARTIFACT_RENDERER: "details-artifact-renderer",
		GRAPH_VIEWS: "details-graph-views",
		SEQUENCE_VIEW: "details-sequence-view",
		QUAD_VIEW: "details-quad-view",
	},
	TIMELINE: {
		RESTART: "timeline-restart",
		PLAY_PAUSE: "timeline-play-pause",
		SPEED: "timeline-speed",
		SLIDER: "timeline-slider",
		TIME_DISPLAY: "timeline-time-display",
		END: "timeline-end",
	},
	TIMELINE_SELECTION: {
		/** Prefix for selectable log view event rows */
		LOG_ROW_PREFIX: "log-row-",
		/** Prefix for selectable document view rows */
		DOCUMENT_ROW_PREFIX: "document-row-",
		/** Class applied to future/dimmed events */
		DIMMED_CLASS: "future-event",
	},
	DEBUGGER: {
		ROOT: "debugger-root",
		INPUT: "debugger-input",
		BUTTON_CONTINUE: "debugger-button-continue",
	},
} as const;
