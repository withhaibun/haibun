import { AStepper } from "../steps/domains/stepper.js";
import { actionNotOK, actionOK } from "../domains/util.js";
import { TEST_STEP } from "./test-step.js";

const TestSteps = class TestSteps extends AStepper {
	description = "Steps that pass, fail or throw, for tests of how a run treats each outcome.";
	steps = {
		fails: { description: TEST_STEP, gwta: "fails", action: async () => Promise.resolve(actionNotOK("test fail")) },
		test: { description: TEST_STEP, exact: "have a test", action: async () => Promise.resolve(actionOK()) },
		passes: { description: TEST_STEP, exact: "passes", action: async () => Promise.resolve(actionOK()) },
		throws: {
			description: TEST_STEP,
			gwta: "throw an exception",
			action: () => {
				throw Error(`<Thrown for test case>`);
			},
		},
	};
};

export default TestSteps;
