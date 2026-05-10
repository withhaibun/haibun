/**
 * Phase 0 acceptance test for declarative waypoints with goal resolution.
 *
 * The test references the future API:
 *   - `waypoint Outcome resolves DOMAIN_X` (declarative form)
 *   - `ensure Outcome` routes to `resolveGoal(DOMAIN_X)` when the waypoint is declarative
 *   - findings: "satisfied" | "plan" | "unreachable" | "refused"
 *   - capability gating via `step.capability` filtered into the resolver's producer set
 *
 * Every `it` is marked `it.fails` until the corresponding commit lands. As each commit
 * adds the machinery these assertions exercise, the matching `it.fails` is flipped to `it`.
 *
 * Mapping (commit → assertion):
 *   commit 2 → registers DOMAIN_AUTH_SESSION; (1a) compiles
 *   commit 4 → resolveGoal + runPlan; (1a) and (1b) pass
 *   commit 5 → declarative waypoint form + ensure routing; (1a)–(1d) all pass
 */
import { describe, it, expect } from "vitest";

import { passWithDefaults } from "../lib/test/lib.js";
import VariablesStepper from "./variables-stepper.js";
import { ActivitiesStepper } from "./activities-stepper.js";
import Haibun from "./haibun.js";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "../lib/astepper.js";
import { actionOK, actionOKWithProducts } from "../lib/util/index.js";
import { z } from "zod";

// Future domains — to be registered in commit 2's core-domains.ts migration.
// Until then, this string constant is just a stepper-local placeholder; the
// `getConcerns` block below registers it for the duration of the test.
const DOMAIN_AUTH_SESSION = "domain-auth-session";

const AuthSessionSchema = z.object({
	id: z.string(),
	subject: z.string(),
	issuedAt: z.coerce.date(),
});

/**
 * Test stepper that produces DOMAIN_AUTH_SESSION when its `signIn` step fires.
 * After commit 2, `outputDomain: DOMAIN_AUTH_SESSION` is the declared postcondition;
 * the runtime auto-asserts the product as a fact. Until then, products land in shared.
 */
class AuthStepper extends AStepper implements IHasCycles {
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{
					selectors: [DOMAIN_AUTH_SESSION],
					schema: AuthSessionSchema,
					description: "An authenticated session for a subject",
				},
			],
		}),
	};

	steps: TStepperSteps = {
		signIn: {
			gwta: "sign in as {subject: string}",
			// commit 2 will add: outputDomain: DOMAIN_AUTH_SESSION,
			// commit 4 will add: capability: "auth:signin",
			action: ({ subject }: { subject: string }) => {
				const session = {
					id: `session:${subject}:${Date.now()}`,
					subject,
					issuedAt: new Date(),
				};
				return Promise.resolve(actionOKWithProducts({ session }));
			},
		},
		// A no-op terminal step the feature can call after `ensure` to assert state.
		showSession: {
			gwta: "show current session",
			action: () => Promise.resolve(actionOK()),
		},
	};
}

describe("ActivitiesStepper — declarative waypoint with goal resolution", () => {
	const steppers = [VariablesStepper, ActivitiesStepper, Haibun, AuthStepper];

	// (1a) Without any prior fact, `ensure Logged in` runs the activity (resolver returns
	//      finding: "plan" with the activity's signIn step), the activity asserts a
	//      DOMAIN_AUTH_SESSION fact, and `show var current_session` finds it.
	it.fails("(1a) ensure runs the activity when no prior fact exists, plan finding produced", async () => {
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

	// (1b) On a second `ensure Logged in` in the same feature, the resolver returns
	//      finding: "satisfied" and the activity is skipped (no second signIn).
	it.fails("(1b) second ensure finds satisfied; activity is skipped", async () => {
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
		// stronger assertion: only one signIn dispatched. After commit 5 lands, the
		// step-execution event count for AuthStepper-signIn should be exactly 1.
	});

	// (1c) Removing the producer step (no path to DOMAIN_AUTH_SESSION) makes the resolver
	//      return finding: "unreachable" and `ensure Logged in` fails with a typed error.
	it.fails("(1c) unreachable finding when no producer exists; ensure fails", async () => {
		const steppersWithoutProducer = [VariablesStepper, ActivitiesStepper, Haibun];
		const feature = {
			path: "/features/declarative-waypoint-unreachable.feature",
			content: `waypoint Logged in resolves ${DOMAIN_AUTH_SESSION}

ensure Logged in`,
		};

		// The runtime should fail with "goal-unreachable" citing DOMAIN_AUTH_SESSION.
		const { failWithDefaults } = await import("../lib/test/lib.js");
		const result = await failWithDefaults([feature], steppersWithoutProducer);
		expect(result.ok).toBe(false);
		const errors = result.featureResults?.[0]?.stepResults.flatMap((r) => (r.ok ? [] : [r.errorMessage])) ?? [];
		expect(errors.some((e) => typeof e === "string" && e.includes("DOMAIN_AUTH_SESSION") && e.includes("unreachable"))).toBe(true);
	});

	// (1d) Capability gating: when the producer step requires capability "auth:signin"
	//      and the caller's capability set excludes it, the resolver returns
	//      finding: "refused", refusalReason: "capability-missing".
	it.fails("(1d) capability-missing finding when producer is gated and caller lacks the capability", async () => {
		// Commit 4 adds `capability: "auth:signin"` to AuthStepper.signIn.
		// passWithDefaults today doesn't thread a capability set; commit 4 introduces
		// a `grantedCapability` option. Until then this test is a placeholder for the API.
		const feature = {
			path: "/features/declarative-waypoint-capability.feature",
			content: `Activity: Sign in
sign in as "alice"
waypoint Logged in resolves ${DOMAIN_AUTH_SESSION}

ensure Logged in`,
		};

		const { failWithDefaults } = await import("../lib/test/lib.js");
		const result = await failWithDefaults([feature], steppers /* future: with grantedCapability: [] */);
		expect(result.ok).toBe(false);
		const errors = result.featureResults?.[0]?.stepResults.flatMap((r) => (r.ok ? [] : [r.errorMessage])) ?? [];
		expect(errors.some((e) => typeof e === "string" && e.includes("capability-missing"))).toBe(true);
	});
});
