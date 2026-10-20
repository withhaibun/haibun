/**
 * The predicate registry: a step proves the predicate its method names or the one it declares, over its pattern's parts in
 * order; a step that holds rules proves each head; a line doesn't state precedes; a record states its type's and its fields'
 * predicates; and a call renders as its step's pattern with each value it states written literally.
 */
import { describe, expect, it } from "vitest";
import { actionOK } from "../../domains/util.js";
import { LinkRelations, type TRegisteredDomain } from "../../domains/resources.js";
import { AStepper, PREDICATE, READING, type TWaypointRule } from "../domains/stepper.js";
import { phraseParts } from "../domains/phrase.js";
import { declaredSteps, lineOfCall, predicateArities, predicatesOf } from "./predicate-registry.js";

const action = () => actionOK();
const RULE: TWaypointRule = { head: "{m: meal} is ready", pattern: "{m: meal} is ready", proof: [], activity: [], source: { path: "kitchen.feature" } };

class Kitchen extends AStepper {
	description = "Declares the steps the registry reads.";
	steps = {
		plate: { gwta: "plate {dish: meal} on {plate: crockery | cutlery}", action },
		served: { exact: "dinner is served", action },
		among: { gwta: "{dish: meal} is among {menu: domain-key}", predicate: PREDICATE.memberOf, action },
		cook: { rules: () => [RULE], reading: READING.apply },
		say: { prose: true, action },
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
		expect(named(RULE.head)).toMatchObject({ line: RULE.head, method: "Kitchen-cook" });
	});

	it("holds precedes without a line, and a prose step doesn't prove a predicate", () => {
		expect(named(PREDICATE.precedes)?.line).toBeUndefined();
		expect(partsOf(PREDICATE.precedes)).toEqual(["domain: domain-key", "before: variable-value", "after: variable-value"]);
		expect(predicates.map(({ method }) => method)).not.toContain("Kitchen-say");
	});

	it("holds a formula to the arity of the steps' predicates and of the predicates a record's type and fields state", () => {
		const topology = { persistedAs: "Recipe", properties: { id: LinkRelations.IDENTIFIER.rel }, edges: { uses: { rel: LinkRelations.PART_OF.rel, range: "Pantry" } } };
		const arities = predicateArities([new Kitchen()], { recipe: { topology } as unknown as TRegisteredDomain });
		expect(["Recipe", "id", "uses", "Kitchen-plate", PREDICATE.precedes].map((name) => arities.get(name))).toEqual([1, 2, 2, 2, 3]);
	});

	it("renders a call as its step's pattern with each value it states written literally, and leaves a part it doesn't state as the pattern names it", () => {
		expect(lineOfCall("plate {dish: meal} on {plate: number}", { dish: "soup", plate: 2 })).toBe('plate "soup" on 2');
		expect(lineOfCall("plate {dish: meal} on {plate: number}", { dish: "soup" })).toBe('plate "soup" on {plate: number}');
	});

	it("reads each placeholder of a phrase once, in its order, with a union's parts in order", () => {
		expect(phraseParts("{a} and {b: zeta | alpha} then {a}").map(({ name, domain }) => `${name}: ${domain}`)).toEqual(["a: string", "b: alpha | zeta"]);
	});
});
