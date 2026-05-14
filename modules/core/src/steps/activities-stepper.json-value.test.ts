/**
 * Repro: a parameterized activity whose body uses `set X as <typed-domain> to {JSON}`
 * to build a composite from the slot value, then passes the variable to a typed step.
 * Mirrors the shu-web feature's parameterized issuer activity but with a stub typed
 * domain to keep the test self-contained.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ActivitiesStepper } from "./activities-stepper.js";
import VariablesStepper from "./variables-stepper.js";
import Haibun from "./haibun.js";
import { AStepper, type IStepperCycles, type TStepperSteps } from "../lib/astepper.js";
import { actionOK } from "../lib/util/index.js";
import { objectCoercer } from "../lib/domains.js";
import { passWithDefaults } from "../lib/test/lib.js";

const PersonSchema = z.object({ did: z.url(), name: z.string() }).strict();

let lastReceived: { did: string; name: string } | undefined;

class PersonStepper extends AStepper {
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{
					selectors: ["person-input"],
					schema: PersonSchema,
					coerce: objectCoercer(PersonSchema),
					description: "A person identified by DID with a display name.",
				},
			],
		}),
	};
	steps: TStepperSteps = {
		registerPerson: {
			gwta: "register person {person: person-input}",
			inputDomains: { person: "person-input" },
			action: ({ person }: { person: { did: string; name: string } }) => {
				lastReceived = person;
				return actionOK();
			},
		},
	};
}

describe("parameterized activity body builds a composite via setAs from a JSON value", () => {
	it("invokes the typed step with the composite the body built from the slot value", async () => {
		const feature = {
			path: "/features/parameterized-composite.feature",
			content: `Activity: Person registered {name}
set {name} as person-input to {"did":"did:example:{name}","name":"{name}"}
register person {name}
waypoint Person registered {name} with variable {name} exists

Scenario: Register a person via the parameterized activity (bare slot value)
Person registered Alice`,
		};
		lastReceived = undefined;
		const result = await passWithDefaults([feature], [VariablesStepper, ActivitiesStepper, Haibun, PersonStepper]);
		if (!result.ok) {
			throw result.failure?.error ?? new Error(`activity failed: ${JSON.stringify(result)}`);
		}
		expect(result.ok).toBe(true);
		expect(lastReceived).toEqual({ did: "did:example:Alice", name: "Alice" });
	});
});
