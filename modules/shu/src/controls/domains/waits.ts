/** How long a control waits on the page, and the input events it dispatches. */

/** How long a control waits for a state the page reaches soon after it acts: a render, a debounced repaint. */
export const STATE_MS = 5_000;
/** How long a control waits for a state that takes a round trip through actuality: a save, a read back. */
export const ROUND_TRIP_MS = 10_000;
/** How long a control waits for a layout or a stream to come to rest. */
export const SETTLES_MS = 15_000;
/** The events a control dispatches as a person's input starts them. */
export const INPUT_EVENT = { click: "click", pointerdown: "pointerdown", wheel: "wheel" } as const;
/** What a report names where a point doesn't hold an element. */
export const NO_ELEMENT = "∅";
