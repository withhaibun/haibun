import { describe, it, expect } from "vitest";

import { createSteppers } from "@haibun/core/lib/util/index.js";
import { Resolver } from "@haibun/core/phases/Resolver.js";
import { asExpandedFeatures } from "@haibun/core/lib/resolver-features.js";
import WebPlaywright from "./web-playwright-stepper.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";

describe("click", () => {
	it("click", async () => {
		const features = asExpandedFeatures([{ path: "l1", content: 'click "Foo"' }]);
		const steppers = createSteppers([WebPlaywright]);
		const resolver = new Resolver(steppers);
		const steps = await resolver.resolveStepsFromFeatures(features);
		expect(itemAt(itemAt(steps, 0).featureSteps, 0).action.actionName).toBe("click");
	});
});
describe("clickBy", () => {
	it("clickBy placeholder", async () => {
		const features = asExpandedFeatures([{ path: "l1", content: 'click "Search authorities" by "placeholder"' }]);
		const steppers = createSteppers([WebPlaywright]);
		const resolver = new Resolver(steppers);
		const steps = await resolver.resolveStepsFromFeatures(features);
		expect(itemAt(itemAt(steps, 0).featureSteps, 0).action.actionName).toBe("clickBy");
	});
});
describe("requestsMatching", () => {
	it("resolves blocking and allowing a URL glob", async () => {
		const features = asExpandedFeatures([{ path: "l1", content: 'requests matching "**/rpc/**" are "blocked"\nrequests matching "**/rpc/**" are "allowed"' }]);
		const steppers = createSteppers([WebPlaywright]);
		const resolver = new Resolver(steppers);
		const steps = await resolver.resolveStepsFromFeatures(features);
		expect(itemAt(steps, 0).featureSteps.map((f) => f.action.actionName)).toEqual(["requestsMatching", "requestsMatching"]);
	});
});
describe("the response-length step", () => {
	it("counts the JSON list and the filtered members with one step", async () => {
		const features = asExpandedFeatures([{ path: "l1", content: "JSON response length is 3\nfiltered response length is 2" }]);
		const steps = await new Resolver(createSteppers([WebPlaywright])).resolveStepsFromFeatures(features);
		const actions = itemAt(steps, 0).featureSteps.map((step) => step.action);
		expect(actions.map((action) => action.actionName)).toEqual(["responseLengthIs", "responseLengthIs"]);
		expect(actions.map((action) => action.stepValuesMap?.list?.term)).toEqual(["JSON", "filtered"]);
	});
});
