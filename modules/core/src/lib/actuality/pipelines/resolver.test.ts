import { describe, it, test, expect } from "vitest";

import type { TExpandedFeature } from "../domains/execution.js";
import { OK } from "../../domains/protocol.js";
import { AStepper, type CStepper } from "../../steps/domains/stepper.js";
import { asExpandedFeatures } from "../../test/resolver-features.js";
import TestSteps from "../../test/TestSteps.js";
import { createSteppers } from "../../domains/util.js";
import { itemAt } from "../../domains/item-at.js";
import { Resolver } from "./resolver.js";
import Haibun from "../../../steps/haibun-stepper.js";

describe("resolve steps", () => {
	it("resolves steps", async () => {
		const features = asExpandedFeatures([{ path: "l1", content: "Then it passes" }]);
		const steppers = createSteppers([TestSteps]);
		const resolver = new Resolver(steppers, []);
		const steps = await resolver.resolveStepsFromFeatures(features);
		expect(steps.length).toBe(1);
	});
});

describe("validate map steps", () => {
	class TestStepper extends AStepper {
		description = "Exact, match, gwta and interpolated steps for resolving lines.";
		steps = {
			exact: { exact: "exact1", action: async () => Promise.resolve(OK) },
			match: { match: /match(?<num>1)/, action: async () => Promise.resolve(OK) },
			gwta: { gwta: "gwta(?<num>.)", action: async () => Promise.resolve(OK) },
			gwtaInterpolated: { gwta: "is {what}", action: async () => Promise.resolve(OK) },
		};
	}

	const getResolvedSteps = async (features: TExpandedFeature[]) => {
		const steppers = createSteppers([TestStepper]);
		const resolver = new Resolver(steppers, []);
		return await resolver.resolveStepsFromFeatures(features);
	};
	describe("exact", () => {
		test("exact", async () => {
			const features = asExpandedFeatures([{ path: "l1", content: `exact1` }]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = itemAt(res, 0);
			// exact steps don't have stepValuesMap
			expect(itemAt(featureSteps, 0).action.stepValuesMap).toBeUndefined();
		});
	});
	describe("match", () => {
		test("match", async () => {
			const features = asExpandedFeatures([{ path: "l1", content: `match1` }]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = itemAt(res, 0);
			expect(itemAt(featureSteps, 0).action.stepValuesMap).toEqual({});
		});
	});
	describe("gwta regex", () => {
		test("gwta", async () => {
			const features = asExpandedFeatures([{ path: "l1", content: `gwta2\nGiven I'm gwta3\nWhen I am gwta4\ngwta5\nThen the gwta6` }]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = itemAt(res, 0);
			// gwta pattern using regex groups directly uses empty stepValuesMap
			featureSteps.forEach((fs) => expect(fs.action.stepValuesMap).toEqual({}));
		});
	});
	describe("gwta interpolated", () => {
		test("gets quoted", async () => {
			const features = asExpandedFeatures([{ path: "l1", content: 'is "string"' }]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = itemAt(res, 0);
			const sv = itemAt(featureSteps, 0).action.stepValuesMap?.["what"];
			expect(sv?.term).toEqual("string");
		});
		test("gets uri", async () => {
			const features = asExpandedFeatures([{ path: "l1", content: "is http://url" }]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = itemAt(res, 0);
			const sv = itemAt(featureSteps, 0).action.stepValuesMap?.["what"];
			expect(sv?.term).toEqual("http://url");
		});
	});
});

describe("unique stepper", () => {
	const astep = "step";
	class UniqueStepper extends AStepper {
		description = "A unique step and a normal step with the same phrase.";
		steps = { uniqueStep: { unique: true, gwta: astep, action: async () => Promise.resolve(OK) }, normalStep: { gwta: astep, action: async () => Promise.resolve(OK) } };
	}
	test("uses unique step when multiple match", async () => {
		const features = asExpandedFeatures([{ path: "l1", content: astep }]);
		const steppers = createSteppers([UniqueStepper]);
		const resolver = new Resolver(steppers, []);
		const steps = await resolver.resolveStepsFromFeatures(features);
		expect(steps.length).toBe(1);
		expect(itemAt(steps, 0).featureSteps.length).toBe(1);
		expect(itemAt(itemAt(steps, 0).featureSteps, 0).action.stepperName).toBe("UniqueStepper");
	});
});
describe("preclude stepper", () => {
	class PrecludedStepper extends AStepper {
		description = "A step another stepper precludes.";
		steps = { doesSomething: { gwta: "does {something}", action: async () => Promise.resolve(OK) } };
	}
	class PrecluderStepper extends AStepper {
		description = "A step that precludes PrecludedStepper.doesSomething.";
		steps = { doesSomething: { gwta: "does {something} else", precludes: ["PrecludedStepper.doesSomething"], action: async () => Promise.resolve(OK) } };
	}
	test("precludes stepper", async () => {
		const features = asExpandedFeatures([{ path: "l1", content: "does something else" }]);
		const steppers = createSteppers([PrecludedStepper, PrecluderStepper]);
		const resolver = new Resolver(steppers, []);
		const steps = await resolver.resolveStepsFromFeatures(features);
		expect(steps.length).toBe(1);
		expect(itemAt(steps, 0).featureSteps.length).toBe(1);
		expect(itemAt(itemAt(steps, 0).featureSteps, 0).action.stepperName).toBe("PrecluderStepper");
	});
});

describe("prose", () => {
	class LineStepper extends AStepper {
		description = "Steps whose phrases read like prose.";
		steps = { type: { gwta: "type {text}", action: async () => Promise.resolve(OK) }, layout: { gwta: "{mode} the graph layout", action: async () => Promise.resolve(OK) } };
	}
	class SpokenProse extends AStepper {
		description = "A prose step that precludes Haibun.prose.";
		steps = { prose: { prose: true, precludes: ["Haibun.prose"], action: async () => Promise.resolve(OK) } };
	}
	const resolvedTo = (line: string, ...steppers: CStepper[]) => {
		const { stepperName, actionName } = new Resolver(createSteppers([Haibun, ...steppers]), []).findSingleStepAction(line);
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

describe("the steps a resolver offers", () => {
	it("are read again once a stepper adds a step, so a line resolves to a step added after the first resolution (CP7R3)", () => {
		class GrowingStepper extends AStepper {
			description = "Holds steps that a test adds after a line resolved.";
			steps: AStepper["steps"] = { first: { exact: "first step", action: async () => Promise.resolve(OK) } };
		}
		const steppers = createSteppers([GrowingStepper as CStepper]);
		const resolver = new Resolver(steppers, []);
		expect(resolver.findSingleStepAction("first step").actionName).toBe("first");
		expect(() => resolver.findSingleStepAction("added step")).toThrow(`"added step" doesn't match a step`);
		itemAt(steppers, 0).steps.added = { exact: "added step", action: async () => Promise.resolve(OK) };
		expect(resolver.findSingleStepAction("added step").actionName).toBe("added");
		delete itemAt(steppers, 0).steps.added;
		expect(() => resolver.findSingleStepAction("added step"), "and a step removed doesn't resolve").toThrow(`"added step" doesn't match a step`);
	});
});
