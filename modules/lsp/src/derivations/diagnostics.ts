/** The diagnostics a document's resolution states: a line that doesn't resolve, and a background a Backgrounds: line names that isn't found. */
import type { Diagnostic, Range } from "vscode-languageserver/node.js";
import { DIAGNOSTIC_SOURCE } from "../domains/lsp.js";

/** The severities the protocol numbers, as `DiagnosticSeverity` states them. */
const SEVERITY = { error: 1 } as const;
const BACKGROUNDS_LINE = "Backgrounds:";

const diagnostic = (severity: Diagnostic["severity"], range: Range, message: string): Diagnostic => ({ severity, range, message, source: DIAGNOSTIC_SOURCE });
const wholeLine = (line: number, text: string): Range => ({ start: { line, character: 0 }, end: { line, character: text.length } });

/** A feature line that doesn't resolve, on its line (numbered from one) across its text. */
export const unresolvedLine = (lineNumber: number, text: string, message: string): Diagnostic => diagnostic(SEVERITY.error, wholeLine(lineNumber - 1, text), message);

/** A kireji string's line that doesn't resolve to one step, across its range. */
export const unresolvedString = (range: Range, text: string): Diagnostic => diagnostic(SEVERITY.error, range, `'${text}' doesn't resolve to one step.`);

/** A background a feature names that isn't found: an error across the first Backgrounds: line, or the first line of a feature without one, since the feature doesn't expand. */
export function backgroundNotFound(content: string, reason: string): Diagnostic {
	const lines = content.split("\n");
	const at = Math.max(
		0,
		lines.findIndex((line) => line.trim().startsWith(BACKGROUNDS_LINE)),
	);
	const text = lines[at];
	if (text === undefined) throw new Error(`a feature's content holds line ${at} once split, and this one doesn't`);
	return diagnostic(SEVERITY.error, wholeLine(at, text), `Background not found: ${reason}. Change the Backgrounds: line to name an existing background.`);
}
