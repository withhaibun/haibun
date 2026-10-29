import { describe, it, expect } from "vitest";
import { AStepper, TFeatureStep } from "../../steps/domains/stepper.js";
import { OK, TStepArgs } from "../../domains/protocol.js";
import { passWithDefaults, DEF_PROTO_OPTIONS, failWithDefaults } from "../../test/lib.js";
import { LogicStepper } from "../../test/logic-stepper.js";
import { actionNotOK } from "../../domains/util.js";
import { proveStatements, stepperContext } from "./step-dispatch.js";
import { DOMAIN_STATEMENT } from "../../domains/domains.js";
import Haibun from "../../../steps/haibun-stepper.js";
import { TEST_STEP } from "../../test/test-step.js";

class StatementTestStepper extends AStepper {
	description = "Declares the steps alpha and beta and a step that executes its statement argument.";
	steps = {
		alpha: { description: TEST_STEP, exact: "alpha", action: async () => Promise.resolve(OK) },
		beta: { description: TEST_STEP, exact: "beta", action: async () => Promise.resolve(OK) },
		do: {
			description: TEST_STEP,
			gwta: `do {steps:${DOMAIN_STATEMENT}}`,
			action: async (args: TStepArgs, featureStep: TFeatureStep) => {
				try {
					const steps = args.steps as unknown;
					if (!Array.isArray(steps)) throw new Error("steps must be feature steps");

					const result = await proveStatements(stepperContext(this.getWorld(), [this as unknown as AStepper]), featureStep, steps as TFeatureStep[]);

					if (!result.ok) {
						return actionNotOK(`statement failed: ${result.errorMessage}`);
					}
					return OK;
				} catch (e) {
					return actionNotOK(`statement failed: ${(e as Error).message}`);
				}
			},
		},
	};
}

describe("statement type", () => {
	it("executes a statement that resolves to a step", async () => {
		const feature = { path: "/features/test.feature", content: "do alpha" };
		const result = await passWithDefaults([feature], [StatementTestStepper, LogicStepper], DEF_PROTO_OPTIONS, []);
		expect(result.ok).toBe(true);
	});
	it("fails a statement that doesn't resolve to a step", async () => {
		const feature = { path: "/features/test.feature", content: "do gamma" };
		const result = await failWithDefaults([feature], [StatementTestStepper, LogicStepper], DEF_PROTO_OPTIONS, []);
		expect(result.ok).toBe(false);
	});
	it("executes a statement step followed by other steps", async () => {
		// The feature has a statement step and then the steps alpha and beta.
		const feature = { path: "/features/test.feature", content: "do alpha\nalpha\nbeta" };
		const result = await passWithDefaults([feature], [StatementTestStepper, LogicStepper], DEF_PROTO_OPTIONS, []);
		expect(result.ok).toBe(true);
	});
	it("extends the parent seqPath for a statement's substeps", async () => {
		const feature = { path: "/features/test.feature", content: "do alpha" };
		const result = await passWithDefaults([feature], [StatementTestStepper, LogicStepper], DEF_PROTO_OPTIONS, []);
		expect(result.ok).toBe(true);
		const firstFeature = result.featureResults?.[0];
		if (!firstFeature) throw new Error("Missing feature result");
		const stepResults = firstFeature.stepResults;
		const parentStep = stepResults.find((s) => s.in === "do alpha");
		const subStep = stepResults.find((s) => s.in === "alpha");
		expect(parentStep).toBeDefined();
		expect(subStep).toBeDefined();
		if (!parentStep || !subStep) throw new Error("Missing expected steps");
		// A substep's seqPath extends the parent step's seqPath by one element.
		expect(subStep.seqPath.length).toBeGreaterThan(parentStep.seqPath.length);
	});
	it("seqPaths start at 1 per scenario and substeps extend with new elements", async () => {
		const feature = { path: "/features/test.feature", content: "Scenario: first\ndo alpha\nalpha\nScenario: second\nbeta" };
		const result = await passWithDefaults([feature], [StatementTestStepper, Haibun, LogicStepper], DEF_PROTO_OPTIONS, []);
		expect(result.ok).toBe(true);
		const firstFeature = result.featureResults?.[0];
		if (!firstFeature) throw new Error("Missing feature result");
		const steps = firstFeature.stepResults;
		// seqPath layout: [hostId, featureNum, scenarioNum, stepSeq, ...substep]
		// Scenario 1: "do alpha" is the first step after the Scenario line, and its stepSeq is 1.
		const doAlpha = steps.find((s) => s.in === "do alpha");
		if (!doAlpha) throw new Error("Missing do alpha step");
		expect(doAlpha.seqPath[3]).toBe(1);
		// The "alpha" substep of the statement adds a seqPath element.
		const alphaSubstep = steps.find((s) => s.in === "alpha" && s.seqPath.length > 4);
		expect(alphaSubstep).toBeDefined();
		if (!alphaSubstep) throw new Error("Missing alpha substep");
		expect(alphaSubstep.seqPath.length).toBeGreaterThan(doAlpha.seqPath.length);
		// The direct "alpha" step is step 2 in scenario 1.
		const alphaDirect = steps.find((s) => s.in === "alpha" && s.seqPath.length === 4);
		if (!alphaDirect) throw new Error("Missing alpha direct step");
		expect(alphaDirect.seqPath[3]).toBe(2);
		// Scenario 2: the step sequence restarts, so "beta" has stepSeq 1.
		const beta = steps.find((s) => s.in === "beta");
		if (!beta) throw new Error("Missing beta step");
		expect(beta.seqPath[3]).toBe(1);
	});
});
