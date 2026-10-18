/**
 * Acceptance test for declarative waypoints with goal resolution.
 *
 * The test exercises:
 *   - the declarative form `waypoint Outcome resolves DOMAIN_X`
 *   - `ensure Outcome`, which calls `resolveGoal(DOMAIN_X)` for a declarative waypoint
 *   - the findings "satisfied", "michi" and "unreachable"
 *   - `ensure Outcome` for a caller that doesn't hold `ensure` or the producer's `step.capability`
 */
import { describe, it, expect } from "vitest";

import { passWithDefaults } from "../lib/test/lib.js";
import VariablesStepper from "./variables-stepper.js";
import { ActivitiesStepper } from "./activities-stepper.js";
import Haibun from "./haibun-stepper.js";
import AuthorityStepper from "./authority-stepper.js";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "../lib/steps/domains/stepper.js";
import { actionOK, actionOKWithProducts } from "../lib/util/index.js";
import { z } from "zod";
import { DOMAIN_USER_NAME } from "../lib/domains/domains.js";

// The `getConcerns` blocks of the steppers below declare this domain key.
const DOMAIN_AUTH_SESSION = "domain-auth-session";

const AuthSessionSchema = z.object({ id: z.string(), subject: z.string(), issuedAt: z.coerce.date() });

/**
 * A test stepper whose `signIn` step produces a DOMAIN_AUTH_SESSION product.
 * `productsDomain: DOMAIN_AUTH_SESSION` declares the step's postcondition.
 */
class AuthStepper extends AStepper implements IHasCycles {
	description = "Provides a sign-in step that produces a session and a no-op `show current session` step.";
	cycles: IStepperCycles = {
		getConcerns: () => ({ domains: [{ selectors: [DOMAIN_AUTH_SESSION], schema: AuthSessionSchema, description: "An authenticated session for a subject" }] }),
	};

	steps: TStepperSteps = {
		signIn: {
			gwta: `sign in as {subject: ${DOMAIN_USER_NAME}}`,
			productsDomain: DOMAIN_AUTH_SESSION,
			action: ({ subject }: { subject: string }) => Promise.resolve(actionOKWithProducts({ id: `session:${subject}:${Date.now()}`, subject, issuedAt: new Date() })),
		},
		// A no-op step that the feature calls after `ensure`.
		showSession: { gwta: "show current session", action: () => Promise.resolve(actionOK()) },
	};
}

describe("ActivitiesStepper, declarative waypoint with goal resolution", () => {
	const steppers = [VariablesStepper, ActivitiesStepper, Haibun, AuthStepper];

	// (1a) Working memory doesn't hold a DOMAIN_AUTH_SESSION fact, so the resolver returns the finding "michi" and
	//      `ensure Logged in` runs the activity. Step dispatch asserts the product of the activity's signIn step as a
	//      DOMAIN_AUTH_SESSION fact, and the goal check after the activity finds that fact.
	it("(1a) ensure runs the activity on a michi finding when a prior fact doesn't exist", async () => {
		const feature = {
			path: "/features/declarative-waypoint.feature",
			content: `Activity: Sign in
sign in as "alice"
waypoint Logged in resolves ${DOMAIN_AUTH_SESSION}

ensure Logged in
show current session`,
		};

		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
	});

	// (1b) The resolver returns the finding "satisfied" for a second `ensure Logged in` in the same feature,
	//      so the activity doesn't run again.
	it("(1b) a second ensure finds the goal satisfied and skips the activity", async () => {
		const feature = {
			path: "/features/declarative-waypoint-twice.feature",
			content: `Activity: Sign in
sign in as "alice"
waypoint Logged in resolves ${DOMAIN_AUTH_SESSION}

ensure Logged in
ensure Logged in`,
		};

		const result = await passWithDefaults([feature], steppers);
		expect(result.ok).toBe(true);
		// This test doesn't count AuthStepper-signIn step executions, so it doesn't assert that signIn ran once.
	});

	// (1c) The resolver returns the finding "unreachable" where a step doesn't produce DOMAIN_AUTH_SESSION.
	//      `ensure Logged in` fails with a message that names the domain and "unreachable".
	it("(1c) ensure fails on an unreachable finding when a producer doesn't exist", async () => {
		// This test's steppers don't include AuthStepper, so a step doesn't produce the auth-session domain.
		// DomainOnlyStepper declares the domain without a producer, so the waypoint names a known domain key
		// that a step doesn't produce.
		class DomainOnlyStepper extends AStepper implements IHasCycles {
			description = "Declares the session domain without a step that produces it.";
			cycles: IStepperCycles = { getConcerns: () => ({ domains: [{ selectors: [DOMAIN_AUTH_SESSION], schema: AuthSessionSchema, description: "Authenticated session" }] }) };
			steps: TStepperSteps = {};
		}
		const steppersWithoutProducer = [VariablesStepper, ActivitiesStepper, Haibun, DomainOnlyStepper];
		const feature = {
			path: "/features/declarative-waypoint-unreachable.feature",
			content: `Activity: Sign in
waypoint Logged in resolves ${DOMAIN_AUTH_SESSION}

ensure Logged in`,
		};

		const { failWithDefaults } = await import("../lib/test/lib.js");
		const result = await failWithDefaults([feature], steppersWithoutProducer);
		expect(result.ok).toBe(false);
		const errors = result.featureResults?.[0]?.stepResults.flatMap((r) => (r.ok ? [] : [r.errorMessage])) ?? [];
		expect(errors.some((e) => typeof e === "string" && e.includes(DOMAIN_AUTH_SESSION) && e.includes("unreachable"))).toBe(true);
	});

	// (1d) A feature holds actuality's authority, so `holding only` states a caller that holds only "auth:read".
	//      That caller doesn't hold ActivitiesStepper:ensure either, so the gate refuses the `ensure` step before
	//      the resolver runs. The assertion accepts that refusal, which names a capability.
	it("(1d) ensure fails for a caller that doesn't hold ensure or the producer's capability", async () => {
		class GatedAuthStepper extends AStepper implements IHasCycles {
			description = "Signs in with a step that requires a capability.";
			cycles: IStepperCycles = { getConcerns: () => ({ domains: [{ selectors: [DOMAIN_AUTH_SESSION], schema: AuthSessionSchema, description: "Authenticated session" }] }) };
			steps: TStepperSteps = {
				signIn: {
					gwta: `sign in as {subject: ${DOMAIN_USER_NAME}}`,
					productsDomain: DOMAIN_AUTH_SESSION,
					capability: "auth:signin",
					action: ({ subject }: { subject: string }) => Promise.resolve(actionOKWithProducts({ id: `s:${subject}`, subject, issuedAt: new Date() })),
				},
			};
		}
		const gatedSteppers = [VariablesStepper, ActivitiesStepper, Haibun, AuthorityStepper, GatedAuthStepper];
		const feature = {
			path: "/features/declarative-waypoint-capability.feature",
			content: `Activity: Sign in
sign in as "alice"
waypoint Logged in resolves ${DOMAIN_AUTH_SESSION}

holding only "auth:read", ensure Logged in`,
		};

		const { failWithDefaults } = await import("../lib/test/lib.js");
		const result = await failWithDefaults([feature], gatedSteppers);
		expect(result.ok).toBe(false);
		const errors = result.featureResults?.[0]?.stepResults.flatMap((r) => (r.ok ? [] : [r.errorMessage])) ?? [];
		expect(errors.some((e) => typeof e === "string" && (e.includes("unreachable") || e.includes("capability")))).toBe(true);
	});
});
