import { describe, it, expect } from "vitest";
import { z } from "zod";

import { AStepper, type TStepperSteps } from "./astepper.js";
import type { TRegisteredDomain } from "./resources.js";
import { mapDefinitionsToDomains } from "./domains.js";
import { OK } from "../schema/protocol.js";
import { actionOKWithProducts } from "./util/index.js";
import { buildDomainChain } from "./domain-chain.js";

const PERSON_DOMAIN = "person";
const EMAIL_DOMAIN = "email";
const SESSION_DOMAIN = "session";

function fixedDomains(): Record<string, TRegisteredDomain> {
	return mapDefinitionsToDomains([
		{ selectors: [PERSON_DOMAIN], schema: z.object({ id: z.string() }), description: "person" },
		{ selectors: [EMAIL_DOMAIN], schema: z.object({ id: z.string() }), description: "email" },
		{ selectors: [SESSION_DOMAIN], schema: z.object({ id: z.string() }), description: "session" },
	]);
}

class EmailFromPerson extends AStepper {
	steps: TStepperSteps = {
		issue: {
			gwta: `issue email for {who: ${PERSON_DOMAIN}}`,
			inputDomains: { who: PERSON_DOMAIN },
			outputDomain: EMAIL_DOMAIN,
			action: () => actionOKWithProducts({ id: "e1" }),
		},
	};
}

class SessionFromPerson extends AStepper {
	steps: TStepperSteps = {
		signIn: {
			gwta: `sign in {who: ${PERSON_DOMAIN}}`,
			inputDomains: { who: PERSON_DOMAIN },
			outputDomain: SESSION_DOMAIN,
			capability: "auth:signin",
			action: () => actionOKWithProducts({ id: "s1" }),
		},
	};
}

class PlainStepper extends AStepper {
	steps: TStepperSteps = {
		ping: {
			gwta: "ping",
			action: () => OK,
		},
	};
}

describe("buildDomainChain", () => {
	it("returns an empty graph for an empty stepper set", () => {
		const graph = buildDomainChain([], {});
		expect(graph.domains).toEqual([]);
		expect(graph.steps).toEqual([]);
		expect(graph.edges).toEqual([]);
	});

	it("includes domain nodes for every registered domain", () => {
		const graph = buildDomainChain([], fixedDomains());
		expect(graph.domains.map((d) => d.key).sort()).toEqual([EMAIL_DOMAIN, PERSON_DOMAIN, SESSION_DOMAIN]);
	});

	it("includes a step record for every step on every stepper", () => {
		const graph = buildDomainChain([new EmailFromPerson(), new SessionFromPerson()], fixedDomains());
		expect(graph.steps.map((s) => `${s.stepperName}.${s.stepName}`).sort()).toEqual(["EmailFromPerson.issue", "SessionFromPerson.signIn"]);
	});

	it("creates one edge per (input → output) pair labeled by step", () => {
		const graph = buildDomainChain([new EmailFromPerson(), new SessionFromPerson()], fixedDomains());
		expect(graph.edges).toHaveLength(2);
		const edge1 = graph.edges.find((e) => e.stepName === "issue");
		expect(edge1).toMatchObject({ from: PERSON_DOMAIN, to: EMAIL_DOMAIN, stepperName: "EmailFromPerson", stepName: "issue" });
	});

	it("produces no edges for a step with no input or output domains", () => {
		const graph = buildDomainChain([new PlainStepper()], fixedDomains());
		expect(graph.edges).toHaveLength(0);
		const ping = graph.steps.find((s) => s.stepName === "ping");
		expect(ping?.inputDomains).toEqual([]);
		expect(ping?.outputDomains).toEqual([]);
	});

	it("captures the step's capability requirement on the step record", () => {
		const graph = buildDomainChain([new SessionFromPerson()], fixedDomains());
		const signIn = graph.steps.find((s) => s.stepName === "signIn");
		expect(signIn?.capability).toBe("auth:signin");
	});
});
