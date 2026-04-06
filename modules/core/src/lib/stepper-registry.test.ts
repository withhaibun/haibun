import { describe, it, expect } from "vitest";
import { AStepper } from "./astepper.js";
import { StepperRegistry } from "./stepper-registry.js";
import { OK } from "../schema/protocol.js";

class TestStepper extends AStepper {
	steps = {
		simpleStep: {
			exact: "do something",
			action: async () => OK,
		},
		gwtaStep: {
			gwta: "set {name} to {value}",
			action: async () => OK,
		},
		gwtaWithDomain: {
			gwta: "count is {count: number}",
			action: async () => OK,
		},
		hiddenStep: {
			exact: "hidden action",
			exposeMCP: false,
			action: async () => OK,
		},
		matchStep: {
			match: /^do (.*) with (.*)$/,
			action: async () => OK,
		},
	};
}

describe("StepperRegistry", () => {
	describe("getMetadata", () => {
		const steppers = [new TestStepper()];
		const metadata = StepperRegistry.getMetadata(steppers);

		it("extracts metadata from all exposed steps", () => {
			expect(metadata.length).toBe(4); // 5 steps - 1 hidden
		});

		it("filters out steps with exposeMCP: false", () => {
			const hidden = metadata.find((m) => m.stepName === "hiddenStep");
			expect(hidden).toBeUndefined();
		});

		it("extracts stepperName correctly", () => {
			const step = metadata.find((m) => m.stepName === "simpleStep");
			expect(step?.stepperName).toBe("TestStepper");
		});

		it("uses exact pattern for exact steps", () => {
			const step = metadata.find((m) => m.stepName === "simpleStep");
			expect(step?.pattern).toBe("do something");
		});

		it("uses gwta pattern for gwta steps", () => {
			const step = metadata.find((m) => m.stepName === "gwtaStep");
			expect(step?.pattern).toBe("set {name} to {value}");
		});

		it("extracts params from gwta patterns", () => {
			const step = metadata.find((m) => m.stepName === "gwtaStep");
			expect(step?.params).toEqual({ name: "string", value: "string" });
		});

		it("detects number domain in params", () => {
			const step = metadata.find((m) => m.stepName === "gwtaWithDomain");
			expect(step?.params).toEqual({ count: "number" });
		});

		it("handles match regex patterns", () => {
			const step = metadata.find((m) => m.stepName === "matchStep");
			expect(step?.pattern).toContain("do (.*) with (.*)");
			expect(step?.params).toEqual({});
		});
	});

	describe("patternToSnippet", () => {
		it("converts simple variables to tab-stops", () => {
			const snippet = StepperRegistry.patternToSnippet("set {name} to {value}");
			expect(snippet).toBe("set ${1:name} to ${2:value}");
		});

		it("handles variables with domain annotations", () => {
			const snippet = StepperRegistry.patternToSnippet("count is {count: number}");
			expect(snippet).toBe("count is ${1:count}");
		});

		it("returns unchanged text if no variables", () => {
			const snippet = StepperRegistry.patternToSnippet("do something");
			expect(snippet).toBe("do something");
		});
	});
});
