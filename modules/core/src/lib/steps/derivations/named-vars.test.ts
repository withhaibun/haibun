import { describe, it, test, expect } from "vitest";

import { OK, TStepArgs, Origin, TEST_BASE } from "../../../schema/protocol.js";
import { AStepper, TStepperStep } from "../domains/stepper.js";
import { getNamedMatches, namedInterpolation } from "./named-vars.js";
import { Resolver } from "../../../phases/Resolver.js";
import { actionNotOK, createSteppers } from "../../util/index.js";
import { getDefaultWorld } from "../../test/lib.js";
import { asExpandedFeatures } from "../../resolver-features.js";
import { withName } from "../../features.js";
import { populateActionArgs } from "../pipelines/populate-action-args.js";
import { DOMAIN_STRING } from "../../domains.js";
import { itemAt } from "../../util/item-at.js";

describe("namedMatches", () => {
	const step: TStepperStep = { match: /^(?<one>.*?) is (?<two>.*?)$/, action: async () => Promise.resolve(actionNotOK("test")) };

	it("gets named matches", () => {
		expect(getNamedMatches(step.match as RegExp, "It is set")).toEqual({ one: "It", two: "set" });
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
});

describe("getNamedWithVars", () => {
	class TestStepper extends AStepper {
		description = "A step taking an interpolated value.";
		steps = { gwtaInterpolated: { gwta: "is {what}", action: async () => Promise.resolve(OK) } };
	}
	const world = getDefaultWorld();
	test("gets var", async () => {
		const steppers = createSteppers([TestStepper]);
		const resolver = new Resolver(steppers);
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
