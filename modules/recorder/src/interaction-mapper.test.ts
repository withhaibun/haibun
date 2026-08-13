import { describe, it, expect } from "vitest";
import { interactionToStep } from "./interaction-mapper.js";
import { TInteraction } from "./types.js";

/**
 * A recorded interaction becomes the step a person would have written. The name an element is called by is whichever
 * of aria-label, text or placeholder it offers; what it is CALLED (button, link, field) comes from its tag.
 */
describe("interactionToStep", () => {
	it.each<[string, TInteraction, string]>([
		["a button by its aria-label", { type: "click", tagName: "BUTTON", ariaLabel: "Submit form" }, 'click the "Submit form" button'],
		["a button by its text", { type: "click", tagName: "BUTTON", text: "Login", role: "button" }, 'click the "Login" button'],
		["a link by its text", { type: "click", tagName: "A", text: "Learn more", href: "/about" }, 'click the "Learn more" link'],
		["anything else is an element", { type: "click", tagName: "DIV", ariaLabel: "Menu item" }, 'click the "Menu item" element'],
		["a field by its label", { type: "input", value: "test@example.com", label: "Email address" }, 'type "test@example.com" in the "Email address" field'],
		["a field by its placeholder", { type: "input", value: "search query", placeholder: "Search..." }, 'type "search query" in the "Search..." field'],
		["a field by its aria-label", { type: "input", value: "password123", ariaLabel: "Password" }, 'type "password123" in the "Password" field'],
		["a navigation by its address", { type: "navigation", url: "https://example.com/dashboard" }, 'go to "https://example.com/dashboard"'],
		["a keypress by its key", { type: "keypress", key: "Enter" }, 'press the "Enter" key'],
	])("names %s", (_, interaction, step) => {
		expect(interactionToStep(interaction)).toBe(step);
	});

	// An element offering no name cannot be written as a step, so the recording says so rather than emitting a step
	// that would match the wrong element.
	it("says so when an element offers no name", () => {
		expect(interactionToStep({ type: "click", tagName: "DIV" })).toContain("# Could not identify");
	});
});
