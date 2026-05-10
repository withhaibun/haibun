import { describe, it, expect } from "vitest";
import { z } from "zod";

import { AStepper, type TStepperSteps } from "./astepper.js";
import { mapDefinitionsToDomains } from "./domains.js";
import { OK } from "../schema/protocol.js";
import { actionOKWithProducts } from "./util/index.js";
import { buildAffordances } from "./affordances.js";
import type { TQuad } from "./quad-types.js";

const PERSON = "person";
const EMAIL = "email";
const SESSION = "session";

function fixedDomains() {
	return mapDefinitionsToDomains([
		{ selectors: [PERSON], schema: z.object({ id: z.string() }), description: "person" },
		{ selectors: [EMAIL], schema: z.object({ id: z.string() }), description: "email" },
		{ selectors: [SESSION], schema: z.object({ id: z.string() }), description: "session" },
	]);
}

class EmailFromPerson extends AStepper {
	steps: TStepperSteps = {
		issueEmail: {
			gwta: `issue email for {who: ${PERSON}}`,
			inputDomains: { who: PERSON },
			outputDomain: EMAIL,
			action: () => actionOKWithProducts({ id: "e1" }),
		},
	};
}

class SessionTerminal extends AStepper {
	steps: TStepperSteps = {
		newSession: {
			gwta: "create a new session",
			outputDomain: SESSION,
			action: () => actionOKWithProducts({ id: "s1" }),
		},
	};
}

class GatedSession extends AStepper {
	steps: TStepperSteps = {
		gatedSignIn: {
			gwta: "gated sign in",
			outputDomain: SESSION,
			capability: "auth:signin",
			action: () => actionOKWithProducts({ id: "s2" }),
		},
	};
}

class Plain extends AStepper {
	steps: TStepperSteps = {
		ping: { gwta: "ping", action: () => OK },
	};
}

describe("buildAffordances", () => {
	it("returns empty affordances for an empty stepper set", () => {
		const result = buildAffordances({ steppers: [], domains: {}, facts: [], capabilities: new Set() });
		expect(result.forward).toEqual([]);
		expect(result.goals).toEqual([]);
	});

	it("includes terminal producers in the forward frontier with readyToRun=true", () => {
		const result = buildAffordances({ steppers: [new SessionTerminal()], domains: fixedDomains(), facts: [], capabilities: new Set() });
		const newSession = result.forward.find((f) => f.stepName === "newSession");
		expect(newSession).toBeDefined();
		expect(newSession?.readyToRun).toBe(true);
		expect(newSession?.method).toBe("SessionTerminal-newSession");
	});

	it("marks steps with unsatisfied input domains as not readyToRun", () => {
		const result = buildAffordances({ steppers: [new EmailFromPerson()], domains: fixedDomains(), facts: [], capabilities: new Set() });
		const issue = result.forward.find((f) => f.stepName === "issueEmail");
		expect(issue?.readyToRun).toBe(false);
	});

	it("marks steps with satisfied input domains as readyToRun", () => {
		const fact: TQuad = { subject: "p:alice", predicate: PERSON, object: { id: "alice" }, namedGraph: "facts", timestamp: 1 };
		const result = buildAffordances({ steppers: [new EmailFromPerson()], domains: fixedDomains(), facts: [fact], capabilities: new Set() });
		const issue = result.forward.find((f) => f.stepName === "issueEmail");
		expect(issue?.readyToRun).toBe(true);
	});

	it("filters out gated steps the caller lacks capability for", () => {
		const result = buildAffordances({ steppers: [new GatedSession()], domains: fixedDomains(), facts: [], capabilities: new Set() });
		expect(result.forward.find((f) => f.stepName === "gatedSignIn")).toBeUndefined();
	});

	it("includes gated steps when the caller holds the capability", () => {
		const result = buildAffordances({ steppers: [new GatedSession()], domains: fixedDomains(), facts: [], capabilities: new Set(["auth:signin"]) });
		const gated = result.forward.find((f) => f.stepName === "gatedSignIn");
		expect(gated).toBeDefined();
		expect(gated?.capability).toBe("auth:signin");
	});

	it("excludes steps with no declared inputs or outputs from the forward frontier", () => {
		const result = buildAffordances({ steppers: [new Plain()], domains: fixedDomains(), facts: [], capabilities: new Set() });
		expect(result.forward.find((f) => f.stepName === "ping")).toBeUndefined();
	});

	it("returns a goal affordance per producible domain with the resolver's verdict", () => {
		const result = buildAffordances({ steppers: [new SessionTerminal(), new EmailFromPerson()], domains: fixedDomains(), facts: [], capabilities: new Set() });
		const sessionGoal = result.goals.find((g) => g.domain === SESSION);
		expect(sessionGoal?.resolution.finding).toBe("plan");
		const emailGoal = result.goals.find((g) => g.domain === EMAIL);
		expect(emailGoal?.resolution.finding).toBe("unreachable");
	});

	it("marks a goal satisfied when a fact of its domain already exists", () => {
		const fact: TQuad = { subject: "s:1", predicate: SESSION, object: { id: "s1" }, namedGraph: "facts", timestamp: 1 };
		const result = buildAffordances({ steppers: [new SessionTerminal()], domains: fixedDomains(), facts: [fact], capabilities: new Set() });
		const sessionGoal = result.goals.find((g) => g.domain === SESSION);
		expect(sessionGoal?.resolution.finding).toBe("satisfied");
	});
});
