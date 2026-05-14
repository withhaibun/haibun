import { z } from "zod";
import { AStepper, TFeatureStep } from "./astepper.js";
import { TDomainDefinition } from "./resources.js";
import type { TWorld } from "./world.js";
import { TStepValue } from "../schema/protocol.js";
import {
	DOMAIN_AFFORDANCES,
	DOMAIN_CHAIN_LINT,
	DOMAIN_DATE,
	DOMAIN_GOAL_RESOLUTION,
	DOMAIN_MICHI,
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

/**
 * Per-field binding inside a composite binding. Mirrors `TFieldBinding` in
 * `goal-resolver.ts`. Recursive: a field that ranges over another composite
 * domain emits a nested `kind: "composite"` field-binding. Defined as a
 * lazy function so the discriminated union can reference itself.
 */
function fieldBindingSchema(): z.ZodType {
	return z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("fact"), fieldName: z.string(), fieldDomain: z.string(), fieldType: z.string(), optional: z.boolean(), factId: z.string() }).strict(),
		z.object({ kind: z.literal("argument"), fieldName: z.string(), fieldDomain: z.string(), fieldType: z.string(), optional: z.boolean() }).strict(),
		z.object({ kind: z.literal("composite"), fieldName: z.string(), fieldDomain: z.string(), fieldType: z.string(), optional: z.boolean(), fields: z.array(z.lazy(fieldBindingSchema)) }).strict(),
	]);
}

/**
 * One resolved michi (path) shape used by both `DOMAIN_MICHI` and the
 * `michi` array inside `DOMAIN_GOAL_RESOLUTION`. The composite binding
 * variant lets a single input domain decompose into per-field sub-bindings
 * (haibun's sh:node / rdfs:range channel via `topology.ranges`).
 */
function michiSchema(): z.ZodType {
	return z
		.object({
			steps: z.array(z.object({ stepperName: z.string(), stepName: z.string(), gwta: z.string().optional(), productsDomain: z.string() }).strict()),
			bindings: z.array(
				z.discriminatedUnion("kind", [
					z.object({ kind: z.literal("fact"), domain: z.string(), factId: z.string() }).strict(),
					z.object({ kind: z.literal("argument"), domain: z.string() }).strict(),
					z.object({ kind: z.literal("composite"), domain: z.string(), fields: z.array(fieldBindingSchema()) }).strict(),
				]),
			),
		})
		.strict();
}

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
	// DOMAIN_DOMAIN_KEY is registered dynamically in Executor.addStepperConcerns
	// after all other domains are collected, so its enum reflects the live registry.
	{
		selectors: [DOMAIN_MICHI],
		schema: michiSchema(),
		description: "One concrete path the resolver found from working memory to a goal: ordered steps plus per-input bindings.",
	},
	{
		selectors: [DOMAIN_GOAL_RESOLUTION],
		schema: z.discriminatedUnion("finding", [
			z.object({
				finding: z.literal("satisfied"),
				goal: z.string(),
				factIds: z.array(z.string()),
				// Producer paths the user can run to create another instance.
				michi: z.array(michiSchema()),
				truncated: z.boolean(),
			}),
			z.object({
				finding: z.literal("michi"),
				goal: z.string(),
				michi: z.array(michiSchema()),
				truncated: z.boolean(),
			}),
			z.object({ finding: z.literal("unreachable"), goal: z.string(), missing: z.array(z.string()) }),
			z.object({
				finding: z.literal("refused"),
				goal: z.string(),
				refusalReason: z.enum(["anonymous-outputs-present", "capability-context-required"]),
				detail: z.string(),
			}),
		]),
		description: "The four findings of the goal resolver: satisfied (existing facts + paths to produce more), michi (enumerated paths), unreachable, refused.",
	},
	{
		selectors: [DOMAIN_AFFORDANCES],
		// Strict: unknown keys throw at parse time, surfacing schema/producer drift
		// instead of silently dropping data on the way to the SPA.
		schema: z
			.object({
				forward: z.array(
					z
						.object({
							method: z.string(),
							stepperName: z.string(),
							stepName: z.string(),
							gwta: z.string().optional(),
							inputDomains: z.array(z.string()),
							outputDomains: z.array(z.string()),
							readyToRun: z.boolean(),
							capability: z.string().optional(),
						})
						.strict(),
				),
				goals: z.array(z.object({ domain: z.string(), description: z.string(), resolution: z.unknown() }).strict()),
				satisfiedDomains: z.array(z.string()).default([]),
				satisfiedFacts: z.record(z.string(), z.array(z.string())).default({}),
				// Per-domain composite-field map (haibun's sh:node / rdfs:range equivalent).
				// Carries the registered `topology.ranges` declarations so the SPA's
				// chain view can emit synthetic field nodes between composite domains
				// and their component domains. Optional — absent when no domain
				// declares any ranges.
				composites: z.record(z.string(), z.record(z.string(), z.string())).optional(),
				// Registered waypoints projected as panel entries. Populated by
				// `show waypoints`; `show affordances` leaves this empty. Each entry
				// is a virtual step registered by ActivitiesStepper with a `gwta`
				// pattern the SPA's step-caller renders into a parameter form.
				waypoints: z
					.array(
						z
							.object({
								outcome: z.string(),
								kind: z.enum(["imperative", "declarative"]),
								method: z.string(),
								paramSlots: z.array(z.string()),
								proofStatements: z.array(z.string()),
								resolvesDomain: z.string().optional(),
								ensured: z.boolean(),
								error: z.string().optional(),
								source: z.object({ path: z.string(), lineNumber: z.number().optional() }).strict(),
								isBackground: z.boolean(),
							})
							.strict(),
					)
					.optional(),
			})
			.strict(),
		description: "What can I do next: forward-reachable steps and goal-resolution verdicts.",
		ui: { component: "shu-affordances-panel" },
	},
	{
		selectors: [DOMAIN_CHAIN_LINT],
		schema: z
			.object({
				findings: z.array(z.unknown()),
				summary: z
					.object({
						"orphan-step": z.number(),
						"starved-step": z.number(),
						"unreachable-domain": z.number(),
						"unproduced-domain": z.number(),
					})
					.strict(),
				// Optional graph payload the bound view (`shu-domain-chain-view`) renders as
				// a Mermaid chain. The view falls back to subscribing to `shu:affordances`
				// when the producer step omits these fields.
				forward: z.array(z.unknown()).optional(),
				goals: z.array(z.unknown()).optional(),
				composites: z.record(z.string(), z.record(z.string(), z.string())).optional(),
			})
			.strict(),
		description: "Domain-chain lint report: orphans, starved steps, unreachable domains.",
		ui: { component: "shu-domain-chain-view" },
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
