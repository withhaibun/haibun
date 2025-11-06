import { Resolver } from "../../phases/Resolver.js";
import Haibun from "../../steps/haibun.js";
import { AStepper } from "../astepper.js";
import { OK } from "../defs.js";
import { expand } from "../features.js";
import { TProtoFeature, asFeatures } from "../resolver-features.js";
import { createSteppers } from "../util/index.js";

class TestStepper extends AStepper {
	steps = {
		exact: {
			exact: 'exact1',
			action: async () => Promise.resolve(OK),
		},
		match: {
			match: /match(?<num>1)/,
			action: async () => Promise.resolve(OK),
		},
		gwta: {
			gwta: 'gwta(?<num>.)',
			action: async () => Promise.resolve(OK),
		},
		gwtaInterpolated: {
			gwta: 'is {what}',
			action: async () => Promise.resolve(OK),
		},
		backgroundStep: {
			exact: 'Background step 1',
			action: async () => Promise.resolve(OK),
		},
	};
}

export const getResolvedTestFeatures = async (f: TProtoFeature, b: TProtoFeature, steppersIn = [TestStepper, Haibun]) => {
	const features = asFeatures(f);
	const backgrounds = asFeatures(b);
	const steppers = await createSteppers(steppersIn);
	const expandedFeatures = await expand({ backgrounds, features });
	const resolver = new Resolver(steppers, backgrounds);

	const resolvedFeatures = await resolver.resolveStepsFromFeatures(expandedFeatures);
	return resolvedFeatures;
};
