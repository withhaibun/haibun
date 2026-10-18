import { describe, it, expect } from "vitest";
import { z } from "zod";

import { AStepper, type TStepperSteps } from "./steps/domains/stepper.js";
import { deriveNamingDomains, mapDefinitionsToDomains, refDomainKey } from "./domains/domains.js";
import { Access, LinkRelations } from "./resources.js";
import { OK } from "./domains/protocol.js";
import { actionOKWithProducts } from "./util/index.js";
import { buildAffordances } from "./affordances.js";
import type { TFact } from "./records/domains/facts.js";
import { executionOf, factIdOf } from "./actuality/domains/seq-path.js";
import { RUN_AUTHORITY } from "./capability-context.js";

const PERSON = "person";
const EMAIL = "letter";
const SESSION = "session";

function fixedDomains() {
	return mapDefinitionsToDomains([
		{ selectors: [PERSON], schema: z.object({ id: z.string() }), description: "person" },
		{ selectors: [EMAIL], schema: z.object({ id: z.string() }), description: "letter" },
		{ selectors: [SESSION], schema: z.object({ id: z.string() }), description: "session" },
	]);
}

class EmailFromPerson extends AStepper {
	description = "Issues an letter for a person.";
	steps: TStepperSteps = { issueEmail: { gwta: `issue letter for {who: ${PERSON}}`, productsDomain: EMAIL, action: () => actionOKWithProducts({ id: "e1" }) } };
}

/** A registered producer of Person. It makes Person a typed-fact domain instead of an argument. */
class PersonSource extends AStepper {
	description = "Registers a person.";
	steps: TStepperSteps = { registerPerson: { gwta: "register a person", productsDomain: PERSON, action: () => actionOKWithProducts({ id: "p1" }) } };
}

class SessionTerminal extends AStepper {
	description = "Creates a new session.";
	steps: TStepperSteps = { newSession: { gwta: "create a new session", productsDomain: SESSION, action: () => actionOKWithProducts({ id: "s1" }) } };
}

class GatedSession extends AStepper {
	description = "Signs in to a session behind a capability.";
	steps: TStepperSteps = { gatedSignIn: { gwta: "gated sign in", productsDomain: SESSION, capability: "auth:signin", action: () => actionOKWithProducts({ id: "s2" }) } };
}

class Plain extends AStepper {
	description = "A step that pings.";
	steps: TStepperSteps = { ping: { gwta: "ping", action: () => OK } };
}

