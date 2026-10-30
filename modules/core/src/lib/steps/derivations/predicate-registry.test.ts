/**
 * The predicate registry: a step proves the predicate its method names or the one it declares, over its pattern's parts in
 * order; a step that holds rules proves each head; a line doesn't state precedes; a record states its type's and its fields'
 * predicates; an axiom names a predicate at the arity the registry holds it; two steps don't declare one predicate; and a call
 * renders as its step's pattern with each value it states written literally.
 */
import { describe, expect, it } from "vitest";
import { actionOK } from "../../domains/util.js";
import { AStepper, PREDICATE, READING, type TWaypointRule } from "../domains/stepper.js";
import { phraseParts } from "../domains/phrase.js";
import { declaredSteps, predicatesOf } from "./predicate-registry.js";
import { TEST_STEP } from "../../test/test-step.js";

const action = () => actionOK();
const RULE: TWaypointRule = {
	head: "{m: meal} is ready",
	description: "Cook a meal",
	pattern: "{m: meal} is ready",
	proof: [],
	activity: [],
	source: { path: "kitchen.feature" },
	library: "kitchen.feature",
};

class Kitchen extends AStepper {
	description = "Declares the steps the registry reads.";
	steps = {
		plate: { description: TEST_STEP, gwta: "plate {dish: meal} on {plate: crockery | cutlery}", action },
		served: { description: TEST_STEP, exact: "dinner is served", action },
		among: { description: TEST_STEP, gwta: "{dish: meal} is among {menu: domain-key}", predicate: PREDICATE.memberOf, action },
		cook: { description: TEST_STEP, rules: () => [RULE], reading: READING.apply },
		say: { description: TEST_STEP, prose: true, action },
	};
}

describe("the predicate registry", () => {
	const predicates = predicatesOf(declaredSteps([new Kitchen()]));
	const named = (sought: string) => predicates.find(({ name }) => name === sought);
	const partsOf = (sought: string) => named(sought)?.parts.map(({ name, domain }) => `${name}: ${domain}`);

	it("names a step's predicate by its method over its pattern's parts in order, each with its domain, and states its line and method", () => {
		expect(partsOf("Kitchen-plate")).toEqual(["dish: meal", "plate: crockery | cutlery"]);
		expect(named("Kitchen-plate")).toMatchObject({ line: "plate {dish: meal} on {plate: crockery | cutlery}", method: "Kitchen-plate" });
		expect(named("Kitchen-served"), "an exact line, which doesn't take a part").toMatchObject({ parts: [], line: "dinner is served" });
	});

	it("names a step that declares its predicate by that predicate, proved by the step's method, and each rule a step holds by its head", () => {
		expect(named(PREDICATE.memberOf)).toMatchObject({ method: "Kitchen-among", line: "{dish: meal} is among {menu: domain-key}" });
		expect(partsOf(RULE.head)).toEqual(["m: meal"]);
		expect(named(RULE.head)).toMatchObject({ line: RULE.head, method: "Kitchen-cook", waypoint: RULE.library, description: RULE.description });
	});

	it("holds precedes without a line, and a prose step doesn't prove a predicate", () => {
		expect(named(PREDICATE.precedes)?.line).toBeUndefined();
		expect(partsOf(PREDICATE.precedes)).toEqual(["domain: domain-key", "before: variable-value", "after: variable-value"]);
		expect(predicates.map(({ method }) => method)).not.toContain("Kitchen-say");
	});

	it("refuses two steps that declare member_of, and names both", () => {
		class Pantry extends AStepper {
			description = "Declares member_of a second time.";
			steps = { stocked: { description: TEST_STEP, gwta: "{dish: meal} is stocked in {shelf: domain-key}", predicate: PREDICATE.memberOf, action } };
		}
		expect(() => predicatesOf(declaredSteps([new Kitchen(), new Pantry()]))).toThrow(`Kitchen-among and Pantry-stocked each declare the predicate ${PREDICATE.memberOf}`);
	});

	it("reads each placeholder of a phrase once, in its order, with a union's parts in order", () => {
		expect(phraseParts("{a} and {b: zeta | alpha} then {a}").map(({ name, domain }) => `${name}: ${domain}`)).toEqual(["a: string", "b: alpha | zeta"]);
	});
});
