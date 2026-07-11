/**
 * The one hypermedia navigation router, kept free of any custom-element (HTMLElement) definition so it is importable in
 * any context — a component, a graph click handler, a node test — without dragging a DOM class into the module graph.
 * Maps a typed reference (seqPath / entity / domain / step) to the pane it opens via PaneState.requestFrom, so every
 * node/link navigation routes through one place and the link vocabulary stays consistent. The <shu-ref> element and the
 * graph views both call openRef; none reimplements the routing.
 */
import { PaneState } from "../pane-state.js";

export const REF_KIND = ["seqPath", "entity", "domain", "step"] as const;
export type TRefKind = (typeof REF_KIND)[number];

export function isRefKind(v: string): v is TRefKind {
	return (REF_KIND as readonly string[]).includes(v);
}

export function openRef(source: Element | Event, kind: TRefKind, linkTarget: Record<string, unknown>): void {
	if (kind === "seqPath" && Array.isArray(linkTarget.seqPath)) {
		// Typed-fact subjects ARE seqPaths, so a seqPath ref doubles as the quad-view link: step-detail loads every quad
		// emitted at that seqPath (including the fact), drillable into individual quads from there.
		PaneState.requestFrom(source, { paneType: "step-detail", seqPath: linkTarget.seqPath as number[] });
		return;
	}
	if (kind === "entity" && typeof linkTarget.persistedAs === "string" && typeof linkTarget.id === "string") {
		PaneState.requestFrom(source, { paneType: "entity", persistedAs: linkTarget.persistedAs, id: linkTarget.id });
		return;
	}
	if (kind === "domain" && typeof linkTarget.domain === "string") {
		// A type reference opens the type column: its description, schema graph, and individuals.
		PaneState.requestFrom(source, { paneType: "type", persistedAs: linkTarget.domain });
		return;
	}
	// step kind: no dedicated pane yet — fall through (no-op), so a link renders non-functional rather than crashing.
}
