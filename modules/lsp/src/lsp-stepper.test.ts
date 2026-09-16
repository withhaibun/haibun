import { describe, it, expect } from "vitest";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { OK } from "@haibun/core/schema/protocol.js";
import { buildStepRegistry } from "@haibun/core/lib/step-registry.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { completionItem, patternToSnippet } from "./lsp-stepper.js";

class SampleStepper extends AStepper {
	description = "Steps that navigate, set variables and click, for completion tests.";
	steps = {
		navigateTo: { gwta: "navigate to {url}", action: async () => OK },
		setVariable: { gwta: "set {name} to {value}", action: async () => OK },
		waitSeconds: { gwta: "wait {seconds: number} seconds", action: async () => OK },
		clickButton: { exact: "click the submit button", action: async () => OK },
	};
}

const completions = () => [...buildStepRegistry([new SampleStepper()], getDefaultWorld()).values()].map((tool) => completionItem(tool.descriptor));

describe("LSP completion", () => {
	it("offers each step of the run by its pattern, as a snippet, with its stepper and step", () => {
		expect(completions().map((item) => item.label)).toEqual(["navigate to {url}", "set {name} to {value}", "wait {seconds: number} seconds", "click the submit button"]);
		expect(completions()[0]).toMatchObject({ insertText: "navigate to ${1:url}", insertTextFormat: 2, detail: "From SampleStepper", documentation: "Internal Name: navigateTo" });
	});

	it("numbers each placeholder as a tab-stop, drops a domain annotation, and leaves an exact pattern as it is", () => {
		expect(patternToSnippet("set {name} to {value}")).toBe("set ${1:name} to ${2:value}");
		expect(patternToSnippet("wait {seconds: number} seconds")).toBe("wait ${1:seconds} seconds");
		expect(patternToSnippet("click the submit button")).toBe("click the submit button");
	});
});
