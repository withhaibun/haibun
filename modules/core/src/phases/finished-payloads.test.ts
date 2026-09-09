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
import { RESULTS_READ_IN_FULL } from "../lib/step-dispatch.js";
import { releasePayloads } from "./Executor.js";
import type { TStepResult } from "../schema/protocol.js";

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

	it("lets go of what a step further back than that produced, while still counting it", async () => {
		const many = Array.from({ length: RESULTS_READ_IN_FULL + 20 }, () => "produce a large answer").join("\n");
		const result = await passWithDefaults([{ path: "/features/test.feature", content: many }], [ProducingStepper]);
		const kept = result.featureResults?.[0].stepResults ?? [];
		expect(kept.length, "every step is still counted and read").toBe(RESULTS_READ_IN_FULL + 20);
		expect(kept[0].in, "and still says what it was").toBe("produce a large answer");
		expect(kept[0].products, "but the run holds nothing of what the earliest produced").toBeUndefined();
		expect((kept[kept.length - 1].products as { big?: string } | undefined)?.big?.length, "while the newest is there to be read").toBe(10000);
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
