/**
 * The force-family layout configuration, lifted out of the view so the physics can be edited in one place without
 * touching the rest of the graph system. It registers the charge / collide / link / cohesion (groupX,groupY) d3 forces
 * on the live simulation; the constants and the sprite-sized collide live alongside it in ../layout-forces.ts. The
 * caller passes a fresh context every feed because d3 caches each force's accessor at the feed's `initialize`, so the
 * anchors and lane targets refresh only through that re-registration.
 */
import { forceX, forceY } from "d3-force-3d";
import { groupKeyOf, type GroupKeyMode, type GroupAnchor, COHESION_STRENGTH } from "../grouping.js";
import { CHARGE, GROUPED_CHARGE, CONTAIN_STRENGTH, GROUPED_LINK_STRENGTH, PINNED_STRENGTH, collideForce, collideRadius, LINK_DISTANCE_PAD } from "./layout-forces.js";
import { type FGNode, type FGLink, linkEndId } from "./polymorphic-graph-types.js";

/** The slice of the force-graph instance the configuration touches: getting and (re)setting named d3 forces. */
type ForceConfigurable = { d3Force: (name: string, force?: unknown) => unknown };

export type ForceContext = {
	grouped: boolean; // grouping is active (a lane view suppresses it even when the toggle is on)
	suppressesGrouping: boolean; // the active render type owns positions via lanes, so the link springs go nearly off
	groupBy: GroupKeyMode;
	anchors: Map<string, GroupAnchor>; // each group's pack anchor, by group key
	nodeMap: Map<string, FGNode>; // resolves a link endpoint id to its node for the collide-aware link distance
	lanePlacement: (id: string) => { x?: number; y: number } | undefined; // gantt/sequence lane {y} or the td/lr layered {x,y}; the free force returns undefined
};

export function configureForces(graph: ForceConfigurable, ctx: ForceContext): void {
	const { grouped } = ctx;
	const charge = graph.d3Force("charge");
	// Grouped: softer repulsion, so each group settles into a compact disc the ring layout's footprint estimate
	// matches: full-strength charge inflates the discs ~3× and the enclosure boxes overlap.
	if (charge && typeof charge === "object" && "strength" in charge) (charge as { strength: (fn: () => number) => unknown }).strength(() => (grouped ? GROUPED_CHARGE : CHARGE));
	graph.d3Force("collide", collideForce());
	// Grouping wins over the wiring: cross-group links (hundreds of seqPath/audience edges) would otherwise drag whole
	// groups through each other, so while grouped the link force is nearly off and cohesion owns the layout. A lane view
	// likewise lets the lane discipline (not the springs) own positions, so its link force is nearly off too.
	type LinkStrengthFn = (l: unknown, i: number, all: unknown[]) => number;
	const linkForce = graph.d3Force("link") as
		| ({ strength: ((s: LinkStrengthFn) => unknown) & (() => LinkStrengthFn) } & { distance: (fn: (l: FGLink) => number) => unknown })
		| undefined;
	if (linkForce && "strength" in linkForce) {
		const defaultLinkStrength = linkForce.strength();
		linkForce.strength((l, i, all) => (grouped || ctx.suppressesGrouping ? GROUPED_LINK_STRENGTH : defaultLinkStrength(l, i, all)));
		// Rest length sized to clear both endpoints' labels (collide half-widths) plus a pad, so the spring's target
		// matches collision instead of opposing it, connected nodes settle close and edges read short, not stretched.
		const endRadius = (e: FGLink["source"]): number => {
			const n = ctx.nodeMap.get(linkEndId(e));
			return n ? collideRadius(n) : 0;
		};
		linkForce.distance((l) => endRadius(l.source) + endRadius(l.target) + LINK_DISTANCE_PAD);
	}
	// Cohesion toward each group's pack anchor.
	const anchorOf = (n: unknown): GroupAnchor | undefined => ctx.anchors.get(groupKeyOf(n as FGNode, ctx.groupBy));
	// The pinned target (a gantt/sequence lane, or the td/lr layered flow). For a lane view it is the SAME placement the
	// pipeline reads for node-z, so the force target and the data-assigned z can never diverge mid-settle; the layered flow
	// sets only {x,y} (its z stays the recorded-time depth). The free force returns undefined.
	const lanePlace = (n: unknown): { x?: number; y: number } | undefined => ctx.lanePlacement((n as FGNode).id);
	// A pinned view holds each node firmly at its placement: a gantt/sequence lane on {y} at x=0, or the td/lr layered flow
	// on {x,y}. Grouped: pull each node to its group's pack anchor (cohesion). Otherwise a gentle pull to the origin so the
	// layout stays bounded.
	const strength = (n: unknown): number => (lanePlace(n) ? PINNED_STRENGTH : grouped ? COHESION_STRENGTH : CONTAIN_STRENGTH);
	const groupXTarget = (n: unknown): number => {
		const lp = lanePlace(n);
		return lp ? (lp.x ?? 0) : grouped ? (anchorOf(n)?.x ?? 0) : 0;
	};
	const groupYTarget = (n: unknown): number => lanePlace(n)?.y ?? (grouped ? (anchorOf(n)?.y ?? 0) : 0);
	graph.d3Force("groupX", forceX(groupXTarget).strength(strength));
	graph.d3Force("groupY", forceY(groupYTarget).strength(strength));
}
