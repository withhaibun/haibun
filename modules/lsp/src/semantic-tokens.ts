/**
 * What an editor paints a feature line as: the classification alone, with no protocol around it.
 *
 * A resolved step paints as a call with its arguments picked out, recursively where an argument is itself a statement.
 * An unresolved line in a `.feature` paints as prose when it begins with a capital, which is what a feature's prose
 * looks like; anything else paints as nothing, since an unresolved lowercase line is an error the diagnostics report
 * rather than something to colour.
 */
import type { TStepAction, TFeatureStep } from "@haibun/core/lib/astepper.js";
import type { TStepValue } from "@haibun/core/schema/protocol.js";

export const TOKEN_TYPES = ["keyword", "function", "parameter", "string", "number", "comment"] as const;
export type TTokenType = (typeof TOKEN_TYPES)[number];

/** One painted span: the line it is on, where it starts, how long it is, and what it is. */
export type TToken = { line: number; char: number; length: number; type: TTokenType };

/** A step the document cache resolved for a line, with where on the line it was written. */
export type TPlacedStep = { step: TFeatureStep; startOffset?: number; length?: number };

export type TClassifyInput = {
	/** The document's lines, in order. */
	lines: string[];
	/** Resolved steps by 1-indexed line number, as the document cache holds them. */
	stepsByLine: Map<number, TPlacedStep[]>;
	/** True for a `.feature` document, where an unresolved capitalized line is prose. A kireji document's unresolved lines are code. */
	prosePaintsAsComment: boolean;
	/** Resolve a statement-valued argument to the step it names, so a nested statement paints as a call. Returns undefined when it does not resolve. */
	resolveStatement?: (statement: string) => TStepAction | undefined;
};

/** Every token a document paints, in line order. */
export function classifyDocument({ lines, stepsByLine, prosePaintsAsComment, resolveStatement }: TClassifyInput): TToken[] {
	const tokens: TToken[] = [];
	for (let line = 0; line < lines.length; line++) {
		const text = lines[line];
		const trimmed = text.trim();
		if (!trimmed) continue;
		const placed = stepsByLine.get(line + 1); // the cache counts lines from one
		if (placed && placed.length > 0) {
			for (const p of [...placed].sort((a, b) => (a.startOffset ?? 0) - (b.startOffset ?? 0))) {
				const char = p.startOffset ?? text.indexOf(trimmed);
				const length = p.length ?? trimmed.length;
				classifyStep({ tokens, line, text, char, length, action: p.step.action, resolveStatement });
			}
		} else if (prosePaintsAsComment && /^[A-Z]/.test(trimmed)) {
			tokens.push({ line, char: text.indexOf(trimmed), length: trimmed.length, type: "comment" });
		}
	}
	return tokens;
}

/**
 * One step: the text between its arguments paints as the call, each argument as itself. A statement-valued argument
 * paints as the step it names, so a `set x from <step>` line reads as two calls rather than one call and a string.
 */
function classifyStep({
	tokens,
	line,
	text,
	char,
	length,
	action,
	resolveStatement,
}: {
	tokens: TToken[];
	line: number;
	text: string;
	char: number;
	length: number;
	action: TStepAction | undefined;
	resolveStatement?: (statement: string) => TStepAction | undefined;
}): void {
	if (!action) return;
	const end = char + length;
	const args = Object.values((action.stepValuesMap ?? {}) as Record<string, TStepValue>)
		.filter((v) => v?.term)
		.map((v) => ({ v, pos: text.indexOf(v.term, char) }))
		.filter(({ pos }) => pos >= 0 && pos < end)
		.sort((a, b) => a.pos - b.pos);

	if (args.length === 0) {
		tokens.push({ line, char, length, type: "function" });
		return;
	}
	let lastEnd = char;
	for (const { v, pos } of args) {
		if (pos > lastEnd) tokens.push({ line, char: lastEnd, length: pos - lastEnd, type: "function" });
		if (v.domain === "statement") {
			const nested = resolveStatement?.(v.term);
			if (nested) classifyStep({ tokens, line, text, char: pos, length: v.term.length, action: nested, resolveStatement });
			else tokens.push({ line, char: pos, length: v.term.length, type: "parameter" });
		} else {
			tokens.push({ line, char: pos, length: v.term.length, type: v.domain === "number" ? "number" : "parameter" });
		}
		lastEnd = pos + v.term.length;
	}
	if (lastEnd < end) tokens.push({ line, char: lastEnd, length: end - lastEnd, type: "function" });
}
