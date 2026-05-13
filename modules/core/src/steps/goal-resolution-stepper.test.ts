import { describe, it, expect } from "vitest";
import { z } from "zod";

import { passWithDefaults, failWithDefaults } from "../lib/test/lib.js";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "../lib/astepper.js";
import { actionOKWithProducts } from "../lib/util/index.js";
import VariablesStepper from "./variables-stepper.js";
import { GoalResolutionStepper } from "./goal-resolution-stepper.js";

const DOMAIN_AUTH_SESSION = "domain-auth-session-test";
const DOMAIN_COMPOSITE_GOAL = "composite-goal-test";
const DOMAIN_COMPOSITE_INPUT = "composite-input-test";

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
			productsDomain: DOMAIN_AUTH_SESSION,
			action: ({ subject }: { subject: string }) => Promise.resolve(actionOKWithProducts({ id: `s:${subject}`, subject })),
		},
	};
}

/**
 * Composite-decomposition fixture. `CompositeStepper.produceComposite` consumes
 * a composite input whose `session` field ranges over a registered fact domain
 * (`AuthSessionStepper` produces those). With composite decomposition on, the
 * resolver should walk the composite's `session` field and emit a chain
 * `signIn → composite binding → produceComposite`, not flatten the whole
 * composite into one opaque argument.
 */
const CompositeInputSchema = z.object({ session: z.string(), label: z.string() });
const CompositeGoalSchema = z.object({ value: z.string() });

class CompositeStepper extends AStepper implements IHasCycles {
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{
					selectors: [DOMAIN_COMPOSITE_INPUT],
					schema: CompositeInputSchema,
					description: "Composite input that ranges its `session` field over a registered auth domain.",
					topology: { ranges: { session: DOMAIN_AUTH_SESSION } },
				},
				{
					selectors: [DOMAIN_COMPOSITE_GOAL],
					schema: CompositeGoalSchema,
					description: "Goal produced from a composite input.",
				},
			],
		}),
	};

	steps: TStepperSteps = {
		produceComposite: {
			gwta: "produce composite {input: composite-input-test}",
			inputDomains: { input: DOMAIN_COMPOSITE_INPUT },
			productsDomain: DOMAIN_COMPOSITE_GOAL,
			action: ({ input }: { input: { session: string; label: string } }) => Promise.resolve(actionOKWithProducts({ value: `${input.session}/${input.label}` })),
		},
	};
}

describe("GoalResolutionStepper — integration via passWithDefaults", () => {
	const steppers = [VariablesStepper, GoalResolutionStepper, AuthStepper];

	it("resolve returns unreachable for a goal no producer can derive", async () => {
		// Use a domain key that's registered (via DOMAIN_TEST_SCRATCH in core-domains)
		// but has no producer step in the loaded stepper set.
		const feature = {
			path: "/features/howto-unreachable.feature",
			content: `set goalResolution from resolve "test-scratch"
variable goalResolution.finding is "unreachable"`,
		};
		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
	});

	it("resolve returns michi when a producer exists and inputs are satisfied", async () => {
		const feature = {
			path: "/features/howto-michi.feature",
			content: `set goalResolution from resolve "${DOMAIN_AUTH_SESSION}"
variable goalResolution.finding is "michi"`,
		};
		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
	});

	it("resolve returns satisfied when a fact of the goal already exists in working memory", async () => {
		const feature = {
			path: "/features/howto-satisfied.feature",
			content: `sign in as "alice"
set goalResolution from resolve "${DOMAIN_AUTH_SESSION}"
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

describe("GoalResolutionStepper — composite decomposition end-to-end", () => {
	const steppers = [VariablesStepper, GoalResolutionStepper, AuthStepper, CompositeStepper];

	it("show affordances carries the composites map for any domain that declares topology.ranges", async () => {
		const feature = {
			path: "/features/composite-affordances.feature",
			content: `set affordances from show affordances
variable affordances.composites exists`,
		};
		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
	});

	it("resolve emits a composite binding for a goal whose only producer takes a composite input ranged over a producible domain", async () => {
		// CompositeStepper.produceComposite's input is `composite-input-test`,
		// which declares `topology.ranges: { session: domain-auth-session-test }`.
		// AuthStepper.signIn produces the auth-session domain. With composite
		// decomposition enabled (the GoalResolutionStepper default), resolving
		// the composite goal must emit at least one michi whose binding is
		// `kind: "composite"` (the resolver decomposed the input rather than
		// flattening it into one argument).
		const feature = {
			path: "/features/composite-resolve.feature",
			content: `set goalResolution from resolve "${DOMAIN_COMPOSITE_GOAL}"
variable goalResolution.finding is "michi"
matches \`goalResolution.michi.0.bindings.0.kind\` with "composite"`,
		};
		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
	});

	it("falls back to a flat argument binding when COMPOSITE_DECOMPOSITION is disabled", async () => {
		const feature = {
			path: "/features/composite-resolve-disabled.feature",
			content: `set goalResolution from resolve "${DOMAIN_COMPOSITE_GOAL}"
variable goalResolution.finding is "michi"
matches \`goalResolution.michi.0.bindings.0.kind\` with "argument"`,
		};
		const result = await passWithDefaults([feature], steppers, {
			options: { DEST: "/dev/null", envVariables: { HAIBUN_LOG_LEVEL: "none" } },
			moduleOptions: { HAIBUN_O_GOALRESOLUTIONSTEPPER_COMPOSITE_DECOMPOSITION: "false" },
		});
		expect(result.ok).toBe(true);
	});

	it("resolve still works for a non-composite goal (auth-session) — composite mode is additive, not disruptive", async () => {
		const feature = {
			path: "/features/composite-non-disruptive.feature",
			content: `set goalResolution from resolve "${DOMAIN_AUTH_SESSION}"
variable goalResolution.finding is "michi"`,
		};
		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
	});

});
