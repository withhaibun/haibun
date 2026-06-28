/**
 * The view-query control steps are tested through the haibun step machinery — the registry builds the tool
 * from the gwta + getConcerns domains, validateToolInput enforces the typed params, the handler runs the
 * action, and validateProducts checks the product against the view-query productsDomain. No browser, no
 * component mount: the step's behaviour is verified end-to-end at the step layer, which is where it lives.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import ShuGraphQueryControls from "./shu-graph-query.controls.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { StepRegistry, buildFeatureStepForTransport } from "@haibun/core/lib/step-registry.js";
import { validateToolInput, validateProducts } from "@haibun/core/lib/tool-validation.js";
import { DOMAIN_PERSISTED_TYPE } from "@haibun/core/lib/resources.js";
import type { TWorld } from "@haibun/core/lib/world.js";

describe("view-query controls", () => {
	let world: TWorld;
	let stepper: ShuGraphQueryControls;

	beforeEach(() => {
		world = getDefaultWorld();
		stepper = new ShuGraphQueryControls();
		stepper.setWorld?.(world, [stepper]);
		world.runtime.steppers = [stepper];
		for (const d of stepper.cycles.getConcerns?.()?.domains ?? []) world.domains[d.selectors[0]] = { ...d, coerce: (p) => p.value };
		world.domains[DOMAIN_PERSISTED_TYPE] = { selectors: [DOMAIN_PERSISTED_TYPE], schema: z.string().min(1), coerce: (p) => p.value, description: "persisted type" };
	});

	const runStep = async (method: string, input: Record<string, unknown>) => {
		const registry = new StepRegistry([stepper], world);
		const tool = registry.get(`ShuGraphQueryControls-${method}`);
		if (!tool) throw new Error(`no tool for ${method}`);
		const validated = validateToolInput([0], tool, input, world);
		const featureStep = buildFeatureStepForTransport(tool, validated, [0]);
		const result = await tool.handler(featureStep, world);
		const productError = validateProducts("ShuGraphQueryControls", method, tool.stepDef as never, world, result.products);
		return { result, productError };
	};

	it("`search for {q}` produces a valid view-query product carrying q", async () => {
		const { result, productError } = await runStep("searchFor", { q: "INBOX" });
		expect(result.ok).toBe(true);
		expect(result.products?.q).toBe("INBOX");
		expect(productError).toBeUndefined();
	});

	it("`view {label}` produces a view-query product carrying the type", async () => {
		const { result, productError } = await runStep("viewType", { label: "Email" });
		expect(result.products?.label).toBe("Email");
		expect(productError).toBeUndefined();
	});

	it("`sort by {sort}` produces a view-query product carrying the sort field", async () => {
		const { result, productError } = await runStep("sortBy", { sort: "dateSent" });
		expect(result.products?.sort).toBe("dateSent");
		expect(productError).toBeUndefined();
	});

	it("fail-fast: an empty search is rejected by the search-text domain (min length)", async () => {
		await expect(runStep("searchFor", { q: "" })).rejects.toThrow();
	});
});
