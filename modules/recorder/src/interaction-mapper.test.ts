import { describe, it, expect } from "vitest";
import { interactionToStep } from "./interaction-mapper.js";
import { TClickInteraction, TInputInteraction, TNavigationInteraction, TKeypressInteraction } from "./types.js";

describe("interactionToStep", () => {
	describe("click interactions", () => {
		it("maps button click with aria-label", () => {
			const interaction: TClickInteraction = {
				type: "click",
				tagName: "BUTTON",
				ariaLabel: "Submit form",
			};
			expect(interactionToStep(interaction)).toBe('click the "Submit form" button');
		});

		it("maps button click with text", () => {
			const interaction: TClickInteraction = {
				type: "click",
				tagName: "BUTTON",
				text: "Login",
				role: "button",
			};
			expect(interactionToStep(interaction)).toBe('click the "Login" button');
		});

		it("maps link click", () => {
			const interaction: TClickInteraction = {
				type: "click",
				tagName: "A",
				text: "Learn more",
				href: "/about",
			};
			expect(interactionToStep(interaction)).toBe('click the "Learn more" link');
		});

		it("maps generic element click", () => {
			const interaction: TClickInteraction = {
				type: "click",
				tagName: "DIV",
				ariaLabel: "Menu item",
			};
			expect(interactionToStep(interaction)).toBe('click the "Menu item" element');
		});

		it("returns comment for unidentifiable element", () => {
			const interaction: TClickInteraction = {
				type: "click",
				tagName: "DIV",
			};
			expect(interactionToStep(interaction)).toContain("# Could not identify");
		});
	});

	describe("input interactions", () => {
		it("maps input with label", () => {
			const interaction: TInputInteraction = {
				type: "input",
				value: "test@example.com",
				label: "Email address",
			};
			expect(interactionToStep(interaction)).toBe('type "test@example.com" in the "Email address" field');
		});

		it("maps input with placeholder", () => {
			const interaction: TInputInteraction = {
				type: "input",
				value: "search query",
				placeholder: "Search...",
			};
			expect(interactionToStep(interaction)).toBe('type "search query" in the "Search..." field');
		});

		it("maps input with aria-label", () => {
			const interaction: TInputInteraction = {
				type: "input",
				value: "password123",
				ariaLabel: "Password",
			};
			expect(interactionToStep(interaction)).toBe('type "password123" in the "Password" field');
		});
	});

	describe("navigation interactions", () => {
		it("maps navigation", () => {
			const interaction: TNavigationInteraction = {
				type: "navigation",
				url: "https://example.com/dashboard",
			};
			expect(interactionToStep(interaction)).toBe('go to "https://example.com/dashboard"');
		});
	});

	describe("keypress interactions", () => {
		it("maps keypress", () => {
			const interaction: TKeypressInteraction = {
				type: "keypress",
				key: "Enter",
			};
			expect(interactionToStep(interaction)).toBe('press the "Enter" key');
		});
	});
});
