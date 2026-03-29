/**
 * executor-rpc.test.ts
 *
 * End-to-end test: feature file text → phases pipeline (Collector → Expand → Resolver → Executor)
 * → executeStep → StepRegistry → handler → products.
 *
 * Verifies the unified dispatch path introduced in the RPC/core refactor:
 * all step execution goes through StepRegistry, eliminating the old Executor.action path.
 */
import { describe, it, expect } from "vitest";
import { AStepper } from "../lib/astepper.js";
import { OK } from "../schema/protocol.js";
import { actionOKWithProducts } from "../lib/util/index.js";
import { testWithWorld, getDefaultWorld } from "../lib/test/lib.js";
import type { TActionOKWithProducts } from "../schema/protocol.js";

// A stepper with products, plain ok, and failure — covers all result branches
class CounterStepper extends AStepper {
	private count = 0;

	steps = {
		increment: {
			gwta: "increment counter",
			action: async () => {
				this.count++;
				return actionOKWithProducts({ count: this.count });
			},
		},
		reset: {
			gwta: "reset counter",
			action: async () => OK,
		},
		fail: {
			gwta: "make it fail",
			action: async () => ({ ok: false as const, message: "intentional failure" }),
		},
	};
}

// A stepper with a parameterized step — verifies args flow through registry correctly
class GreetStepper extends AStepper {
	steps = {
		greet: {
			gwta: "greet {name}",
			action: async ({ name }: { name: string }) => actionOKWithProducts({ greeting: `hello, ${name}` }),
		},
	};
}

describe("Executor RPC dispatch (unified executeStep path)", () => {
	it("runs a plain ok step through the full pipeline", async () => {
		const world = getDefaultWorld();
		const result = await testWithWorld(world, "reset counter", [CounterStepper], []);
		expect(result.ok).toBe(true);
		expect(result.featureResults[0].stepResults.some(s => s.ok)).toBe(true);
	});

	it("runs a step with products through the full pipeline and products reach the step result", async () => {
		const world = getDefaultWorld();
		const result = await testWithWorld(world, "increment counter", [CounterStepper], []);
		expect(result.ok).toBe(true);
		const stepResult = result.featureResults[0].stepResults.find(s => s.stepActionResult && "products" in s.stepActionResult);
		const products = (stepResult?.stepActionResult as TActionOKWithProducts)?.products;
		expect(products?.count).toBe(1);
	});

	it("runs multiple steps and accumulates products correctly", async () => {
		const world = getDefaultWorld();
		const result = await testWithWorld(world, [
			{ path: "/f/test.feature", content: "reset counter\nincrement counter\nincrement counter" },
		], [CounterStepper], []);
		expect(result.ok).toBe(true);
		// Find the last increment result — count should be 2
		const incrementResults = result.featureResults[0].stepResults.filter(
			s => s.in === "increment counter" && "products" in (s.stepActionResult ?? {}),
		);
		const lastCount = (incrementResults[incrementResults.length - 1]?.stepActionResult as TActionOKWithProducts)?.products?.count;
		expect(lastCount).toBe(2);
	});

	it("passes parameters from feature text through registry to handler", async () => {
		const world = getDefaultWorld();
		const result = await testWithWorld(world, 'greet "world"', [GreetStepper], []);
		expect(result.ok).toBe(true);
		const stepResult = result.featureResults[0].stepResults.find(s => s.in?.includes("greet"));
		const products = (stepResult?.stepActionResult as TActionOKWithProducts)?.products;
		expect(products?.greeting).toBe("hello, world");
	});

	it("propagates step failure through the pipeline", async () => {
		const world = getDefaultWorld();
		const result = await testWithWorld(world, "make it fail", [CounterStepper], []);
		expect(result.ok).toBe(false);
		const failedStep = result.featureResults[0].stepResults.find(s => !s.ok && s.in === "make it fail");
		expect(failedStep).toBeDefined();
	});

	it("seqPath is [featureNum, scenarioNum+1, stepNum] in step results", async () => {
		const world = getDefaultWorld();
		const result = await testWithWorld(world, "reset counter", [CounterStepper], []);
		expect(result.ok).toBe(true);
		const stepResult = result.featureResults[0].stepResults.find(s => s.in === "reset counter");
		// seqPath = [featureNum=1, scenarioNum+1=1, stepNum=N]
		expect(stepResult?.seqPath[0]).toBe(1);
		expect(stepResult?.seqPath[1]).toBe(1);
	});

	it("stops on first failure and does not run subsequent steps", async () => {
		const world = getDefaultWorld();
		const result = await testWithWorld(world, [
			{ path: "/f/test.feature", content: "make it fail\nincrement counter" },
		], [CounterStepper], []);
		expect(result.ok).toBe(false);
		// increment counter should not have run
		const incrementRan = result.featureResults[0].stepResults.some(s => s.in === "increment counter");
		expect(incrementRan).toBe(false);
	});
});
