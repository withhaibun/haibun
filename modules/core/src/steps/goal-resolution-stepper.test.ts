import { describe, it, expect } from "vitest";
import { z } from "zod";

import { passWithDefaults, failWithDefaults, getDefaultWorld } from "../lib/test/lib.js";
import { runInStep } from "../lib/domains/capability-context.js";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "../lib/steps/domains/stepper.js";
import { actionOKWithProducts } from "../lib/domains/util.js";
import VariablesStepper from "./variables-stepper.js";
import { GoalResolutionStepper } from "./goal-resolution-stepper.js";
import { executionOf } from "../lib/actuality/domains/seq-path.js";
import { ActivitiesStepper } from "./activities-stepper.js";
import { DOMAIN_USER_NAME } from "../lib/domains/domains.js";
import { itemAt } from "../lib/domains/item-at.js";

const DOMAIN_AUTH_SESSION = "domain-auth-session-test";
/** A domain this test registers and the steps don't produce. `resolve` returns unreachable for it. */
const DOMAIN_UNPRODUCED = "unproduced-test";
const DOMAIN_COMPOSITE_GOAL = "composite-goal-test";
const DOMAIN_COMPOSITE_INPUT = "composite-input-test";

const AuthSessionSchema = z.object({ id: z.string(), subject: z.string() });

class AuthStepper extends AStepper implements IHasCycles {
	description = "Signs in and produces an authenticated session.";
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{ selectors: [DOMAIN_AUTH_SESSION], schema: AuthSessionSchema, description: "Authenticated session" },
				{ selectors: [DOMAIN_UNPRODUCED], schema: z.unknown(), description: "Registered by this test alone. A step doesn't produce it." },
			],
		}),
	};

	steps: TStepperSteps = {
		signIn: {
			gwta: `sign in as {subject: ${DOMAIN_USER_NAME}}`,
			productsDomain: DOMAIN_AUTH_SESSION,
			action: ({ subject }: { subject: string }) => Promise.resolve(actionOKWithProducts({ id: `s:${subject}`, subject })),
		},
	};
}

/**
 * Composite-decomposition fixture. `CompositeStepper.produceComposite` takes a composite input whose `session` field
 * ranges over a registered fact domain. `AuthStepper.signIn` produces that domain. The resolver decomposes the `session`
 * field when composite decomposition is enabled. It emits the chain `signIn → composite binding → produceComposite` and
 * doesn't flatten the composite into one opaque argument.
 */
const CompositeInputSchema = z.object({ session: z.string(), label: z.string() });
const CompositeGoalSchema = z.object({ value: z.string() });

class CompositeStepper extends AStepper implements IHasCycles {
	description = "Produces a goal from a composite input whose session field ranges over a session.";
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{
					selectors: [DOMAIN_COMPOSITE_INPUT],
					schema: CompositeInputSchema,
					description: "Composite input that ranges its `session` field over a registered auth domain.",
					topology: { ranges: { session: DOMAIN_AUTH_SESSION } },
				},
				{ selectors: [DOMAIN_COMPOSITE_GOAL], schema: CompositeGoalSchema, description: "Goal produced from a composite input." },
			],
		}),
	};

	steps: TStepperSteps = {
		produceComposite: {
			gwta: "produce composite {input: composite-input-test}",
			productsDomain: DOMAIN_COMPOSITE_GOAL,
			action: ({ input }: { input: { session: string; label: string } }) => Promise.resolve(actionOKWithProducts({ value: `${input.session}/${input.label}` })),
		},
	};
}

