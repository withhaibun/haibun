import { AStepper } from "../astepper.js";
import { actionNotOK, actionOK } from "../util/index.js";

const TestSteps = class TestSteps extends AStepper {
	description = "Steps that pass, fail or throw, for tests of how a run treats each outcome.";
	steps = {
		fails: {
			gwta: "fails",
			action: async () => Promise.resolve(actionNotOK("test fail")),
		},
		test: {
			exact: "have a test",
			action: async () => Promise.resolve(actionOK()),
		},
		passes: {
			exact: "passes",
			action: async () => Promise.resolve(actionOK()),
		},
		throws: {
			gwta: "throw an exception",
			action: () => {
				throw Error(`<Thrown for test case>`);
			},
		},
	};
};

export default TestSteps;
