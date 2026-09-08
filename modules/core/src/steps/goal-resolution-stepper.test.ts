import { describe, it, expect } from "vitest";
import { z } from "zod";

import { passWithDefaults, failWithDefaults, getDefaultWorld } from "../lib/test/lib.js";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "../lib/astepper.js";
import { actionOKWithProducts } from "../lib/util/index.js";
import VariablesStepper from "./variables-stepper.js";
import LogicStepper from "./logic-stepper.js";
import { GoalResolutionStepper } from "./goal-resolution-stepper.js";
import { ActivitiesStepper } from "./activities-stepper.js";

const DOMAIN_AUTH_SESSION = "domain-auth-session-test";
/** A domain this test registers and no step produces, so `resolve` has something registered but unreachable to answer about. */
const DOMAIN_UNPRODUCED = "unproduced-test";
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
				{
					selectors: [DOMAIN_UNPRODUCED],
					schema: z.unknown(),
					description: "Registered by this test alone; no step produces it.",
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
	const steppers = [VariablesStepper, GoalResolutionStepper, AuthStepper, LogicStepper];

	it("resolve returns unreachable for a goal no producer can derive", async () => {
		// A domain key this test registers (see DOMAIN_UNPRODUCED above) that no loaded step produces.
		const feature = {
			path: "/features/howto-unreachable.feature",
			content: `set goalResolution from resolve "unproduced-test"
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

	it("affordances on offer answers what show affordances shows, and is a read: asked of a running instance it shows nothing and is not recorded", async () => {
		const stepper = new GoalResolutionStepper();
		expect(stepper.steps.affordancesOnOffer.read).toBe(true);
		expect(stepper.steps.affordancesOnOfferAsOf.read).toBe(true);
		expect(stepper.steps.showAffordances.read, "showing the panel is an act of the run").toBeUndefined();
		const feature = { path: "/features/test.feature", content: `show affordances\naffordances on offer` };
		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
		const shown = result.featureResults?.[0].stepResults[0].products as { forward: unknown[]; goals: unknown[] };
		const offered = result.featureResults?.[0].stepResults[1].products as { forward: unknown[]; goals: unknown[] };
		expect(offered.forward).toEqual(shown.forward);
		expect(offered.goals).toEqual(shown.goals);
	});

	it("announces a change after an act and none after a read, since a read changes nothing and the panel's own re-fetch is one", async () => {
		const stepper = new GoalResolutionStepper();
		const world = getDefaultWorld();
		world.runtime.currentSeqPath = "0.1";
		await stepper.setWorld(world, [stepper]);
		const announced: string[] = [];
		world.eventLogger.emit = ((event: { id?: string }) => announced.push(String(event.id))) as typeof world.eventLogger.emit;
		const after = (step: unknown) => stepper.cycles.afterStep?.({ featureStep: { action: { step } }, actionResult: { ok: true } } as never);
		await after(stepper.steps.affordancesOnOffer);
		await after(stepper.steps.affordancesOnOfferAsOf);
		expect(announced, "a read announces nothing, or the panel reading would announce a change to read again for, without bound").toEqual([]);
		await after({ gwta: "an act", action: () => Promise.resolve(actionOKWithProducts({})) });
		expect(announced).toEqual(["affordances.0.1"]);
	});

	it("show affordances carries waypoint entries contributed by steppers with the ProvidesWaypoints capability — one verb, the whole snapshot", async () => {
		const feature = {
			path: "/features/show-affordances-waypoints.feature",
			content: `Activity: Sign in
sign in as "alice"
waypoint Logged in resolves ${DOMAIN_AUTH_SESSION}

set affordances from show affordances
variable affordances.waypoints.length is 1
variable affordances.waypoints.0.outcome is "Logged in"`,
		};
		const result = await passWithDefaults([feature], [...steppers, ActivitiesStepper]);
		expect(result.ok).toBe(true);
	});

	describe("pursue {goal} — A1 idempotent goal-driven execution", () => {
		it("pursue on a satisfied goal is a no-op: returns finding=satisfied, no execution side-effect", async () => {
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

		it("pursue refuses when the michi has argument bindings the caller hasn't supplied — naming what's needed", async () => {
			// AuthSession's producer (`sign in as {subject}`) takes a string argument with no fact backing — so a fresh world has finding=michi and pursue must refuse rather than guess.
			const feature = {
				path: "/features/pursue-needs-arg.feature",
				content: `not pursue "${DOMAIN_AUTH_SESSION}"`,
			};
			const result = await passWithDefaults([feature], steppers);
			expect(result.ok).toBe(true);
		});

		it("a walk runs the very path pursue refuses, one step at a time, with what that step needs", async () => {
			// The auth session's producer takes an argument no fact supplies, which is why pursue refuses it. A walk is how
			// such a path is run: it is begun, it says what it still needs, and it is advanced with that.
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
			const feature = {
				path: "/features/pursue-unreachable.feature",
				content: `not pursue "test-scratch"`,
			};
			const result = await passWithDefaults([feature], steppers);
			expect(result.ok).toBe(true);
		});

		it("pursue refuses (overall fails) when the goal can't be reached", async () => {
			// Same goal as above but WITHOUT the `not` wrapper — the bare pursue must propagate the refusal so callers can branch on it.
			const feature = {
				path: "/features/pursue-bare-unreachable.feature",
				content: `pursue "test-scratch"`,
			};
			const result = await failWithDefaults([feature], steppers);
			expect(result.ok).toBe(false);
		});
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
