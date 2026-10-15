/**
 * The order of a cycle method is derived once for each set of steppers and each method, the sync and async cycles read it,
 * and a change to the set derives it again (PF34, CP7R3).
 */
import { describe, expect, it } from "vitest";
import { AStepper, CycleWhen, type IHasCycles, type IStepperCycles, type IStepperWhen } from "../domains/stepper.js";
import { cycleOrder } from "./cycle-order.js";
import { doStepperCycle, doStepperCycleSync } from "../pipelines/stepper-cycles.js";

const ran: string[] = [];

/** A stepper that records its name each time a cycle method runs, at the position it states. */
const cycling = (name: string, cyclesWhen: IStepperWhen): AStepper & IHasCycles =>
	new (class extends AStepper implements IHasCycles {
		description = `Records ${name} as each cycle runs.`;
		steps = {};
		cyclesWhen = cyclesWhen;
		cycles: IStepperCycles = { startFeature: () => void ran.push(name), onEvent: () => void ran.push(name) };
	})();

describe("the order of a cycle", () => {
	it("runs each stepper at the position it states, and keeps the loaded order within a position", async () => {
		ran.length = 0;
		const steppers = [cycling("middle", {}), cycling("last", { startFeature: CycleWhen.LAST }), cycling("first", { startFeature: CycleWhen.FIRST }), cycling("also middle", {})];
		await doStepperCycle(steppers, "startFeature", { resolvedFeature: { path: "/f", base: "/", name: "f", featureSteps: [] }, index: 0 });
		expect(ran).toEqual(["first", "middle", "also middle", "last"]);
	});

	it("is derived once for a set of steppers, and the sync cycle reads the same order", () => {
		ran.length = 0;
		const steppers = [cycling("b", { onEvent: 1 }), cycling("a", { onEvent: -1 })];
		const order = cycleOrder(steppers, "onEvent");
		expect(cycleOrder(steppers, "onEvent"), "the held order").toBe(order);
		doStepperCycleSync(steppers, "onEvent", { id: "e", timestamp: 0, kind: "log", level: "info", message: "m", source: "haibun" });
		expect(ran).toEqual(["a", "b"]);
	});

	it("is derived again once a stepper joins the set", () => {
		const steppers = [cycling("a", {})];
		const before = cycleOrder(steppers, "startFeature");
		steppers.push(cycling("b", { startFeature: CycleWhen.FIRST }));
		const after = cycleOrder(steppers, "startFeature");
		expect(after).not.toBe(before);
		expect(after.map((stepper) => stepper.description)).toEqual(["Records b as each cycle runs.", "Records a as each cycle runs."]);
	});
});
