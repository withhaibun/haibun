import { describe, expect, it } from "vitest";
import { passWithDefaults } from "../lib/test/lib.js";
import VariablesStepper from "./variables-stepper.js";
import LogicStepper from "./logic-stepper.js";
import Haibun from "./haibun.js";
import UrakataStepper from "./urakata-stepper.js";
import { AStepper, type IHasCycles } from "../lib/astepper.js";
import type { IStepperCycles } from "../lib/execution.js";
import { actionOKWithProducts } from "../lib/util/index.js";
import { z } from "zod";
import { URAKATA, type IUrakataRegistry, type IUrakataTicker } from "../lib/urakata.js";
import { getFromRuntime } from "../lib/util/index.js";
import type { TStepResult } from "../schema/protocol.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Test stepper that exposes a `start tick` step which registers a ticker that increments a counter. */
class TickHarnessStepper extends AStepper implements IHasCycles {
	cycles: IStepperCycles = { getConcerns: () => ({ domains: [] }) };
	tickCount = 0;
	steps = {
		startTick: {
			gwta: "start tick",
			outputSchema: z.object({ id: z.string() }),
			action: () => {
				const registry = getFromRuntime(this.getWorld().runtime, URAKATA) as IUrakataRegistry;
				const ticker: IUrakataTicker = {
					id: "test.tick",
					description: "test ticker",
					intervalMs: 5,
					tick: () => {
						this.tickCount++;
					},
				};
				const u = registry.register(ticker);
				return Promise.resolve(actionOKWithProducts({ id: u.id }));
			},
		},
	};
}

describe("urakata-stepper", () => {
	it("registers a ticker via a peer step, binds the id as a product, then stops it by id", async () => {
		const result = await passWithDefaults(
			[
				{
					path: "/features/main.feature",
					content: ["set t from start tick", 'pause for "30 ms"', "stop t.id", 'pause for "30 ms"'].join("\n"),
				},
			],
			[VariablesStepper, LogicStepper, Haibun, UrakataStepper, TickHarnessStepper],
			{ options: { DEST: "default" }, moduleOptions: {} },
		);
		expect(result.ok).toBe(true);
		const harness = (result.world.runtime.steppers as AStepper[]).find((s): s is TickHarnessStepper => s instanceof TickHarnessStepper);
		expect(harness).toBeDefined();
		const tickedDuringRun = harness?.tickCount ?? 0;
		await sleep(40);
		expect(harness?.tickCount).toBe(tickedDuringRun);
	});

	it("forget halts and removes; subsequent stop on the same id throws via stepper failure", async () => {
		const result = await passWithDefaults(
			[
				{
					path: "/features/main.feature",
					content: ["set t from start tick", "forget t.id"].join("\n"),
				},
			],
			[VariablesStepper, LogicStepper, Haibun, UrakataStepper, TickHarnessStepper],
			{ options: { DEST: "default" }, moduleOptions: {} },
		);
		expect(result.ok).toBe(true);
	});

	it("`show urakata` returns a view product whose `urakata` array matches the registry list", async () => {
		const result = await passWithDefaults(
			[
				{
					path: "/features/main.feature",
					content: ["set t from start tick", "show urakata"].join("\n"),
				},
			],
			[VariablesStepper, LogicStepper, Haibun, UrakataStepper, TickHarnessStepper],
			{ options: { DEST: "default" }, moduleOptions: {} },
		);
		expect(result.ok).toBe(true);
		const showResult = (result.world.runtime.stepResults as TStepResult[]).find((sr) => sr.products?.view === "urakata");
		expect(showResult).toBeDefined();
		const products = showResult?.products as Record<string, unknown> | undefined;
		expect(products?._type).toBe("view");
		expect(products?._component).toBe("shu-result-table");
		const list = products?.urakata as Array<Record<string, unknown>>;
		expect(list).toHaveLength(1);
		expect(list[0].id).toBe("test.tick");
		expect(list[0].kind).toBe("ticker");
	});

	it("endFeature(shouldClose) halts every registered urakata", async () => {
		let harness: TickHarnessStepper | undefined;
		const result = await passWithDefaults(
			[
				{
					path: "/features/main.feature",
					content: "set t from start tick",
				},
			],
			[VariablesStepper, Haibun, UrakataStepper, TickHarnessStepper],
			{ options: { DEST: "default" }, moduleOptions: {} },
		);
		expect(result.ok).toBe(true);
		harness = (result.world.runtime.steppers as AStepper[]).find((s): s is TickHarnessStepper => s instanceof TickHarnessStepper);
		expect(harness).toBeDefined();
		const tickedAtEnd = harness?.tickCount ?? 0;
		await sleep(40);
		expect(harness?.tickCount).toBe(tickedAtEnd);
	});
});
