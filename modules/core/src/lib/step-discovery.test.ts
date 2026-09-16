import { describe, expect, it } from "vitest";
import { AStepper } from "./astepper.js";
import { OK } from "../schema/protocol.js";
import { getDefaultWorld } from "./test/lib.js";
import { createStepTool } from "./step-registry.js";
import { StepDescriptorSchema, toolDefinition } from "./step-discovery.js";

class DescribedSteps extends AStepper {
	description = "Steps of each kind a stepper declares.";
	steps = {
		exactStep: { exact: "do something", action: async () => OK },
		gwtaStep: { gwta: "set {name} to {value}", description: "Sets a value.", read: true, action: async () => OK },
		numberStep: { gwta: "wait {seconds: number} seconds", capability: "DescribedSteps:wait", action: async () => OK },
		matchStep: { match: /^do (.*) with (.*)$/, fallback: true, action: async () => OK },
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
		expect(describedAs("matchStep").pattern).toContain("do (.*) with (.*)");
	});

	it("states each parameter with its domain, and the schema of the arguments", () => {
		expect(describedAs("gwtaStep").paramDomains).toEqual({ name: "string", value: "string" });
		expect(describedAs("numberStep").paramDomains).toEqual({ seconds: "number" });
		expect(describedAs("numberStep").inputSchema.required).toEqual(["seconds"]);
		expect(describedAs("matchStep").paramDomains).toEqual({});
	});

	it("states whether the step is a read and a fallback, and the capability it requires", () => {
		expect(describedAs("gwtaStep")).toMatchObject({ read: true, fallback: false, description: "Sets a value." });
		expect(describedAs("matchStep")).toMatchObject({ read: false, fallback: true });
		expect(describedAs("numberStep").capability).toBe("DescribedSteps:wait");
	});
});

describe("a step as a tool", () => {
	it("is named by its method, described by its line, its description and the capability it requires, and takes its arguments' schema", () => {
		const step = describedAs("numberStep");
		expect(toolDefinition(step)).toEqual({
			name: "DescribedSteps-numberStep",
			description: "wait {seconds: number} seconds\n\nRequires capability DescribedSteps:wait.",
			inputSchema: step.inputSchema,
		});
		expect(toolDefinition(describedAs("gwtaStep")).description).toBe("set {name} to {value}\n\nSets a value.");
		expect(toolDefinition({ ...describedAs("gwtaStep"), remoteHost: "localhost:8331" }).description, "and the host it runs at, for a step another host declares").toBe(
			"set {name} to {value}\n\nSets a value.\n\nRuns at localhost:8331.",
		);
	});
});
