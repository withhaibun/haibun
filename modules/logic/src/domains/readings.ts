/**
 * What a reading reads from its step beside the steps of its statements: a quantifier's variable and range, a disjunction's
 * alternatives, and the parameters that state statements, in the order the step's phrase names them.
 */
import { z } from "zod";
import { ClaimWitnessSchema } from "@haibun/core/lib/records/domains/axioms.js";
import { DOMAIN_STATEMENT } from "@haibun/core/lib/domains/domains.js";
import type { TDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import type { TStepperStep } from "@haibun/core/lib/steps/domains/stepper.js";
import { stepParts } from "@haibun/core/lib/steps/domains/phrase.js";
import { VERDICT, type TStepArgs } from "@haibun/core/lib/domains/protocol.js";

/** How long until waits before it proves its statements again. */
export const UNTIL_RETRY_MS = 200;

/** The comma-separated statements of a disjunction, and the name of an observation source a quantifier ranges over. */
export const DOMAIN_ALTERNATIVES = "statement-alternatives";
export const DOMAIN_OBSERVATION_SOURCE = "observation-source";
/** The verdict a statement's proof ended with, which maybe returns. */
export const DOMAIN_STATUS = "status";
/** Why the statement `not` holds over didn't hold, which `not` returns: its failing step's error text and seqPath. */
export const DOMAIN_REFUSAL = "refusal";

/** Why a statement didn't hold: its failing step's error text, that step's seqPath, the action a refused call lacked, and a
 *  refused claim's witness. */
const RefusalSchema = z.object({
	refusal: z.string(),
	seqPath: z.string(),
	lacksAction: z.string().optional().describe("The action the refused call lacked, where the gate refused it for an action its caller doesn't hold"),
	witness: ClaimWitnessSchema.optional().describe("The subsumption a refused claim names and the records that exceed it, where a claim of subsumption didn't hold"),
});
export type TRefusal = z.infer<typeof RefusalSchema>;

export const readingDomainDefinitions: TDomainDefinition[] = [
	{ selectors: [DOMAIN_ALTERNATIVES], schema: z.string().min(1), written: true, description: "The comma-separated statements of a disjunction" },
	{
		selectors: [DOMAIN_OBSERVATION_SOURCE],
		schema: z.string().min(1),
		written: true,
		description: "The name of an observation source a stepper declares, which a quantifier ranges over",
	},
	{
		selectors: [DOMAIN_STATUS],
		schema: z.object({ verdict: z.enum(VERDICT), ...RefusalSchema.partial().shape }),
		description: "The verdict of a statement's proof: proved, refuted, unknown or contradiction, with why the statement didn't hold where it didn't",
	},
	{
		selectors: [DOMAIN_REFUSAL],
		schema: RefusalSchema,
		description:
			"Why a statement didn't hold: its failing step's error text, that step's seqPath, and, where the gate refused the call, the action it lacked, which a claim reads in place of the text",
	},
];

/** A quantifier's variable and its range: a domain's members, or the items an observation source returns. */
export type TQuantifier = { what: string } & ({ domain: string } | { source: string });

/** Reads a quantifier's variable and range from its arguments. */
export function quantifierOf(args: TStepArgs): TQuantifier {
	const what = String(args.what);
	return typeof args.source === "string" ? { what, source: args.source } : { what, domain: String(args.domain) };
}

/** The delimiters a statement list reads past a comma within: a quoted or backticked term, and a JSON value. */
const PAIRED: Readonly<Record<string, string>> = { '"': '"', "`": "`", "{": "}", "[": "]" };

/** Reads a list of statements: the statements its commas separate. A comma inside a quoted or backticked term or a JSON
 *  value doesn't separate statements. */
export function statementList(text: string): string[] {
	const statements: string[] = [];
	const open: string[] = [];
	let start = 0;
	for (let at = 0; at < text.length; at++) {
		const char = text.charAt(at);
		const closing = open.at(-1);
		if (closing === '"' || closing === "`") {
			if (char === closing) open.pop();
		} else if (char === closing) open.pop();
		else if (PAIRED[char] !== undefined) open.push(PAIRED[char]);
		else if (char === "," && open.length === 0) {
			statements.push(text.slice(start, at).trim());
			start = at + 1;
		}
	}
	return [...statements, text.slice(start).trim()];
}

/** The parameters of a step whose domain is a statement, in the order its phrase names them. */
export const statementParams = (step: TStepperStep): string[] => stepParts(step).flatMap(({ name, domain }) => (domain === DOMAIN_STATEMENT ? [name] : []));