describe("buildAffordances", () => {
	it("returns empty affordances for an empty stepper set", () => {
		const result = buildAffordances({ steppers: [], domains: {}, facts: [], held: RUN_AUTHORITY });
		expect(result.forward).toEqual([]);
		expect(result.goals).toEqual([]);
	});

	it("includes terminal producers in the forward frontier with readyToRun=true", () => {
		const result = buildAffordances({ steppers: [new SessionTerminal()], domains: fixedDomains(), facts: [], held: RUN_AUTHORITY });
		const newSession = result.forward.find((f) => f.stepName === "newSession");
		expect(newSession).toBeDefined();
		expect(newSession?.readyToRun).toBe(true);
		expect(newSession?.method).toBe("SessionTerminal-newSession");
	});

	it("marks steps with unsatisfied input domains as not readyToRun (input has a producer but doesn't have a fact yet)", () => {
		const result = buildAffordances({ steppers: [new EmailFromPerson(), new PersonSource()], domains: fixedDomains(), facts: [], held: RUN_AUTHORITY });
		const issue = result.forward.find((f) => f.stepName === "issueEmail");
		expect(issue?.readyToRun).toBe(false);
	});

	it("marks steps with satisfied input domains as readyToRun", () => {
		const fact: TFact = { id: "p:alice", domain: PERSON, value: { id: "alice" } };
		const result = buildAffordances({ steppers: [new EmailFromPerson(), new PersonSource()], domains: fixedDomains(), facts: [fact], held: RUN_AUTHORITY });
		const issue = result.forward.find((f) => f.stepName === "issueEmail");
		expect(issue?.readyToRun).toBe(true);
	});

	it("marks steps without a producer for an input as readyToRun: that input is supplied as an argument and isn't chained", () => {
		const result = buildAffordances({ steppers: [new EmailFromPerson()], domains: fixedDomains(), facts: [], held: RUN_AUTHORITY });
		const issue = result.forward.find((f) => f.stepName === "issueEmail");
		expect(issue?.readyToRun).toBe(true);
	});

	it("leaves a reference out of the goals and the composites, and the goals list the type it names", () => {
		const domains = deriveNamingDomains(
			mapDefinitionsToDomains([
				{ selectors: [PERSON], schema: z.object({ id: z.string() }), description: "person" },
				{
					selectors: [EMAIL],
					schema: z.object({ id: z.string() }),
					description: "letter",
					topology: { persistedAs: "Letter", accessLevel: Access.private, id: "id", properties: { id: LinkRelations.IDENTIFIER.rel } },
				},
			]),
		);
		class EmailRefFromPerson extends AStepper {
			description = "Returns a reference to a person's letter.";
			steps: TStepperSteps = { refer: { gwta: `refer to the letter of {who: ${PERSON}}`, productsDomain: refDomainKey(EMAIL), action: () => actionOKWithProducts({ id: "e1" }) } };
		}
		const result = buildAffordances({ steppers: [new EmailFromPerson(), new EmailRefFromPerson(), new PersonSource()], domains, facts: [], held: RUN_AUTHORITY });
		const goals = result.goals.map((g) => g.domain);
		expect(goals).toContain(EMAIL);
		expect(goals).not.toContain(refDomainKey(EMAIL));
		expect(result.composites?.[refDomainKey(EMAIL)], "a reference isn't a composite to decompose").toBeUndefined();
	});

	it("doesn't offer a step to a caller that doesn't hold an action", () => {
		const result = buildAffordances({ steppers: [new GatedSession(), new SessionTerminal()], domains: fixedDomains(), facts: [], held: [] });
		expect(result.forward).toEqual([]);
	});

	it("offers a step to a caller holding the action it declares", () => {
		const result = buildAffordances({ steppers: [new GatedSession()], domains: fixedDomains(), facts: [], held: ["auth:signin"] });
		const gated = result.forward.find((f) => f.stepName === "gatedSignIn");
		expect(gated).toBeDefined();
		expect(gated?.capability).toBe("auth:signin");
	});

	it("offers a step that doesn't declare an action to a caller holding its name", () => {
		const result = buildAffordances({ steppers: [new SessionTerminal()], domains: fixedDomains(), facts: [], held: ["SessionTerminal:newSession"] });
		expect(result.forward.find((f) => f.stepName === "newSession")?.capability).toBe("SessionTerminal:newSession");
	});

	it("excludes steps without declared inputs or outputs from the forward frontier", () => {
		const result = buildAffordances({ steppers: [new Plain()], domains: fixedDomains(), facts: [], held: RUN_AUTHORITY });
		expect(result.forward.find((f) => f.stepName === "ping")).toBeUndefined();
	});

	it("filters out trivial single-step goals: those duplicate the forward frontier and don't add chaining context", () => {
		const result = buildAffordances({ steppers: [new SessionTerminal(), new EmailFromPerson()], domains: fixedDomains(), facts: [], held: RUN_AUTHORITY });
		expect(result.goals.find((g) => g.domain === SESSION)).toBeUndefined();
		expect(result.goals.find((g) => g.domain === EMAIL)).toBeUndefined();
	});

	it("lists a goal where its only reachable path chains more than one step", () => {
		const result = buildAffordances({ steppers: [new EmailFromPerson(), new PersonSource()], domains: fixedDomains(), facts: [], held: RUN_AUTHORITY });
		const emailGoal = result.goals.find((g) => g.domain === EMAIL);
		expect(emailGoal?.resolution.finding).toBe("michi");
	});

	it("filters out satisfied single-step goals, since satisfiedDomains lists the asserted domain and the goal doesn't chain steps", () => {
		const fact: TFact = { id: "s:1", domain: SESSION, value: { id: "s1" } };
		const result = buildAffordances({ steppers: [new SessionTerminal()], domains: fixedDomains(), facts: [fact], held: RUN_AUTHORITY });
		expect(result.goals.find((g) => g.domain === SESSION)).toBeUndefined();
	});

	it("drops the facts of the steps after asOfSeqPath", () => {
		const execution = executionOf({ key: "1700000000000", featureNum: 1 });
		const personEarly: TFact = { id: factIdOf({ execution, path: [0, 1, 5] }), domain: PERSON, value: { id: "p1" } };
		const emailLate: TFact = { id: factIdOf({ execution, path: [0, 1, 9] }), domain: EMAIL, value: { id: "e1" } };
		const live = buildAffordances({ steppers: [new EmailFromPerson(), new PersonSource()], domains: fixedDomains(), facts: [personEarly, emailLate], held: RUN_AUTHORITY });
		expect(live.forward.find((f) => f.stepName === "issueEmail")?.readyToRun).toBe(true);
		const replay = buildAffordances({
			steppers: [new EmailFromPerson(), new PersonSource()],
			domains: fixedDomains(),
			facts: [personEarly, emailLate],
			held: RUN_AUTHORITY,
			asOfSeqPath: [0, 1, 6],
		});
		// asOfSeqPath drops emailLate (0.1.9) and keeps personEarly (0.1.5).
		expect(replay.forward.find((f) => f.stepName === "issueEmail")?.readyToRun).toBe(true);
		expect(live.satisfiedFacts[EMAIL]).toEqual([emailLate.id]);
		expect(replay.satisfiedFacts[EMAIL]).toBeUndefined();
		expect(replay.satisfiedFacts[PERSON]).toEqual([personEarly.id]);
	});
});
