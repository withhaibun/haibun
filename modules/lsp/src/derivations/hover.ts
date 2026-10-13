/** What a hover over a placed step shows: its stepper, its pattern and its arguments. */
import type { Hover } from "vscode-languageserver/node.js";
import type { TStepperStep } from "@haibun/core/lib/astepper.js";
import type { TPlacedStep } from "../domains/lsp.js";

/** The pattern a step is written by: its words, its exact text, or its expression. */
function patternOf({ gwta, exact, match }: TStepperStep): string {
	if (gwta !== undefined) return gwta;
	if (exact !== undefined) return exact;
	if (match !== undefined) return match.source;
	throw new Error("a step is written by its words, its exact text or its expression, and this step lacks all three");
}

/** The first step placed at a line (numbered from zero) and a character: one with a column range holds the character within it, and one without spans its line. */
export function stepAt(placed: readonly TPlacedStep[], line: number, character: number): TPlacedStep | undefined {
	return placed.find(({ step, startOffset, length }) => {
		if (step.source?.lineNumber !== line + 1) return false;
		return startOffset === undefined || length === undefined || (character >= startOffset && character <= startOffset + length);
	});
}

/** A hover's markdown for a placed step: its stepper, its pattern, and each argument's term. */
export function hoverOf({ step }: TPlacedStep): Hover {
	const { stepperName, stepValuesMap } = step.action;
	const values = stepValuesMap === undefined ? [] : Object.entries(stepValuesMap);
	const parameters = values.length === 0 ? "None" : values.map(([name, value]) => `- **${name}**: \`${value.term}\``).join("\n");
	return { contents: { kind: "markdown", value: `### ${stepperName}\n\`${patternOf(step.action.step)}\`\n\n**Parameters:**\n${parameters}` } };
}