describe("GoalResolutionStepper, integration via passWithDefaults", () => {
	const steppers = [VariablesStepper, GoalResolutionStepper, AuthStepper];

	it("resolve returns unreachable for a goal that a producer can't derive", async () => {
		// The quoted domain is the value of DOMAIN_UNPRODUCED.
		const feature = {
			path: "/features/howto-unreachable.feature",
			content: `set goalResolution from resolve "unproduced-test"
variable goalResolution.finding is "unreachable"`,
		};
		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
	});

	it("resolve returns a plan when a producer exists and each of its inputs has a binding", async () => {
		const feature = {
			path: "/features/howto-plan.feature",
			content: `set goalResolution from resolve "${DOMAIN_AUTH_SESSION}"
variable goalResolution.finding is "plan"`,
		};
		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
	});

	it("resolve returns satisfied when a fact of the goal is already among the facts", async () => {
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

	it("affordances on offer returns what show affordances returns, and is a read that isn't shown or recorded", async () => {
		const stepper = new GoalResolutionStepper();
		expect(stepper.steps.affordancesOnOffer.read).toBe(true);
		expect(stepper.steps.affordancesOnOfferAsOf.read).toBe(true);
		expect(stepper.steps.showAffordances, "showing the panel is an act of actuality").not.toHaveProperty("read");
		const feature = { path: "/features/test.feature", content: `show affordances\naffordances on offer` };
		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
		const { stepResults } = itemAt(result.featureResults, 0);
		const shown = itemAt(stepResults, 0).products as { forward: unknown[]; goals: unknown[] };
		const offered = itemAt(stepResults, 1).products as { forward: unknown[]; goals: unknown[] };
		expect(offered.forward).toEqual(shown.forward);
		expect(offered.goals).toEqual(shown.goals);
	});

	it("states the execution whose steps produced the facts, in the affordances and in the chain lint", async () => {
		const feature = { path: "/features/test.feature", content: "show affordances\nshow chain lint" };
		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
		const named = itemAt(result.featureResults, 0).stepResults.map((r) => (r.products as { execution: string }).execution);
		// The feature is actuality's first, and its step records name that execution.
		const firstFeature = executionOf({ key: result.world.tag.key, featureNum: 1 });
		expect(named).toEqual([firstFeature, firstFeature]);
	});

	it("emits a change signal after an act and doesn't emit one after a read, since a read doesn't change a record and the panel's re-fetch is a read", async () => {
		const stepper = new GoalResolutionStepper();
		const world = getDefaultWorld();
		await stepper.setWorld(world, [stepper]);
		const announced: string[] = [];
		world.eventLogger.emit = ((event: { id?: string }) => announced.push(String(event.id))) as typeof world.eventLogger.emit;
		const after = (step: unknown) =>
			runInStep({ seqPath: "0.1", reportsAt: undefined }, () => stepper.cycles.afterStep?.({ featureStep: { action: { step } }, actionResult: { ok: true } } as never));
		await after(stepper.steps.affordancesOnOffer);
		await after(stepper.steps.affordancesOnOfferAsOf);
		expect(announced, "a read doesn't emit a change signal, since a signal would make the panel read again without bound").toEqual([]);
		await after({ gwta: "an act", action: () => Promise.resolve(actionOKWithProducts({})) });
		expect(announced).toEqual(["affordances.0.1"]);
	});

	it("show affordances carries the waypoint entries of steppers with the ProvidesWaypoints capability", async () => {
		const feature = {
			path: "/features/show-affordances-waypoints.feature",
			content: `Activity: Sign in
sign in as "alice"
waypoint Logged in

set affordances from show affordances
variable affordances.waypoints.length is 1
variable affordances.waypoints.0.outcome is "Logged in"`,
		};
		const result = await passWithDefaults([feature], [...steppers, ActivitiesStepper]);
		expect(result.ok).toBe(true);
	});

	describe("pursue {goal}, A1 idempotent goal-driven execution", () => {
		it("pursue on a satisfied goal returns finding=satisfied and doesn't run a step", async () => {
			const feature = {
				path: "/features/pursue-satisfied.feature",
				content: `sign in as "alice"
set first from pursue "${DOMAIN_AUTH_SESSION}"
variable first.finding is "satisfied"
set second from pursue "${DOMAIN_AUTH_SESSION}"
variable second.finding is "satisfied"`,
			};
			const result = await passWithDefaults([feature], steppers);
			expect(result.ok).toBe(true);
		});

		it("pursue refuses when the plan has argument bindings that the caller hasn't supplied", async () => {
			// AuthSession's producer (`sign in as {subject}`) takes a string argument that a fact doesn't supply, so a fresh world has finding=plan and pursue refuses.
			const feature = { path: "/features/pursue-needs-arg.feature", content: `not pursue "${DOMAIN_AUTH_SESSION}"` };
			const result = await passWithDefaults([feature], steppers);
			expect(result.ok).toBe(true);
		});

		it("a walk runs a path that pursue refuses, one step at a time, with the value each step takes", async () => {
			// The auth session's producer takes an argument that a fact doesn't supply, so pursue refuses the path. A walk runs
			// such a path. The walk begins, its products name the parameters its next step takes, and an advance supplies them.
			const feature = {
				path: "/features/walk-with-an-argument.feature",
				content: `set walk from walk toward "${DOMAIN_AUTH_SESSION}"
variable walk.status is "pending"
variable walk.next is "AuthStepper-signIn"
variable walk.needs.0 is "subject"
set advanced from advance the walk \`walk.walk\` with {"subject": "alice"}
variable advanced.status is "completed"
set after from resolve "${DOMAIN_AUTH_SESSION}"
variable after.finding is "satisfied"`,
			};
			const result = await passWithDefaults([feature], steppers);
			expect(result.ok).toBe(true);
		});

		it("pursue refuses an unreachable goal with the missing-producers list named in the error", async () => {
			const feature = { path: "/features/pursue-unreachable.feature", content: `not pursue "test-scratch"` };
			const result = await passWithDefaults([feature], steppers);
			expect(result.ok).toBe(true);
		});

		it("a bare pursue fails when the goal can't be reached", async () => {
			// The goal of the test above, without `not`. The bare pursue fails, so a caller can branch on the refusal.
			const feature = { path: "/features/pursue-bare-unreachable.feature", content: `pursue "test-scratch"` };
			const result = await failWithDefaults([feature], steppers);
			expect(result.ok).toBe(false);
		});
	});
});

describe("GoalResolutionStepper, composite decomposition end-to-end", () => {
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
		// Composite decomposition is on by default, so the first plan's first binding is `kind: "composite"`. The resolver
		// decomposed the input instead of flattening it into one argument.
		const feature = {
			path: "/features/composite-resolve.feature",
			content: `set goalResolution from resolve "${DOMAIN_COMPOSITE_GOAL}"
variable goalResolution.finding is "plan"
matches \`goalResolution.plans.0.bindings.0.kind\` with "composite"`,
		};
		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
	});

	it("resolve returns a plan for a non-composite goal (auth-session)", async () => {
		const feature = {
			path: "/features/composite-non-disruptive.feature",
			content: `set goalResolution from resolve "${DOMAIN_AUTH_SESSION}"
variable goalResolution.finding is "plan"`,
		};
		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
	});
});
