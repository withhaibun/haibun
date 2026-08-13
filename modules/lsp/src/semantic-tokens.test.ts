import { describe, it, expect } from "vitest";
import { classifyDocument, type TPlacedStep, type TToken } from "./semantic-tokens.js";
import type { TStepAction, TFeatureStep } from "@haibun/core/lib/astepper.js";
import { Origin } from "@haibun/core/schema/protocol.js";

/**
 * What an editor paints, asserted against the classification itself. It used to be asserted through a mocked language
 * server: forty lines of connection stubs to reach a call that took a line and some resolved steps, and the assertions
 * that survived the trip could only say "some tokens came back".
 */
const arg = (term: string, domain: string) => ({ term, value: term, domain, origin: Origin.quoted });

const placed = (lineText: string, args: Record<string, ReturnType<typeof arg>> = {}): TPlacedStep => ({
	step: { source: { lineNumber: 1 }, in: lineText, seqPath: [0, 1], action: { stepValuesMap: args } as TStepAction } as unknown as TFeatureStep,
	startOffset: lineText.indexOf(lineText.trim()),
	length: lineText.trim().length,
});

const classify = (lineText: string, step?: TPlacedStep, opts: { prose?: boolean; resolve?: (s: string) => TStepAction | undefined } = {}): TToken[] =>
	classifyDocument({
		lines: [lineText],
		stepsByLine: step ? new Map([[1, [step]]]) : new Map(),
		prosePaintsAsComment: opts.prose ?? true,
		resolveStatement: opts.resolve,
	});

describe("classifyDocument", () => {
	it("paints a resolved step with no arguments as one call", () => {
		expect(classify("pause for 1s", placed("pause for 1s"))).toEqual([{ line: 0, char: 0, length: 12, type: "function" }]);
	});

	it("picks each argument out of the call around it", () => {
		const line = 'set x to "y"';
		expect(classify(line, placed(line, { name: arg("x", "string"), value: arg('"y"', "string") }))).toEqual([
			{ line: 0, char: 0, length: 4, type: "function" },
			{ line: 0, char: 4, length: 1, type: "parameter" },
			{ line: 0, char: 5, length: 4, type: "function" },
			{ line: 0, char: 9, length: 3, type: "parameter" },
		]);
	});

	it("paints a numeric argument as a number", () => {
		const line = "step delay of 30";
		const tokens = classify(line, placed(line, { ms: arg("30", "number") }));
		expect(tokens.at(-1)).toEqual({ line: 0, char: 14, length: 2, type: "number" });
	});

	it("paints a statement argument as the step it names, so a nested call reads as a call", () => {
		const line = "set total from count things";
		const nested = { stepValuesMap: { what: arg("things", "string") } } as TStepAction;
		const tokens = classify(line, placed(line, { statement: arg("count things", "statement") }), { resolve: () => nested });
		expect(tokens).toEqual([
			{ line: 0, char: 0, length: 15, type: "function" },
			{ line: 0, char: 15, length: 6, type: "function" },
			{ line: 0, char: 21, length: 6, type: "parameter" },
		]);
	});

	it("paints an unresolvable statement argument as a plain argument", () => {
		const line = "set total from mystery";
		const tokens = classify(line, placed(line, { statement: arg("mystery", "statement") }), { resolve: () => undefined });
		expect(tokens.at(-1)).toEqual({ line: 0, char: 15, length: 7, type: "parameter" });
	});

	it("paints an unresolved capitalized line in a feature as prose", () => {
		expect(classify("This describes what the feature is for.")).toEqual([{ line: 0, char: 0, length: 39, type: "comment" }]);
	});

	it("paints nothing for an unresolved lowercase line, which the diagnostics report as an error", () => {
		expect(classify("invalid step")).toEqual([]);
	});

	it("paints nothing for an unresolved line outside a feature, where prose is code", () => {
		expect(classify('import { withAction } from "@haibun/core";', undefined, { prose: false })).toEqual([]);
	});

	it("paints nothing for a blank line", () => {
		expect(classify("   ")).toEqual([]);
	});

	it("keeps a line's steps in the order they were written", () => {
		const line = "first second";
		const tokens = classifyDocument({
			lines: [line],
			stepsByLine: new Map([
				[
					1,
					[
						{ step: { source: { lineNumber: 1 }, action: {} as TStepAction } as unknown as TFeatureStep, startOffset: 6, length: 6 },
						{ step: { source: { lineNumber: 1 }, action: {} as TStepAction } as unknown as TFeatureStep, startOffset: 0, length: 5 },
					],
				],
			]),
			prosePaintsAsComment: true,
		});
		expect(tokens.map((t) => t.char)).toEqual([0, 6]);
	});
});
