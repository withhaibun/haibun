import { AStepper, type IHasCycles, type IHasOptions, type IStepperCycles } from "../astepper.js";
import { actionOKWithProducts, getStepperOption } from "../util/index.js";
import { z } from "zod";

const TestOptionResultSchema = z.object({ summary: z.string() });
const DOMAIN_TEST_OPTION_RESULT = "test-option-result";

export const TestStepsWithOptions = class TestStepsWithOptions extends AStepper implements IHasOptions, IHasCycles {
	cycles: IStepperCycles = {
		getConcerns: () => ({ domains: [{ selectors: [DOMAIN_TEST_OPTION_RESULT], schema: TestOptionResultSchema, description: "That a step read its stepper's option" }] }),
	};
	options = {
		EXISTS: {
			desc: "option exists",
			parse: () => ({ result: 42 }),
		},
	};
	description = "Steps that read a stepper option, for tests of how a run passes options to a stepper.";
	steps = {
		test: {
			exact: "have a stepper option",
			productsDomain: DOMAIN_TEST_OPTION_RESULT,
			action: () => {
				const _res = getStepperOption(this, "EXISTS", this.getWorld().moduleOptions);
				return Promise.resolve(actionOKWithProducts({ summary: "options" }));
			},
		},
	};
};

export default TestStepsWithOptions;
