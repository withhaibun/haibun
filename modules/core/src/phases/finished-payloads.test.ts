/**
 * What a run keeps of the steps it has finished. A verdict names a failed step and quotes what it said; everything else
 * a reader follows through the event stream. Keeping every passing step's products as well means a run holds every
 * graph slice, response body and rendered document it ever produced, which is how a nineteen-feature run exhausted the
 * heap and was killed rather than failing. A feature that services requests for weeks never reaches an end at which to
 * let them go, so a passing step is let go of as it passes.
 */
import { describe, it, expect } from "vitest";
import { passWithDefaults, failWithDefaults } from "../lib/test/lib.js";
import { AStepper } from "../lib/astepper.js";
import { actionNotOK, actionOKWithProducts } from "../lib/util/index.js";
import { RESULTS_READ_IN_FULL, foldStep } from "../lib/step-dispatch.js";
import { releasePayloads } from "./Executor.js";
import type { TFeatureSteps, TStepResult } from "../schema/protocol.js";

class ProducingStepper extends AStepper {
	steps = {
		produces: {
			gwta: "produce a large answer",
			action: () => Promise.resolve(actionOKWithProducts({ big: "x".repeat(10000) })),
		},
		refuses: {
			gwta: "refuse with a large answer",
			action: () => Promise.resolve(actionNotOK("it refused", { products: { big: "x".repeat(10000) } } as never)),
		},
	};
}

describe("what a run keeps of the steps it has finished", () => {
	it("keeps what a step a reader could still be reading produced", async () => {
		const result = await passWithDefaults([{ path: "/features/test.feature", content: "produce a large answer" }], [ProducingStepper]);
		const [kept] = result.featureResults?.[0].stepResults ?? [];
		expect(kept.in).toBe("produce a large answer");
		expect((kept.products as { big?: string } | undefined)?.big?.length, "the feature's result carries what its steps produced").toBe(10000);
	});

	it("counts every step a long feature ran while holding only the most recent of them", async () => {
		const ran = RESULTS_READ_IN_FULL + 20;
		const result = await passWithDefaults(
			[{ path: "/features/test.feature", content: Array.from({ length: ran }, () => "produce a large answer").join("\n") }],
			[ProducingStepper],
		);
		const feature = result.featureResults?.[0];
		expect(feature?.steps.count, "what the feature ran is answered by the fold, which holds no step to answer it").toBe(ran);
		expect(feature?.steps.firstStart, "as is when it began").toBeDefined();
		expect(feature?.steps.lastEnd, "and when it ended").toBeDefined();
		expect(feature?.stepResults.length, "and the steps a reader can still read are the most recent, and no more").toBe(RESULTS_READ_IN_FULL);
		expect((feature?.stepResults.at(-1)?.products as { big?: string } | undefined)?.big?.length, "the newest is there to be read in full").toBe(10000);
	});

	it("names a step that failed however many ran after it, since a fold does not forget", () => {
		const ran = (over: Partial<TStepResult>): TStepResult => ({ name: "s", in: "a step", path: "/f", seqPath: [0, 1, 1], ok: true, ...over }) as TStepResult;
		const steps: TFeatureSteps = { count: 0 };
		foldStep(steps, ran({ ok: false, in: "the step that failed" }));
		for (let i = 0; i < RESULTS_READ_IN_FULL + 5; i++) foldStep(steps, ran({}));
		expect(steps.count, "every step is counted").toBe(RESULTS_READ_IN_FULL + 6);
		expect(steps.failed?.in, "and the failure is still what the run reports").toBe("the step that failed");
	});

	it("reports a feature step that failed ahead of a synthetic dispatch that failed before it", () => {
		const ran = (over: Partial<TStepResult>): TStepResult => ({ name: "s", in: "a step", path: "/f", seqPath: [0, 1, 1], ok: false, ...over }) as TStepResult;
		const steps: TFeatureSteps = { count: 0 };
		foldStep(steps, ran({ in: "a tool call the step recovered from", seqPath: [0, -1, 1] }));
		foldStep(steps, ran({ in: "the step that failed the feature" }));
		expect(steps.failed?.in).toBe("the step that failed the feature");
	});

	it("keeps everything a failed step carried, since that is what the verdict is made of", async () => {
		const result = await failWithDefaults([{ path: "/features/test.feature", content: "refuse with a large answer" }], [ProducingStepper]);
		const failed = (result.featureResults?.[0].stepResults ?? []).find((s) => !s.ok);
		expect(failed?.message ?? failed?.errorMessage, "the verdict quotes what the step said").toContain("it refused");
	});

	it("lets go of every passing step's payload once the run has moved past the feature", () => {
		const step = { name: "s", in: "a step", path: "/f", seqPath: [0, 1, 1], ok: true, products: { big: "x" } } as unknown as TStepResult;
		const failed = { ...step, ok: false, products: { big: "y" } } as TStepResult;
		releasePayloads({ path: "/f", ok: false, stepResults: [step, failed] });
		expect(step.products, "a passing step's products go").toBeUndefined();
		expect(failed.products, "a failure keeps them").toEqual({ big: "y" });
	});
});
