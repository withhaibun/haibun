/**
 * Where the nodes go. A layout writes each node's x/y from the graph's own physics: the charge, collide, link and
 * cohesion forces configured in force-layout.ts, and honours the fx/fy pins a drag, a lane or a group sets. The
 * simulation is 2D: z is the time axis, assigned from data at each repaint, and physics never touches it.
 *
 * The graph library runs the same simulation internally, which is why the force views' positions were only ever
 * available inside it. Running it here makes every view's positions the scene's own, computed before anything displays
 * them, so a renderer for another medium draws the force views too and the placing is testable without WebGL.
 */
import { forceLink, forceManyBody, forceSimulation, type Simulation } from "d3-force-3d";
import { ALPHA_DECAY, VELOCITY_DECAY } from "./layout-forces.js";
import { configureForces, type ForceContext } from "./force-layout.js";
import { linkEndId, type FGLink, type FGNode } from "./polymorphic-graph-types.js";

/** How a scene places its nodes. */
export interface IGraphLayout {
	/** Write x/y for every node, leaving pinned ones where they are pinned. */
	place(nodes: FGNode[], links: FGLink[], opts?: { damped?: boolean }): void;
}

/** Heavy friction for a streamed clump: newcomers settle near their seeds instead of flying across the layout. */
const DAMPED_VELOCITY_DECAY = 0.82;
/** Total tick spend for one placement, split by node count so a big graph cannot stall the main thread. */
const PLACE_TICK_BUDGET = 40_000;
/** A damped placement's tick count, newcomers only move a short way, so a long run buys nothing. */
const DAMPED_TICKS = 40;

/** Ticks one placement runs: budget over size, clamped so a small graph settles fully and a big one stays responsive. */
function placeTicksFor(nodeCount: number, damped = false): number {
	if (damped) return DAMPED_TICKS;
	return Math.max(30, Math.min(130, Math.round(PLACE_TICK_BUDGET / Math.max(nodeCount, 1))));
}

/**
 * The graph's own force placement. The three forces the library starts with are registered here for the same reason it
 * registers them, a link spring, repulsion between nodes, and a pull toward the centre, and configureForces then
 * applies this graph's physics on top, exactly as it applied them to the library's simulation.
 */
export function forceLayout(ctx: ForceContext): IGraphLayout {
	const sim: Simulation = forceSimulation().numDimensions(2).alphaDecay(ALPHA_DECAY);
	sim.force(
		"link",
		forceLink().id((n: never) => (n as FGNode).id),
	);
	sim.force("charge", forceManyBody());
	// No centre force. d3-force-3d's forceCenter recentres z unconditionally, numDimensions(2) does not spare it:
	// and z is the time axis, data-owned: the first placement shifted every node's depth by the cloud's z-mean, the
	// camera framed the shifted cloud, and the next merge's re-assigned data z snapped the whole graph out of frame.
	// Bounding the layout is already configureForces' containment (groupX/groupY pull free nodes to the origin), and
	// d3 itself documents forceCenter's hard mean-translation as incompatible with those positioning forces.
	sim.stop();
	configureForces({ d3Force: (name: string, force?: unknown) => (force === undefined ? sim.force(name) : sim.force(name, force)) }, ctx);

	return {
		place(nodes, links, opts) {
			const damped = opts?.damped ?? false;
			sim.velocityDecay(damped ? DAMPED_VELOCITY_DECAY : VELOCITY_DECAY);
			sim.nodes(nodes);
			const link = sim.force("link") as { links(l: unknown[]): unknown } | undefined;
			// Resolve the ORIGINAL links' endpoints: d3's link force replaces each id with its node reference, and every
			// consumer of these links, the tween, the library positioning its lines, reads endpoints from them. The
			// library's forces are removed, so this is the one resolver. A link naming a node that is not in the set
			// throws here, which is the defect it would be.
			for (const l of links) {
				l.source = linkEndId(l.source);
				l.target = linkEndId(l.target);
			}
			link?.links(links);
			// Every node pinned means nothing can move, the common streamed merge that only updates properties, so the
			// synchronous tick loop is skipped and the main thread does only the link resolution the drawn lines need.
			if (nodes.every((n) => n.fx !== undefined)) return;
			sim.alpha(1);
			const ticks = placeTicksFor(nodes.length, damped);
			for (let i = 0; i < ticks; i++) sim.tick();
			sim.stop();
		},
	};
}
