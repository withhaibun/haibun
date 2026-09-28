import { describe, it, test, expect } from "vitest";

import type { TExpandedFeature } from "../lib/execution.js";
import { OK } from "../schema/protocol.js";
import { AStepper, type CStepper, TResolvedFeature } from "../lib/astepper.js";
import { asExpandedFeatures } from "../lib/resolver-features.js";
import TestSteps from "../lib/test/TestSteps.js";
import { createSteppers } from "../lib/util/index.js";
import { Resolver } from "./Resolver.js";
import Haibun from "../steps/haibun.js";

describe("resolve steps", () => {
	it("resolves steps", async () => {
		const features = asExpandedFeatures([{ path: "l1", content: "Then it passes" }]);
		const steppers = createSteppers([TestSteps]);
		const resolver = new Resolver(steppers);
		const steps = await resolver.resolveStepsFromFeatures(features);
		expect(steps.length).toBe(1);
	});
});

describe("validate map steps", () => {
	class TestStepper extends AStepper {
		steps = {
			exact: {
				exact: "exact1",
				action: async () => Promise.resolve(OK),
			},
			match: {
				match: /match(?<num>1)/,
				action: async () => Promise.resolve(OK),
			},
			gwta: {
				gwta: "gwta(?<num>.)",
				action: async () => Promise.resolve(OK),
			},
			gwtaInterpolated: {
				gwta: "is {what}",
				action: async () => Promise.resolve(OK),
			},
		};
	}

	const getResolvedSteps = async (features: TExpandedFeature[]) => {
		const steppers = createSteppers([TestStepper]);
		const resolver = new Resolver(steppers);
		return await resolver.resolveStepsFromFeatures(features);
	};
	describe("exact", () => {
		test("exact", async () => {
			const features = asExpandedFeatures([{ path: "l1", content: `exact1` }]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = res[0];
			// exact steps don't have stepValuesMap
			expect(featureSteps[0].action.stepValuesMap).toBeUndefined();
		});
	});
	describe("match", () => {
		test("match", async () => {
			const features = asExpandedFeatures([{ path: "l1", content: `match1` }]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = res[0];
			expect(featureSteps[0].action.stepValuesMap).toEqual({});
		});
	});
	describe("gwta regex", () => {
		test("gwta", async () => {
			const features = asExpandedFeatures([{ path: "l1", content: `gwta2\nGiven I'm gwta3\nWhen I am gwta4\ngwta5\nThen the gwta6` }]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = res[0] as TResolvedFeature;
			// gwta pattern using regex groups directly uses empty stepValuesMap
			featureSteps.forEach((fs) => expect(fs.action.stepValuesMap).toEqual({}));
		});
	});
	describe("gwta interpolated", () => {
		test("gets quoted", async () => {
			const features = asExpandedFeatures([{ path: "l1", content: 'is "string"' }]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = res[0] as TResolvedFeature;
			const sv = featureSteps[0].action.stepValuesMap?.["what"];
			expect(sv?.term).toEqual("string");
		});
		test("gets uri", async () => {
			const features = asExpandedFeatures([{ path: "l1", content: "is http://url" }]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = res[0] as TResolvedFeature;
			const sv = featureSteps[0].action.stepValuesMap?.["what"];
			expect(sv?.term).toEqual("http://url");
		});
	});
});

describe("unique stepper", () => {
	const astep = "step";
	class UniqueStepper extends AStepper {
		steps = {
			uniqueStep: {
				unique: true,
				gwta: astep,
				action: async () => Promise.resolve(OK),
			},
			normalStep: {
				gwta: astep,
				action: async () => Promise.resolve(OK),
			},
		};
	}
	test("uses unique step when multiple match", async () => {
		const features = asExpandedFeatures([{ path: "l1", content: astep }]);
		const steppers = createSteppers([UniqueStepper]);
		const resolver = new Resolver(steppers);
		const steps = await resolver.resolveStepsFromFeatures(features);
		expect(steps.length).toBe(1);
		expect(steps[0].featureSteps.length).toBe(1);
		expect(steps[0].featureSteps[0].action.stepperName).toBe("UniqueStepper");
	});
});
describe("preclude stepper", () => {
	class PrecludedStepper extends AStepper {
		steps = {
			doesSomething: {
				gwta: "does {something}",
				action: async () => Promise.resolve(OK),
			},
		};
	}
	class PrecluderStepper extends AStepper {
		steps = {
			doesSomething: {
				gwta: "does {something} else",
				precludes: ["PrecludedStepper.doesSomething"],
				action: async () => Promise.resolve(OK),
			},
		};
	}
	test("precludes stepper", async () => {
		const features = asExpandedFeatures([{ path: "l1", content: "does something else" }]);
		const steppers = createSteppers([PrecludedStepper, PrecluderStepper]);
		const resolver = new Resolver(steppers);
		const steps = await resolver.resolveStepsFromFeatures(features);
		expect(steps.length).toBe(1);
		expect(steps[0].featureSteps.length).toBe(1);
		expect(steps[0].featureSteps[0].action.stepperName).toBe("PrecluderStepper");
	});
});

describe("prose", () => {
	class LineStepper extends AStepper {
		steps = {
			type: { gwta: "type {text}", action: async () => Promise.resolve(OK) },
			layout: { gwta: "{mode} the graph layout", action: async () => Promise.resolve(OK) },
		};
	}
	class SpokenProse extends AStepper {
		steps = { prose: { prose: true, precludes: ["Haibun.prose"], action: async () => Promise.resolve(OK) } };
	}
	const resolvedTo = (line: string, ...steppers: CStepper[]) => {
		const { stepperName, actionName } = new Resolver(createSteppers([Haibun, ...steppers])).findSingleStepAction(line);
		return `${stepperName}.${actionName}`;
	};
	const PROSE = "Haibun.prose";
	const ARTICLE_SENTENCE = "A type that names a component to show itself is a view.";

	it("resolves a sentence to prose, where dePolite's removal of its leading article leaves a step's words", () => {
		expect(resolvedTo(ARTICLE_SENTENCE, LineStepper)).toBe(PROSE);
		expect(resolvedTo("type that names a component", LineStepper)).toBe("LineStepper.type");
	});
	it("resolves a heading whose title ends with punctuation to the heading", () => {
		expect(resolvedTo("Scenario: What can I make right now?")).toBe("Haibun.scenario");
	});
	it("resolves a line that starts with a character other than a letter to a step that matches it, and to prose where the steps don't match it", () => {
		expect(resolvedTo('"flatten" the graph layout', LineStepper)).toBe("LineStepper.layout");
		expect(resolvedTo("- a list item", LineStepper)).toBe(PROSE);
	});
	it("resolves prose to the prose step that precludes another", () => {
		expect(resolvedTo(ARTICLE_SENTENCE, SpokenProse)).toBe("SpokenProse.prose");
	});
});
