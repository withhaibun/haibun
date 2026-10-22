/** A step as the editor completes it: its pattern, or the head of each waypoint rule it holds, inserted as a snippet whose placeholders are tab stops. */
import { CompletionItemKind, InsertTextFormat, type CompletionItem } from "vscode-languageserver/node.js";
import { ruleStatedAt, type TStepperStep } from "@haibun/core/lib/astepper.js";
import { waypointMark, type TStepDescriptor } from "@haibun/core/lib/step-discovery.js";
import { renderStepLine } from "@haibun/core/lib/steps/derivations/named-vars.js";
import { phraseParts } from "@haibun/core/lib/steps/domains/phrase.js";

/** Converts a step's pattern to a snippet: its line with each part a numbered tab stop, so `{name}` and `{name: number}` become
 *  `${1:name}`. */
export const patternToSnippet = (pattern: string): string =>
	renderStepLine(pattern, Object.fromEntries(phraseParts(pattern).map(({ name }, at) => [name, `\${${at + 1}:${name}}`])));

/** A phrase as a completion item. The label is the phrase and the insert text is the phrase as a snippet. */
function completionItem(phrase: string, detail: string, documentation: string): CompletionItem {
	return { label: phrase, kind: CompletionItemKind.Snippet, insertText: patternToSnippet(phrase), insertTextFormat: InsertTextFormat.Snippet, detail, documentation };
}

/**
 * The completion items of a step. A step that holds rules completes as the head of each rule, read from the rules the resolver
 * unifies a line with, marked as a waypoint with the library that states it, as the actions bar's step input marks it, and its
 * documentation names where the waypoint is stated. Any other step completes as its pattern, its detail names its stepper and
 * its documentation names the step.
 */
export function completionItems(descriptor: TStepDescriptor, stepDef: TStepperStep | undefined): CompletionItem[] {
	if (stepDef?.rules === undefined) return [completionItem(descriptor.pattern, `From ${descriptor.stepperName}`, `Internal Name: ${descriptor.stepName}`)];
	return stepDef.rules().map((rule) => completionItem(rule.head, waypointMark(rule.library), `Waypoint stated at ${ruleStatedAt(rule)}`));
}
