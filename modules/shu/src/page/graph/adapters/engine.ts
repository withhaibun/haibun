/**
 * The engine governor, the only code that touches the library engine's pacing. The library's forces are removed (the
 * scene places nodes itself), so its ticks only move sprites: a pinned node tracks its pin, an unpinned one stands
 * still and stays put. Every consumer states intent: settle after a data feed (tick briefly so the sprites reach
 * their placed positions), hold for a tween or drag (tick continuously; pins move each frame), freeze at rest. "Who
 * controls the engine" names one place, and the mode is observable.
 */
import type { TGraphEngine, TGraphEngineMode, TGraphEnginePacing } from "../ports.js";

const DATA_SETTLE_TICKS = 1; // the feed is placed before it lands, so one tick moves every sprite to its position
const HOLD_TICKS = 1_000_000; // effectively "keep ticking until `freeze`" (tween/drag drive pins each frame)

/** Paces the graph's library engine. The scene reads it through `TGraphEngine`, which the page's graph root builds. */
export class EngineGovernor implements TGraphEngine {
	private graph?: TGraphEnginePacing;
	mode: TGraphEngineMode = "idle";

	/**
	 * Attach the object whose pacing props apply synchronously: the inner three-forcegraph instance, not the VR
	 * wrapper (the wrapper forwards props through two debounced digests, so a cooldown set mid-stop lands frames
	 * late and the engine re-stops on the stale value). The library also stops the engine on a 15s wall-clock
	 * cooldown independent of tick limits; disable it so these tick limits are the only stop.
	 */
	attach(paced: TGraphEnginePacing): void {
		this.graph = paced;
		paced.cooldownTime(Number.POSITIVE_INFINITY);
	}

	/** A placed feed landed: tick briefly so the sprites reach their positions, then rest. */
	settle(): void {
		this.graph?.cooldownTicks(DATA_SETTLE_TICKS);
		this.mode = "settling";
	}

	/** A tween or drag needs the engine ticking continuously (pins are applied per tick); `freeze` ends it. */
	hold(): void {
		this.graph?.cooldownTicks(HOLD_TICKS);
		this.graph?.d3ReheatSimulation();
		this.mode = "holding";
	}

	/** Stop ticking now; the positions are where they should be. */
	freeze(): void {
		this.graph?.cooldownTicks(0);
		this.mode = "frozen";
	}

	/** Wired to the library's engine-stop: records that the engine rests, and returns whether this stop ended motion.
	 * The cooldown is pinned to zero at rest so a later purely visual repool (the library restarts its countdown
	 * whenever a colour accessor is re-set, and the focus dimming must re-pool link colour) cannot silently tick past
	 * the rest. That restart still reports a stop on its first tick; a stop reported while already frozen did not end a
	 * motion, and a consumer that re-pools colours on coming to rest must not take that stop for another rest. */
	engineStopped(): boolean {
		const endedMotion = this.mode !== "frozen";
		this.mode = "frozen";
		this.graph?.cooldownTicks(0);
		return endedMotion;
	}
}
