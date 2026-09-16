/**
 * End-to-end pin for the `show monitor` → open-component chain.
 *
 * Confirms: a step whose productsDomain has `ui.component` produces a response whose
 * markers the SPA parser recognises as an open-component action. A regression makes
 * the "show monitor" affordance a no-op.
 */
import { describe, it, expect } from "vitest";
import { HYPERMEDIA } from "@haibun/core/schema/protocol.js";
import { buildFeatureStepForTransport, type StepTool } from "@haibun/core/lib/step-registry.js";
import { parseAffordanceProduct } from "./affordance-products.js";

describe("show monitor markers → parser", () => {
	it("a markers-only product (the shape augmentViewHypermedia produces for show monitor) parses to open-component", () => {
		const wireResponse = {
			[HYPERMEDIA.TYPE]: "shu-monitor-column",
			[HYPERMEDIA.COMPONENT]: "shu-monitor-column",
			[HYPERMEDIA.SUMMARY]: "shu-monitor-column",
			id: "shu-monitor-column",
			view: "shu-monitor-column",
		};
		const action = parseAffordanceProduct(wireResponse);
		expect(action.kind).toBe("open-component");
		if (action.kind === "open-component") {
			expect(action.component).toBe("shu-monitor-column");
		}
	});

	it("buildFeatureStepForTransport carries the real stepDef through (regression: RPC dispatch dropped productsDomain, augment never fired)", () => {
		const stepDef = { gwta: "show monitor", productsDomain: "shu-monitor-column", action: () => ({ ok: true as const }) };
		const tool: StepTool = {
			descriptor: {
				method: "MonitorStepper-showMonitor",
				stepperName: "MonitorStepper",
				stepperDescription: "Shows the run's monitor.",
				stepName: "showMonitor",
				pattern: "show monitor",
				params: {},
				paramDomains: {},
				productsDomain: "shu-monitor-column",
				read: false,
				fallback: false,
				inputSchema: { type: "object", properties: {}, required: [] },
			},
			paramSchemas: new Map(),
			paramDomainKeys: new Map(),
			stepDef,
			transport: "local",
			isAsync: false,
			handler: () => Promise.resolve({ ok: true as const }),
		};
		const fs = buildFeatureStepForTransport(tool, {}, [0, 1, 1]);
		expect(fs.action.step.productsDomain).toBe("shu-monitor-column");
		expect(fs.action.step).toBe(stepDef);
	});
});
