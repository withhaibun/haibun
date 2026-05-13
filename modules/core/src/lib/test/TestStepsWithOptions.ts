import { IHasOptions } from "../astepper.js";
import { AStepper } from "../astepper.js";
import { actionOKWithProducts, getStepperOption } from "../util/index.js";
import { z } from "zod";

const TestOptionResultSchema = z.object({ summary: z.string() });

export const TestStepsWithOptions = class TestStepsWithOptions extends AStepper implements IHasOptions {
	options = {
		EXISTS: {
			desc: "option exists",
			parse: () => ({ result: 42 }),
		},
	};
	steps = {
		test: {
			exact: "have a stepper option",
			productsSchema: TestOptionResultSchema,
			action: () => {
				const _res = getStepperOption(this, "EXISTS", this.getWorld().moduleOptions);
				return Promise.resolve(actionOKWithProducts({ summary: "options" }));
			},
		},
	};
};

export default TestStepsWithOptions;
