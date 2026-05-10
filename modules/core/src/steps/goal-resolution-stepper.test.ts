import { describe, it, expect } from "vitest";
import { z } from "zod";

import { passWithDefaults, failWithDefaults } from "../lib/test/lib.js";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "../lib/astepper.js";
import { actionOKWithProducts } from "../lib/util/index.js";
import VariablesStepper from "./variables-stepper.js";
import { GoalResolutionStepper } from "./goal-resolution-stepper.js";

const DOMAIN_AUTH_SESSION = "domain-auth-session-test";

const AuthSessionSchema = z.object({ id: z.string(), subject: z.string() });

class AuthStepper extends AStepper implements IHasCycles {
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{
					selectors: [DOMAIN_AUTH_SESSION],
					schema: AuthSessionSchema,
					description: "Authenticated session",
				},
			],
		}),
	};

	steps: TStepperSteps = {
		signIn: {
			gwta: "sign in as {subject: string}",
			outputDomain: DOMAIN_AUTH_SESSION,
			action: ({ subject }: { subject: string }) => Promise.resolve(actionOKWithProducts({ id: `s:${subject}`, subject })),
		},
	};
}

describe("GoalResolutionStepper — integration via passWithDefaults", () => {
	const steppers = [VariablesStepper, GoalResolutionStepper, AuthStepper];

	it("how to get returns unreachable for a goal no producer can derive", async () => {
		// Use a domain key that's registered (via DOMAIN_TEST_SCRATCH in core-domains)
		// but has no producer step in the loaded stepper set.
		const feature = {
			path: "/features/howto-unreachable.feature",
			content: `set goalResolution from how to get "test-scratch"
variable goalResolution.finding is "unreachable"`,
		};
		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
	});

	it("how to get returns a plan when a producer exists and inputs are satisfied", async () => {
		// signIn requires {subject: string} which can be matched by any string fact.
		// To produce DOMAIN_AUTH_SESSION the plan calls signIn; the resolver returns
		// a plan because the input domain "string" is satisfied via gwta resolution.
		const feature = {
			path: "/features/howto-plan.feature",
			content: `set goalResolution from how to get "${DOMAIN_AUTH_SESSION}"
variable goalResolution.finding is "plan"`,
		};
		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
	});

	it("how to get returns satisfied when a fact of the goal already exists in working memory", async () => {
		const feature = {
			path: "/features/howto-satisfied.feature",
			content: `sign in as "alice"
set goalResolution from how to get "${DOMAIN_AUTH_SESSION}"
variable goalResolution.finding is "satisfied"`,
		};
		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
	});

	it("show affordances exposes the forward frontier and goal verdicts as a product", async () => {
		const feature = {
			path: "/features/show-affordances.feature",
			content: `set affordances from show affordances
variable affordances exists`,
		};
		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
	});
});
