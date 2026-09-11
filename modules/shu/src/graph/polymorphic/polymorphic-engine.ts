/**
 * The engine governor: the ONLY code that touches the library engine's pacing. The library's forces are removed
 * (the scene places nodes itself, see polymorphic-layout.ts), so its ticks only move sprites: a pinned node tracks its
 * pin, an unpinned one has no velocity and stays put. Every consumer states INTENT: settle after a data feed (tick
 * briefly so the sprites reach their placed positions), hold for a tween or drag (tick continuously; pins move each
 * frame), freeze at rest. "Who controls the engine" has one answer, and the mode is observable.
 */

export type TEngineMode = "idle" | "settling" | "holding" | "frozen";

export type TPacedGraph = {
	cooldownTicks(n: number): unknown;
	cooldownTime(ms: number): unknown;
	d3ReheatSimulation(): unknown;
};

const DATA_SETTLE_TICKS = 40; // enough frames for sprites to reach a placed feed and fresh-link particles to run
const HOLD_TICKS = 1_000_000; // effectively "keep ticking until told otherwise" (tween/drag drive pins each frame)

export class EngineGovernor {
	private graph?: TPacedGraph;
	mode: TEngineMode = "idle";

	/**
	 * Attach the object whose pacing props apply SYNCHRONOUSLY: the inner three-forcegraph instance, not the VR
	 * wrapper (the wrapper forwards props through two debounced digests, so a cooldown set mid-stop lands frames
	 * late and the engine re-stops on the stale value). The lib also stops the engine on a 15s WALL CLOCK
	 * (cooldownTime) independent of tick limits, disable it so this governor's tick limits are the only stop.
	 */
	attach(graph: TPacedGraph): void {
		this.graph = graph;
		graph.cooldownTime(Number.POSITIVE_INFINITY);
	}

	/** A placed feed landed: tick briefly so the sprites reach their positions, then rest. */
	settle(): void {
		this.graph?.cooldownTicks(DATA_SETTLE_TICKS);
		this.mode = "settling";
	}

	/** A tween or drag needs the engine ticking continuously (pins are applied per tick); freeze() ends it. */
	hold(): void {
		this.graph?.cooldownTicks(HOLD_TICKS);
		this.graph?.d3ReheatSimulation();
		this.mode = "holding";
	}

	/** Stop ticking now, positions are where they should be. */
	freeze(): void {
		this.graph?.cooldownTicks(0);
		this.mode = "frozen";
	}

	/** Wired to the lib's onEngineStop: records that the engine rests, and returns whether this stop ended motion.
	 * The cooldown is pinned to 0 at rest so a later purely VISUAL repool (the lib restarts its countdown whenever a
	 * colour accessor is re-set, and the focus dimming must re-pool linkColor) can't silently tick past the rest. That
	 * restart still reports a stop on its first tick. A stop reported while already frozen ended nothing, and a
	 * consumer that re-pools colours on coming to rest must not take that stop for another rest. */
	engineStopped(): boolean {
		const endedMotion = this.mode !== "frozen";
		this.mode = "frozen";
		this.graph?.cooldownTicks(0);
		return endedMotion;
	}
}
