/** A step as the editor completes it: its pattern, inserted as a snippet whose placeholders are tab stops. */
import { CompletionItemKind, InsertTextFormat, type CompletionItem } from "vscode-languageserver/node.js";
import type { TStepDescriptor } from "@haibun/core/lib/step-discovery.js";

/** Converts a step's pattern to a snippet. Each placeholder becomes a numbered tab stop: `{name}` and `{name: number}` become `${1:name}`. */
export function patternToSnippet(pattern: string): string {
	let stop = 0;
	return pattern.replace(/\{(\w+)(?::\s*\w+)?\}/g, (_, name) => `\${${++stop}:${name}}`);
}

/**
 * A step as a completion item. The label is the step's pattern and the insert text is the pattern as a snippet. The detail
 * names the step's stepper, and the documentation names the step.
 */
export function completionItem(step: TStepDescriptor): CompletionItem {
	return {
		label: step.pattern,
		kind: CompletionItemKind.Snippet,
		insertText: patternToSnippet(step.pattern),
		insertTextFormat: InsertTextFormat.Snippet,
		detail: `From ${step.stepperName}`,
		documentation: `Internal Name: ${step.stepName}`,
	};
}
