/**
 * What a reading reads from its step beside the steps of its statements: a quantifier's variable and range, a disjunction's
 * alternatives, and the parameters that state statements, in the order the step's phrase names them.
 */
import { z } from "zod";
import { DOMAIN_STATEMENT } from "@haibun/core/lib/domains/domains.js";
import type { TDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import type { TStepperStep } from "@haibun/core/lib/steps/domains/stepper.js";
import { stepParts } from "@haibun/core/lib/steps/domains/phrase.js";
import type { TStepArgs } from "@haibun/core/lib/domains/protocol.js";

/** How long until waits before it proves its statements again. */
export const UNTIL_RETRY_MS = 200;

/** The comma-separated statements of a disjunction, and the name of an observation source a quantifier ranges over. */
export const DOMAIN_ALTERNATIVES = "statement-alternatives";
export const DOMAIN_OBSERVATION_SOURCE = "observation-source";

export const readingDomainDefinitions: TDomainDefinition[] = [
	{ selectors: [DOMAIN_ALTERNATIVES], schema: z.string().min(1), written: true, description: "The comma-separated statements of a disjunction" },
	{
		selectors: [DOMAIN_OBSERVATION_SOURCE],
		schema: z.string().min(1),
		written: true,
		description: "The name of an observation source a stepper declares, which a quantifier ranges over",
	},
];

/** A quantifier's variable and its range: a domain's members, or the items an observation source returns. */
export type TQuantifier = { what: string } & ({ domain: string } | { source: string });

/** Reads a quantifier's variable and range from its arguments. */
export function quantifierOf(args: TStepArgs): TQuantifier {
	const what = String(args.what);
	return typeof args.source === "string" ? { what, source: args.source } : { what, domain: String(args.domain) };
}

/** Reads a disjunction's alternatives: its comma-separated statements. */
export const alternativesOf = (text: string): string[] => text.split(",").map((one) => one.trim());

/** The parameters of a step whose domain is a statement, in the order its phrase names them. */
export const statementParams = (step: TStepperStep): string[] => stepParts(step).flatMap(({ name, domain }) => (domain === DOMAIN_STATEMENT ? [name] : []));
