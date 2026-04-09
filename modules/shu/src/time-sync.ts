/** Shared constants and CSS for time-sync dimming across all shu views. */

export const TIME_SYNC_CLASS = {
	FUTURE: "future-event",
	CURRENT: "time-current",
} as const;

export const TIME_SYNC_STYLE = {
	HIGHLIGHT: "#E87A5D",
	DIMMED_OPACITY: 0.4,
} as const;

/** CSS rules for time-sync dimming — auto-included by ShuElement.css(). */
export const TIME_SYNC_CSS = `
.${TIME_SYNC_CLASS.FUTURE} { opacity: ${TIME_SYNC_STYLE.DIMMED_OPACITY}; }
.${TIME_SYNC_CLASS.CURRENT} { background: ${TIME_SYNC_STYLE.HIGHLIGHT}22; border-left: 3px solid ${TIME_SYNC_STYLE.HIGHLIGHT}; }
`;
