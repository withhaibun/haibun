export const TEST_IDS = {
  APP: {
    ROOT: 'app-root',
    HEADER: 'app-header',
    MAIN: 'app-main',
    TIMELINE: 'app-timeline',
    DETAILS_PANEL: 'app-details-panel',
  },
  HEADER: {
    TITLE: 'header-title',
    STATUS_BADGE: 'header-status-badge',
    VIEW_MODES: 'header-view-modes',
    ARTIFACT_ICONS: 'header-artifact-icons',
    LOG_LEVEL: 'header-log-level',
    MAX_DEPTH: 'header-max-depth',
  },
  VIEWS: {
    LOG: 'view-log',
    RAW: 'view-raw',
    DOCUMENT: 'view-document',
  },
  DETAILS: {
    RESIZE_HANDLE: 'details-resize-handle',
    HEADER: 'details-header',
    CLOSE_BUTTON: 'details-close-button',
    RAW_SOURCE: 'details-raw-source',
    ARTIFACT_RENDERER: 'details-artifact-renderer',
    GRAPH_VIEWS: 'details-graph-views',
    SEQUENCE_VIEW: 'details-sequence-view',
    QUAD_VIEW: 'details-quad-view',
  },
  TIMELINE: {
    RESTART: 'timeline-restart',
    PLAY_PAUSE: 'timeline-play-pause',
    SPEED: 'timeline-speed',
    SLIDER: 'timeline-slider',
    TIME_DISPLAY: 'timeline-time-display',
    END: 'timeline-end',
  },
  DEBUGGER: {
    ROOT: 'debugger-root',
  }
} as const;
