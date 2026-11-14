import { describe, it, test, expect } from "vitest";

import { OK, TStepArgs, Origin } from "../../domains/protocol.js";
import { AStepper } from "../domains/stepper.js";
import { getNamedMatches, lineOfCall, mapInputToStepValues, matchGwtaToAction, namedInterpolation } from "./named-vars.js";
import { Resolver } from "../../actuality/pipelines/resolver.js";
import { createSteppers } from "../../domains/util.js";
import { getDefaultWorld } from "../../test/lib.js";
import { asExpandedFeatures, TEST_BASE } from "../../test/resolver-features.js";
import { withName } from "../../domains/features.js";
import { populateActionArgs } from "../pipelines/populate-action-args.js";
import { DOMAIN_STRING } from "../../domains/domains.js";
import { itemAt } from "../../domains/item-at.js";
import { TEST_STEP } from "../../test/test-step.js";
import { declareSteps } from "../domains/stepper.js";

describe("namedMatches", () => {
	it("gets named matches", () => {
		expect(getNamedMatches(/^(?<one>.*?) is (?<two>.*?)$/, "It is set")).toEqual({ one: "It", two: "set" });
	});
});

describe("namedInterpolation regexes", () => {
	test("regexes single", () => {
		const r = new RegExp(namedInterpolation("{ v1: string } ").regexPattern);

		expect(r.exec('"hi" there')?.groups?.q_0).toBe("hi");
		expect(r.exec("`hi` there")?.groups?.b_0).toBe("hi");
		expect(r.exec("hi there")?.groups?.t_0).toBe("hi");
	});

	test("regexes two", () => {
		const r2 = new RegExp(`^${namedInterpolation("{ v1 } is { v2 }").regexPattern}$`);
		const x = r2.exec("this is that");
		expect(x?.groups?.t_0).toBe("this");
		expect(x?.groups?.t_1).toBe("that");
	});

	test("ends a quoted term before a comma at the first quote the comma follows, so a statement after it keeps its own quoted terms", () => {
		const r = new RegExp(`^${namedInterpolation("ordered by {field}, {statement}").regexPattern}$`);
		const x = r.exec('ordered by "method", matching "Steps-", show steps');
		expect(x?.groups?.q_0).toBe("method");
		expect(x?.groups?.t_1).toBe('matching "Steps-", show steps');
	});
});

describe("getNamedWithVars", () => {
	class TestStepper extends AStepper {
		description = "A step taking an interpolated value.";
		steps = declareSteps({ gwtaInterpolated: { description: TEST_STEP, gwta: "is {what}", action: async () => Promise.resolve(OK) } });
	}
	const world = getDefaultWorld();
	test("gets var", async () => {
		const steppers = createSteppers([TestStepper]);
		const resolver = new Resolver(steppers, []);
		await world.shared.set({ term: "exact", value: "res", domain: DOMAIN_STRING, origin: Origin.var }, { seq: [0], when: "test" });
		const features = asExpandedFeatures([withName(TEST_BASE, "l1", "is `exact`")]);
		const steps = await resolver.resolveStepsFromFeatures(features);
		const featureStep = itemAt(itemAt(steps, 0).featureSteps, 0);
		expect(featureStep.action).toBeDefined();
		const val = (await populateActionArgs(featureStep, world, steppers)) as TStepArgs;
		expect(val.what).toBe("res");
	});
});

describe("a compiled phrase", () => {
	it("gives each match its own placeholders, so a match doesn't change the next match of the same phrase (PF13)", () => {
		const first = namedInterpolation("set {what} to {value}");
		const second = namedInterpolation("set {what} to {value}");
		expect(second.regexPattern).toBe(first.regexPattern);
		expect(second.stepValuesMap).not.toBe(first.stepValuesMap);
		if (first.stepValuesMap?.what === undefined) throw new Error("the phrase names {what}");
		first.stepValuesMap.what.term = "changed";
		expect(namedInterpolation("set {what} to {value}").stepValuesMap?.what?.term).toBe("what");
	});
});

describe("a bare term's origin", () => {
	const step = { gwta: "click {target}", description: "Clicks a target.", action: () => Promise.resolve(OK) };
	const originOf = (line: string) => matchGwtaToAction(step.gwta, line, "click", "Test", step)?.stepValuesMap?.target;
	it.each(["#alerts", ".item.active", "[data-id=a.b]", "/api/items", "*.json", "> li"])("reads %s, which starts with a symbol, as a literal", (term) => {
		expect(originOf(`click ${term}`)).toMatchObject({ term, origin: Origin.quoted });
	});
	it.each(["greeting", "snap.highlighted", "_private"])("reads %s, which starts as a variable's name, as a defined term", (term) => {
		expect(originOf(`click ${term}`)).toMatchObject({ term, origin: Origin.defined });
	});
});

describe("lineOfCall", () => {
	it("renders a call as its step's pattern with each value it states written literally, and leaves a part it doesn't state as the pattern names it", () => {
		expect(lineOfCall("plate {dish: meal} on {plate: number}", { dish: "soup", plate: 2 })).toBe('plate "soup" on 2');
		expect(lineOfCall("plate {dish: meal} on {plate: number}", { dish: "soup" })).toBe('plate "soup" on {plate: number}');
	});
});

describe("mapInputToStepValues", () => {
	it("keeps each declared placeholder's domain and refuses a key the pattern doesn't name", () => {
		expect(mapInputToStepValues({ x: "a" }, { x: "a" }, "take {x: string}").x).toEqual({ term: "a", value: "a", domain: DOMAIN_STRING, origin: Origin.quoted });
		expect(() => mapInputToStepValues({ depth: 2 }, { depth: 2 }, "take {x: string}")).toThrow(/"depth" isn't a parameter of the pattern `take \{x: string\}`/);
	});
});
