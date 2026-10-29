import { describe, expect, it } from "vitest";
import { AStepper } from "./stepper.js";
import { OK } from "../../domains/protocol.js";
import { Access } from "../../domains/resources.js";
import { getDefaultWorld } from "../../test/lib.js";
import { createStepTool } from "../pipelines/step-registry.js";
import { StepDescriptorSchema } from "./step-discovery.js";
import { toolDefinition } from "./step-discovery.js";
import { TEST_STEP } from "../../test/test-step.js";

class DescribedSteps extends AStepper {
	description = "Steps of each kind a stepper declares.";
	steps = {
		exactStep: { description: TEST_STEP, exact: "do something", action: async () => OK },
		gwtaStep: { gwta: "set {name} to {value}", description: "Sets a value.", read: true, readsAt: Access.private, action: async () => OK },
		numberStep: { description: TEST_STEP, gwta: "wait {seconds: number} seconds", capability: "DescribedSteps:wait", action: async () => OK },
		fallbackStep: { description: TEST_STEP, gwta: "do {what} with {how}", fallback: true, action: async () => OK },
	};
}

const describedAs = (stepName: keyof DescribedSteps["steps"]) => {
	const stepper = new DescribedSteps();
	return createStepTool(stepper, stepName, stepper.steps[stepName], getDefaultWorld()).descriptor;
};

describe("a step's description", () => {
	it("names the step by its stepper and its name, states its stepper's description, and parses as every caller reads it", () => {
		const step = describedAs("gwtaStep");
		expect(StepDescriptorSchema.parse(step)).toEqual(step);
		expect(step).toMatchObject({
			method: "DescribedSteps-gwtaStep",
			stepperName: "DescribedSteps",
			stepName: "gwtaStep",
			stepperDescription: "Steps of each kind a stepper declares.",
		});
	});

	it("states the step's line, whichever way the step declares it", () => {
		expect(describedAs("exactStep").pattern).toBe("do something");
		expect(describedAs("gwtaStep").pattern).toBe("set {name} to {value}");
		expect(describedAs("fallbackStep").pattern).toBe("do {what} with {how}");
	});

	it("states each parameter with its domain, and the schema of the arguments", () => {
		expect(describedAs("gwtaStep").paramDomains).toEqual({ name: "string", value: "string" });
		expect(describedAs("numberStep").paramDomains).toEqual({ seconds: "number" });
		expect(describedAs("numberStep").inputSchema.required).toEqual(["seconds"]);
		expect(describedAs("fallbackStep").paramDomains).toEqual({ what: "string", how: "string" });
	});

	it("states whether the step is a read and a fallback, and the capability it requires", () => {
		expect(describedAs("gwtaStep")).toMatchObject({ read: true, fallback: false, description: "Sets a value." });
		expect(describedAs("fallbackStep")).toMatchObject({ read: false, fallback: true });
		expect(describedAs("numberStep").capability).toBe("DescribedSteps:wait");
	});
});

describe("a step as a tool", () => {
	it("is named by its method, described by its line, its description and the capability it requires, and takes its arguments' schema", () => {
		const step = describedAs("numberStep");
		expect(toolDefinition(step)).toEqual({
			name: "DescribedSteps-numberStep",
			description: `wait {seconds: number} seconds\n\n${TEST_STEP}\n\nRequires capability DescribedSteps:wait.`,
			inputSchema: step.inputSchema,
			annotations: { title: "wait {seconds: number} seconds", readOnlyHint: false, destructiveHint: true },
		});
		expect(toolDefinition(describedAs("gwtaStep")).annotations, "a read states that it reads, and that it doesn't destroy").toEqual({
			title: "set {name} to {value}",
			readOnlyHint: true,
			destructiveHint: false,
		});
		expect(toolDefinition(describedAs("gwtaStep")).description, "a read that doesn't state its level requires a private read").toBe(
			"set {name} to {value}\n\nSets a value.\n\nRequires capability Read:private.",
		);
		expect(describedAs("fallbackStep").capability, "and a step that doesn't declare an action requires its own name").toBe("DescribedSteps:fallbackStep");
		expect(
			toolDefinition({ ...describedAs("gwtaStep"), remoteOrigin: "http://localhost:8331" }).description,
			"and the instance it runs at, for a step another instance declares",
		).toBe("set {name} to {value}\n\nSets a value.\n\nRequires capability Read:private.\n\nRuns at http://localhost:8331.");
	});
});
