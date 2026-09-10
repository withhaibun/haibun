/**
 * A graph's focus/dim decision: one pure function every element kind (node, edge line, edge label, group
 * enclosure) runs, mapping the resulting tier to its own opacity/colour constants. Preview (a type hovered in the
 * filter legend) takes precedence over node focus, while a preview is active only the previewed type stays full.
 */
export type FocusState = "full" | "dimmed" | "resting";

export interface FocusPolicyInput {
	focusActive: boolean; // a node is focused (selectedSubject ?? hoverSubject != null)
	isInFocus: boolean; // this element is the focus node / an incident edge / the focused type's group
	previewActive: boolean; // a filter type is hovered (previewType != null)
	matchesPreview: boolean; // this element belongs to the previewed type
}

export function focusStateFor(i: FocusPolicyInput): FocusState {
	if (i.previewActive) return i.matchesPreview ? "full" : "dimmed";
	if (!i.focusActive) return "resting";
	return i.isInFocus ? "full" : "dimmed";
}

/** Per-kind opacity for each tier: the resting tier differs by kind (lines rest at LINK_OPACITY, others at full). */
export interface KindTiers {
	full: number;
	dimmed: number;
	resting: number;
}

export const opacityFor = (state: FocusState, tiers: KindTiers): number => tiers[state];

/** The colour axis (lines/labels) reuses the same tri-state: full → focus colour, otherwise the resting colour. */
export const isFullContrast = (state: FocusState): boolean => state === "full";
