/** Primitives shared by the SVG paints (graph + sequence): XML escaping, label truncation, and an arrowhead marker. */

export const xml = (s: string): string => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Outer padding around a painted diagram. */
export const SVG_MARGIN = 16;

/** The label cap for an SVG chip: past it a label is ellipsized (core's `ellipsize`), so the chip's width is bounded. */
export const MAX_SVG_LABEL = 28;

export const ARROW_MARKER_ID = "shu-arrow";
/** An arrowhead `<marker>` def. `fill` defaults to the faded foreground; pass a colour for an emphasised paint. */
export const arrowMarker = (id: string = ARROW_MARKER_ID, fill = "var(--shu-fg-faded)"): string =>
	`<marker id="${id}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="${fill}"/></marker>`;
