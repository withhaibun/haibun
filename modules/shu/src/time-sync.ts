/** Class names a view adds to dim future rows / highlight the current-time row. The CSS for these classes lives in SHU_BASE (styles.ts) so it is adopted into every component's shadow root. */
export const TIME_SYNC_CLASS = {
	FUTURE: "future-event",
	CURRENT: "time-current",
} as const;
