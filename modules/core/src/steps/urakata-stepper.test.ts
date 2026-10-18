import { describe, expect, it } from "vitest";
import { passWithDefaults } from "../lib/test/lib.js";
import VariablesStepper from "./variables-stepper.js";
import LogicStepper from "./logic-stepper.js";
import Haibun from "./haibun.js";
import UrakataStepper from "./urakata-stepper.js";
import { AStepper } from "../lib/steps/domains/stepper.js";
import { actionOKWithProducts } from "../lib/util/index.js";
import { URAKATA, URAKATA_ID_DOMAIN, type IUrakataRegistry, type IUrakataTicker } from "../lib/urakata.js";
import { getFromRuntime } from "../lib/util/index.js";
import type { TStepResult } from "../lib/domains/protocol.js";
import { itemAt } from "../lib/util/item-at.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The `start tick` step registers a ticker whose tick increments `tickCount`. */
class TickHarnessStepper extends AStepper {
	description = "Starts a ticker that counts its ticks.";
	tickCount = 0;
	steps = {
		startTick: {
			gwta: "start tick",
			productsDomains: { id: URAKATA_ID_DOMAIN },
			action: () => {
				const registry = getFromRuntime(this.getWorld().runtime, URAKATA) as IUrakataRegistry;
				const ticker: IUrakataTicker = {
					id: "test.tick",
					description: "test ticker",
					intervalMs: 5,
					needs: [],
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
	it("`stop urakata` stops a ticker by the id that another stepper's step returns as a product", async () => {
		const result = await passWithDefaults(
			[{ path: "/features/main.feature", content: ["set t from start tick", 'pause for "30 ms"', "stop urakata t.id", 'pause for "30 ms"'].join("\n") }],
			[VariablesStepper, LogicStepper, Haibun, UrakataStepper, TickHarnessStepper],
			{ options: { DEST: "default" }, moduleOptions: {} },
		);
		expect(result.ok).toBe(true);
		const harness = result.world.runtime.steppers?.find((s): s is TickHarnessStepper => s instanceof TickHarnessStepper);
		expect(harness).toBeDefined();
		const tickedDuringRun = harness?.tickCount ?? 0;
		await sleep(40);
		expect(harness?.tickCount).toBe(tickedDuringRun);
	});

	it("`forget urakata` stops the ticker and removes it from the registry", async () => {
		const result = await passWithDefaults(
			[{ path: "/features/main.feature", content: ["set t from start tick", "forget urakata t.id"].join("\n") }],
			[VariablesStepper, LogicStepper, Haibun, UrakataStepper, TickHarnessStepper],
			{ options: { DEST: "default" }, moduleOptions: {} },
		);
		expect(result.ok).toBe(true);
	});

	it("`show urakata` returns `urakata-list` products whose `urakata` array holds the registry list", async () => {
		const result = await passWithDefaults(
			[{ path: "/features/main.feature", content: ["set t from start tick", "show urakata"].join("\n") }],
			[VariablesStepper, LogicStepper, Haibun, UrakataStepper, TickHarnessStepper],
			{ options: { DEST: "default" }, moduleOptions: {} },
		);
		expect(result.ok).toBe(true);
		const showResult = (result.world.runtime.stepResults as TStepResult[]).find((sr) => sr.products?.view === "urakata-list");
		expect(showResult).toBeDefined();
		const products = showResult?.products as Record<string, unknown> | undefined;
		expect(products?._type).toBe("shu-result-table");
		expect(products?._component).toBe("shu-result-table");
		expect(products?._summary).toBe("Urakata");
		const list = products?.urakata as Array<Record<string, unknown>>;
		expect(list).toHaveLength(1);
		const ticker = itemAt(list, 0);
		expect(ticker.id).toBe("test.tick");
		expect(ticker.stoppedAt).toBeUndefined();
	});

	it("endFeature(shouldClose) stops every registered urakata", async () => {
		const result = await passWithDefaults([{ path: "/features/main.feature", content: "set t from start tick" }], [VariablesStepper, Haibun, UrakataStepper, TickHarnessStepper], {
			options: { DEST: "default" },
			moduleOptions: {},
		});
		expect(result.ok).toBe(true);
		const harness = result.world.runtime.steppers?.find((s): s is TickHarnessStepper => s instanceof TickHarnessStepper);
		expect(harness).toBeDefined();
		const tickedAtEnd = harness?.tickCount ?? 0;
		await sleep(40);
		expect(harness?.tickCount).toBe(tickedAtEnd);
	});
});
