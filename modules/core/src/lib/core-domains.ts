import { z } from "zod";
import { AStepper, TFeatureStep } from "./astepper.js";
import { TDomainDefinition } from "./resources.js";
import type { TWorld } from "./world.js";
import { TStepValue } from "../schema/protocol.js";
import {
	DOMAIN_AFFORDANCES,
	DOMAIN_DATE,
	DOMAIN_DOMAIN_KEY,
	DOMAIN_GOAL_RESOLUTION,
	DOMAIN_JSON,
	DOMAIN_LINK,
	DOMAIN_NUMBER,
	DOMAIN_STATEMENT,
	DOMAIN_STRING,
	DOMAIN_TEST_SCRATCH,
	mapDefinitionsToDomains,
} from "./domains.js";
import { findFeatureStepsFromStatement } from "../phases/Resolver.js";

const numberSchema = z.coerce.number({ error: "invalid number" }).refine((value) => Number.isFinite(value), "invalid number");
const stringSchema = z.coerce.string({ error: "value is required" });
const jsonStringSchema = z.string({ error: "json value is required" });
const statementSchema = z.string({ error: "statement label is required" }).min(1, "statement cannot be empty");
const dateSchema = z.coerce.date({ error: "invalid date" });

const getCoreDomainDefinitions = (world: TWorld): TDomainDefinition[] => [
	{
		selectors: [DOMAIN_STRING],
		schema: stringSchema,
		description: "Plain string literal captured from feature text.",
	},
	{
		selectors: [DOMAIN_LINK],
		schema: stringSchema,
		description: "URI string representing a navigable link.",
	},
	{
		selectors: [DOMAIN_NUMBER],
		schema: numberSchema,
		description: "Numeric literal coerced with Number().",
		comparator: (value, baseline) => (value as number) - (baseline as number),
	},
	{
		selectors: [DOMAIN_DATE],
		schema: dateSchema,
		description: "Date object derived from ISO timestamp, epoch ms, or Date literal.",
		comparator: (value, baseline) => (value as Date).getTime() - (baseline as Date).getTime(),
	},
	{
		selectors: [DOMAIN_JSON],
		schema: jsonStringSchema,
		description: "JSON string parsed into native JavaScript values.",
		coerce: (proto: TStepValue) => {
			const raw = jsonStringSchema.parse(proto.value);
			try {
				return JSON.parse(raw);
			} catch {
				throw new Error(`invalid json '${raw}'`);
			}
		},
	},
	{
		selectors: [DOMAIN_TEST_SCRATCH],
		schema: z.unknown(),
		description: "Permissive test-only domain for steps that have not yet been migrated to a typed output domain.",
	},
	{
		selectors: [DOMAIN_DOMAIN_KEY],
		schema: z.string().min(1, "domain key cannot be empty"),
		description: "A registered domain identifier — referenced by goal-resolution and meta-introspection steps.",
	},
	{
		selectors: [DOMAIN_GOAL_RESOLUTION],
		schema: z.discriminatedUnion("finding", [
			z.object({ finding: z.literal("satisfied"), goal: z.string(), factIdentity: z.string() }),
			z.object({
				finding: z.literal("plan"),
				goal: z.string(),
				steps: z.array(z.object({ stepperName: z.string(), stepName: z.string(), gwta: z.string().optional() })),
				assumes: z.array(z.object({ domain: z.string(), identity: z.string() })),
			}),
			z.object({ finding: z.literal("unreachable"), goal: z.string(), missing: z.array(z.string()) }),
			z.object({
				finding: z.literal("refused"),
				goal: z.string(),
				refusalReason: z.enum(["anonymous-outputs-present", "capability-context-required"]),
				detail: z.string(),
			}),
		]),
		description: "The four findings of the goal resolver: satisfied, plan, unreachable, refused.",
	},
	{
		selectors: [DOMAIN_AFFORDANCES],
		schema: z.object({
			forward: z.array(
				z.object({
					method: z.string(),
					stepperName: z.string(),
					stepName: z.string(),
					gwta: z.string().optional(),
					inputDomains: z.array(z.string()),
					outputDomains: z.array(z.string()),
					readyToRun: z.boolean(),
					capability: z.string().optional(),
				}),
			),
			goals: z.array(z.object({ domain: z.string(), resolution: z.unknown() })),
		}),
		description: "What can I do next: forward-reachable steps and goal-resolution verdicts.",
	},
	{
		selectors: [DOMAIN_STATEMENT],
		schema: statementSchema,
		description: "Reference to another Haibun statement.",
		coerce: (proto: TStepValue, featureStep: TFeatureStep, steppers: AStepper[]) => {
			if (!featureStep || !steppers) {
				throw new Error("statement domain coercion requires feature context");
			}
			const label = statementSchema.parse(proto.value);
			const seqStart = featureStep.seqPath;
			return findFeatureStepsFromStatement(label, steppers, world, featureStep.source.path, [...seqStart, 0], -1);
		},
	},
];

// Core domain registry factory. Returns coercion functions for built-in domains.
export const getCoreDomains = (world: TWorld) => mapDefinitionsToDomains(getCoreDomainDefinitions(world));
