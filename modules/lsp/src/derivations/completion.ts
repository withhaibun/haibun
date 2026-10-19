/** A step as the editor completes it: its pattern, or the head of each waypoint rule it holds, inserted as a snippet whose placeholders are tab stops. */
import { CompletionItemKind, InsertTextFormat, type CompletionItem } from "vscode-languageserver/node.js";
import { ruleStatedAt, type TStepperStep } from "@haibun/core/lib/astepper.js";
import type { TStepDescriptor } from "@haibun/core/lib/step-discovery.js";

/** Converts a step's pattern to a snippet. Each placeholder becomes a numbered tab stop: `{name}` and `{name: number}` become `${1:name}`. */
export function patternToSnippet(pattern: string): string {
	let stop = 0;
	return pattern.replace(/\{(\w+)(?::\s*\w+)?\}/g, (_, name) => `\${${++stop}:${name}}`);
}

/** A phrase as a completion item. The label is the phrase and the insert text is the phrase as a snippet. The detail names the step's stepper. */
function completionItem(phrase: string, { stepperName }: TStepDescriptor, documentation: string): CompletionItem {
	return {
		label: phrase,
		kind: CompletionItemKind.Snippet,
		insertText: patternToSnippet(phrase),
		insertTextFormat: InsertTextFormat.Snippet,
		detail: `From ${stepperName}`,
		documentation,
	};
}

/**
 * The completion items of a step. A step that holds rules completes as the head of each rule, read from the rules the resolver
 * unifies a line with, and its documentation names where the waypoint is stated. Any other step completes as its pattern, and
 * its documentation names the step.
 */
export function completionItems(descriptor: TStepDescriptor, stepDef: TStepperStep | undefined): CompletionItem[] {
	if (stepDef?.rules === undefined) return [completionItem(descriptor.pattern, descriptor, `Internal Name: ${descriptor.stepName}`)];
	return stepDef.rules().map((rule) => completionItem(rule.head, descriptor, `Waypoint stated at ${ruleStatedAt(rule)}`));
}
