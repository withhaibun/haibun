/**
 * Tests which finished step results actuality holds. A verdict names a failed step and holds the message that step
 * returned. A reader reads every other step through the event stream. A feature's stepResults holds only the most recent
 * RESULTS_READ_IN_FULL results, because a feature that services requests for weeks doesn't reach an end where actuality
 * could release them. releasePayloads clears a feature's passing step payloads after actuality starts another feature.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { passWithDefaults, failWithDefaults } from "../lib/test/lib.js";
import { AStepper } from "../lib/steps/domains/stepper.js";
import { actionNotOK, actionOKWithProducts } from "../lib/util/index.js";
import { RESULTS_READ_IN_FULL, foldStep } from "../lib/step-dispatch.js";
import { releasePayloads } from "./Executor.js";
import type { TFeatureSteps, TStepResult } from "../schema/protocol.js";
import { itemAt } from "../lib/util/item-at.js";

const LARGE_ANSWER = "test-large-answer";

class ProducingStepper extends AStepper {
	description = "Produces a large product, and refuses with a large product.";
	cycles = { getConcerns: () => ({ domains: [{ selectors: [LARGE_ANSWER], schema: z.object({ big: z.string() }), description: "A large product" }] }) };
	steps = {
		produces: { gwta: "produce a large answer", productsDomain: LARGE_ANSWER, action: () => Promise.resolve(actionOKWithProducts({ big: "x".repeat(10000) })) },
		refuses: { gwta: "refuse with a large answer", action: () => Promise.resolve(actionNotOK("it refused", { products: { big: "x".repeat(10000) } } as never)) },
	};
}

describe("the finished step results actuality holds", () => {
	it("keeps a passing step's products in the feature's result", async () => {
		const result = await passWithDefaults([{ path: "/features/test.feature", content: "produce a large answer" }], [ProducingStepper]);
		const kept = itemAt(itemAt(result.featureResults, 0).stepResults, 0);
		expect(kept.in).toBe("produce a large answer");
		expect((kept.products as { big?: string } | undefined)?.big?.length, "the feature's result holds its steps' products").toBe(10000);
	});

	it("counts every step a long feature executed and holds only the most recent step results", async () => {
		const ran = RESULTS_READ_IN_FULL + 20;
		const result = await passWithDefaults(
			[{ path: "/features/test.feature", content: Array.from({ length: ran }, () => "produce a large answer").join("\n") }],
			[ProducingStepper],
		);
		const feature = result.featureResults?.[0];
		expect(feature?.steps.count, "the step totals count every step without holding the steps").toBe(ran);
		expect(feature?.steps.firstStart, "the step totals hold the first start time").toBeDefined();
		expect(feature?.steps.lastEnd, "the step totals hold the last end time").toBeDefined();
		expect(feature?.stepResults.length, "stepResults holds only the most recent RESULTS_READ_IN_FULL step results").toBe(RESULTS_READ_IN_FULL);
		expect((feature?.stepResults.at(-1)?.products as { big?: string } | undefined)?.big?.length, "the newest step result holds its products in full").toBe(10000);
	});

	it("names a failed step however many steps executed after it, because the step totals hold the failed step", () => {
		const ran = (over: Partial<TStepResult>): TStepResult => ({ name: "s", in: "a step", path: "/f", seqPath: [0, 1, 1], ok: true, ...over }) as TStepResult;
		const steps: TFeatureSteps = { count: 0 };
		foldStep(steps, ran({ ok: false, in: "the step that failed" }));
		for (let i = 0; i < RESULTS_READ_IN_FULL + 5; i++) foldStep(steps, ran({}));
		expect(steps.count, "every step is counted").toBe(RESULTS_READ_IN_FULL + 6);
		expect(steps.failed?.in, "steps.failed holds the failed step").toBe("the step that failed");
	});

	it("holds a failed feature step in steps.failed instead of a synthetic dispatch that failed earlier", () => {
		const ran = (over: Partial<TStepResult>): TStepResult => ({ name: "s", in: "a step", path: "/f", seqPath: [0, 1, 1], ok: false, ...over }) as TStepResult;
		const steps: TFeatureSteps = { count: 0 };
		foldStep(steps, ran({ in: "a tool call the step recovered from", seqPath: [0, -1, 1] }));
		foldStep(steps, ran({ in: "the step that failed the feature" }));
		expect(steps.failed?.in).toBe("the step that failed the feature");
	});

	it("keeps a failed step's message for the verdict", async () => {
		const result = await failWithDefaults([{ path: "/features/test.feature", content: "refuse with a large answer" }], [ProducingStepper]);
		const failed = itemAt(result.featureResults, 0).stepResults.find((s) => !s.ok);
		if (failed?.ok !== false) throw new Error("a step didn't fail");
		expect(failed.errorMessage, "the failed step's errorMessage holds the message the step returned").toContain("it refused");
	});

	it("clears every passing step's payload and keeps a failed step's payload", () => {
		const step = { name: "s", in: "a step", path: "/f", seqPath: [0, 1, 1], ok: true, products: { big: "x" } } as unknown as TStepResult;
		const failed = { ...step, ok: false, products: { big: "y" } } as TStepResult;
		releasePayloads({ path: "/f", ok: false, steps: { count: 2 }, declaredStepTextHash: "the hash of its steps", stepResults: [step, failed] });
		expect(step.products, "releasePayloads clears a passing step's products").toBeUndefined();
		expect(failed.products, "a failed step keeps its products").toEqual({ big: "y" });
	});
});
