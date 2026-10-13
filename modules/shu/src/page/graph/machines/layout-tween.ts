/**
 * The ghost tween of a layout change: the final layout is solved off-screen, and every node glides along one eased path
 * from where it was to where it lands, while links follow. The physics doesn't move the nodes during the glide; the tween
 * writes their pins each frame. z is the time axis, which the data owns, so the tween never writes it.
 */
import type { FGNode } from "../domains/graph-types.js";

/** Where a node is on the layout plane: the tween moves x and y alone. */
type TPlanar = { x: number; y: number };
type TActive = { start: number; from: ReadonlyMap<string, TPlanar>; to: Map<string, TPlanar> };

export class LayoutTween {
	#active: TActive | undefined;

	/** `ease` maps the elapsed share of `durationMs` to the share of the path a node has covered. */
	constructor(
		private readonly durationMs: number,
		private readonly ease: (share: number) => number,
	) {}

	get running(): boolean {
		return this.#active !== undefined;
	}

	/** The time since the running tween began, or null while a tween isn't running. */
	elapsedMs(now: number): number | null {
		return this.#active === undefined ? null : now - this.#active.start;
	}

	/**
	 * Take each placed node's target, rewind every node to its start and pin it there, so the first drawn frame is the
	 * layout before the change. `anchorId` names the node the reader last chose: the whole solved layout is translated so
	 * that node lands where it was, which keeps the reader's reference point still and the layout's shape unchanged. A node
	 * without a start, which the change revealed, starts at its target.
	 */
	begin(now: number, from: ReadonlyMap<string, TPlanar>, nodes: readonly FGNode[], anchorId: string | null): void {
		const unplaced = nodes.find((n) => n.x === undefined || n.y === undefined);
		if (unplaced) throw new Error(`LayoutTween: node ${unplaced.id} lacks a position, so the layout must place it before the tween begins`);
		const to = new Map(nodes.map((n): [string, TPlanar] => [n.id, { x: n.x as number, y: n.y as number }]));
		const anchorFrom = anchorId === null ? undefined : from.get(anchorId);
		const anchorTo = anchorId === null ? undefined : to.get(anchorId);
		if (anchorFrom && anchorTo) {
			const dx = anchorFrom.x - anchorTo.x;
			const dy = anchorFrom.y - anchorTo.y;
			for (const p of to.values()) {
				p.x += dx;
				p.y += dy;
			}
		}
		for (const n of nodes) {
			const start = from.get(n.id) ?? (to.get(n.id) as TPlanar);
			n.x = n.fx = start.x;
			n.y = n.fy = start.y;
		}
		this.#active = { start: now, from, to };
	}

	/** Ease each node's pin toward its target for the frame at `now`. Returns whether the tween has reached its end. */
	step(now: number, nodeOf: (id: string) => FGNode | undefined): boolean {
		const active = this.#active;
		if (active === undefined) throw new Error("LayoutTween: step without a running tween");
		const e = this.ease(Math.min((now - active.start) / this.durationMs, 1));
		for (const [id, f] of active.from) {
			const t = active.to.get(id);
			const n = nodeOf(id);
			if (!t || !n) continue;
			n.fx = f.x + (t.x - f.x) * e;
			n.fy = f.y + (t.y - f.y) * e;
		}
		return e >= 1;
	}

	/** End the tween: each node rests at its target, and its pin is released, except where `keepsPin` holds, since a node the
	 *  reader placed or chose stays where it is. */
	finish(nodes: Iterable<FGNode>, keepsPin: (id: string) => boolean): void {
		const active = this.#active;
		if (active === undefined) throw new Error("LayoutTween: finish without a running tween");
		for (const n of nodes) {
			const t = active.to.get(n.id);
			if (t) {
				n.x = t.x;
				n.y = t.y;
			}
			const kept = keepsPin(n.id);
			n.fx = kept ? n.x : undefined;
			n.fy = kept ? n.y : undefined;
			n.fz = kept ? n.z : undefined;
		}
		this.#active = undefined;
	}
}
