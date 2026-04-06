/**
 * Maps browser interactions to idiomatic Haibun step grammar
 */

import { TInteraction, TClickInteraction, TInputInteraction } from "./types.js";

/**
 * Get the best identifier for an element, prioritizing accessibility-friendly attributes
 */
const getBestIdentifier = (interaction: TClickInteraction | TInputInteraction): string | undefined => {
	return (
		interaction.ariaLabel ||
		("label" in interaction ? interaction.label : undefined) ||
		interaction.placeholder ||
		("text" in interaction ? interaction.text?.trim().slice(0, 50) : undefined) ||
		interaction.name ||
		interaction.id
	);
};

/**
 * Convert a click interaction to a Haibun step
 */
const mapClickToStep = (interaction: TClickInteraction): string => {
	const identifier = getBestIdentifier(interaction);
	const tag = interaction.tagName.toLowerCase();

	if (!identifier) {
		return `# Could not identify element: ${tag}`;
	}

	// Link navigation
	if (tag === "a" && interaction.href) {
		return `click the "${identifier}" link`;
	}

	// Buttons
	if (tag === "button" || interaction.role === "button") {
		return `click the "${identifier}" button`;
	}

	// Input elements (checkboxes, radios)
	if (tag === "input") {
		return `click the "${identifier}" element`;
	}

	// Generic element
	return `click the "${identifier}" element`;
};

/**
 * Convert an input interaction to a Haibun step
 */
const mapInputToStep = (interaction: TInputInteraction): string => {
	const identifier = getBestIdentifier(interaction);
	const value = interaction.value;

	if (!identifier) {
		return `# Could not identify input field`;
	}

	return `type "${value}" in the "${identifier}" field`;
};

/**
 * Convert any interaction to a Haibun step
 */
export const interactionToStep = (interaction: TInteraction): string => {
	switch (interaction.type) {
		case "click":
			return mapClickToStep(interaction);

		case "input":
			return mapInputToStep(interaction);

		case "navigation":
			return `go to "${interaction.url}"`;

		case "keypress":
			return `press the "${interaction.key}" key`;

		default: {
			// Exhaustive check - TypeScript will error if we miss a case
			const _exhaustive: never = interaction;
			return `# Unknown interaction type`;
		}
	}
};
