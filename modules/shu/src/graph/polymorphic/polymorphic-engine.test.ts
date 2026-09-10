/**
 * The engine governor's contract: intent in, pacing out, mode observable.
 *
 * The library's forces are removed and the scene places nodes itself, so the engine's only work is moving sprites: a
 * settle ticks briefly and rests, a hold ticks until frozen, and rest pins the cooldown at zero so a purely visual
 * repool (the focus dimming re-sets a colour accessor, which restarts the lib's countdown) cannot tick past it.
 */
import { describe, expect, it } from "vitest";
import { EngineGovernor, type TPacedGraph } from "./polymorphic-engine.js";

const paced = () => {
	const calls: Array<[string, number]> = [];
	const graph: TPacedGraph = {
		cooldownTicks: (n: number) => calls.push(["cooldownTicks", n]),
		cooldownTime: (ms: number) => calls.push(["cooldownTime", ms]),
		d3ReheatSimulation: () => calls.push(["reheat", 0]),
	};
	return { graph, calls };
};

describe("what each intent does to the engine", () => {
	it("disables the wall-clock stop at attach, so tick budgets are the only stop", () => {
		const { graph, calls } = paced();
		new EngineGovernor().attach(graph);
		expect(calls).toEqual([["cooldownTime", Number.POSITIVE_INFINITY]]);
	});

	it("settles with a bounded tick budget and rests at the stop", () => {
		const { graph, calls } = paced();
		const g = new EngineGovernor();
		g.attach(graph);
		g.settle();
		expect(g.mode).toBe("settling");
		const [, ticks] = calls.at(-1) ?? [];
		expect(typeof ticks).toBe("number");
		expect(ticks).toBeGreaterThan(0);
		expect(ticks).toBeLessThan(1000); // brief: sprites reach placed positions, nothing simulates
		g.engineStopped();
		expect(g.mode).toBe("frozen");
		expect(calls.at(-1)).toEqual(["cooldownTicks", 0]); // rest pins the cooldown so a visual repool cannot tick past it
	});

	it("reports whether a stop ended motion, so a stop reported at rest is not taken for a settle", () => {
		const { graph } = paced();
		const g = new EngineGovernor();
		g.attach(graph);
		g.settle();
		expect(g.engineStopped(), "the settle came to rest").toBe(true);
		// A visual repool at rest restarts the lib's countdown, which is 0, so the lib reports a stop on its next tick.
		expect(g.engineStopped(), "a stop at rest ended nothing").toBe(false);
		g.hold();
		expect(g.engineStopped(), "the hold came to rest").toBe(true);
		g.hold();
		g.freeze();
		expect(g.engineStopped(), "frozen before the stop: it ended nothing").toBe(false);
	});

	it("holds for a tween or drag until frozen", () => {
		const { graph, calls } = paced();
		const g = new EngineGovernor();
		g.attach(graph);
		g.hold();
		expect(g.mode).toBe("holding");
		expect(calls.some(([name]) => name === "reheat")).toBe(true); // a stopped engine must restart to apply pins
		g.freeze();
		expect(g.mode).toBe("frozen");
		expect(calls.at(-1)).toEqual(["cooldownTicks", 0]);
	});
});
