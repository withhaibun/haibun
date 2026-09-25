/**
 * A graph's focus/dim decision: one pure function every element kind (node, edge line, edge label, group
 * enclosure) runs, mapping the resulting tier to its own opacity/colour constants. A preview (a type hovered in the
 * filter legend, or the nodes of a path a reader points at) takes precedence over node focus: while a preview is
 * active only what it lights stays full.
 */
export type FocusState = "full" | "dimmed" | "resting";

/** What a preview lights: every node of a type, or a set of nodes. */
export type TGraphPreview = { type: string } | { subjects: ReadonlySet<string> };

/** Whether a preview lights a node. */
export const previewLights = (preview: TGraphPreview, node: { id: string; type: string }): boolean =>
	"type" in preview ? node.type === preview.type : preview.subjects.has(node.id);

export interface FocusPolicyInput {
	focusActive: boolean; // a node is focused (selectedSubject ?? hoverSubject != null)
	isInFocus: boolean; // this element is the focus node / an incident edge / the focused type's group
	previewActive: boolean; // a preview is active
	matchesPreview: boolean; // the preview lights this element
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
