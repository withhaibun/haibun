import { describe, it, expect } from "vitest";
import { AStepper, READING, type TWaypointRule } from "@haibun/core/lib/astepper.js";
import { OK } from "@haibun/core/lib/domains/protocol.js";
import { buildStepRegistry } from "@haibun/core/lib/step-registry.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { completionItems, patternToSnippet } from "./completion.js";

class SampleStepper extends AStepper {
	description = "Steps that navigate, set variables and click, for completion tests.";
	steps = {
		navigateTo: { gwta: "navigate to {url}", action: async () => OK },
		setVariable: { gwta: "set {name} to {value}", action: async () => OK },
		waitSeconds: { gwta: "wait {seconds: number} seconds", action: async () => OK },
		clickButton: { exact: "click the submit button", action: async () => OK },
	};
}

class RuleStepper extends AStepper {
	description = "A step that holds the rules it is given, for completion tests.";
	constructor(private readonly held: TWaypointRule[]) {
		super();
	}
	steps = { apply: { rules: () => this.held, reading: READING.apply } };
}

const completions = () => [...buildStepRegistry([new SampleStepper()], getDefaultWorld()).values()].flatMap((tool) => completionItems(tool.descriptor, tool.stepDef));

describe("LSP completion", () => {
	it("offers each step of actuality by its pattern, as a snippet, with its stepper and step", () => {
		expect(completions().map((item) => item.label)).toEqual(["navigate to {url}", "set {name} to {value}", "wait {seconds: number} seconds", "click the submit button"]);
		expect(completions()[0]).toMatchObject({ insertText: "navigate to ${1:url}", insertTextFormat: 2, detail: "From SampleStepper", documentation: "Internal Name: navigateTo" });
	});

	it("offers a step that holds rules as the head of each rule, with where the waypoint is stated", () => {
		const rule = { head: "{m:meal} is ready", pattern: "{m: waypoint-argument} is ready", proof: [], activity: [], source: { path: "/b/meals.feature", lineNumber: 3 } };
		const tool = itemAt([...buildStepRegistry([new RuleStepper([rule])], getDefaultWorld()).values()], 0);
		expect(completionItems(tool.descriptor, tool.stepDef)).toEqual([
			{
				label: "{m:meal} is ready",
				kind: 15,
				insertText: "${1:m} is ready",
				insertTextFormat: 2,
				detail: "From RuleStepper",
				documentation: "Waypoint stated at /b/meals.feature:3",
			},
		]);
	});

	it("numbers each placeholder as a tab-stop, drops a domain annotation, and leaves an exact pattern as it is", () => {
		expect(patternToSnippet("set {name} to {value}")).toBe("set ${1:name} to ${2:value}");
		expect(patternToSnippet("wait {seconds: number} seconds")).toBe("wait ${1:seconds} seconds");
		expect(patternToSnippet("click the submit button")).toBe("click the submit button");
		expect(patternToSnippet("set( empty)? {what: variable-name} to {value: variable-value}"), "a hyphenated domain and an optional word").toBe("set ${1:what} to ${2:value}");
	});
});
