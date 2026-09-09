import { z } from "zod";
import { DOMAIN_GRAPH_QUERY, GraphQuerySchema, DOMAIN_DENSITY_QUERY, DensityQuerySchema } from "./quad-types.js";
import { objectCoercer } from "./domains.js";
import { AStepper, TFeatureStep } from "./astepper.js";
import { TDomainDefinition } from "./resources.js";
import type { TWorld } from "./world.js";
import { TStepValue } from "../schema/protocol.js";
import {
	DOMAIN_AFFORDANCES,
	DOMAIN_CHAIN_LINT,
	DOMAIN_CHAIN_WALK,
	DOMAIN_DATE,
	DOMAIN_GOAL_RESOLUTION,
	DOMAIN_MICHI,
	DOMAIN_JSON,
	DOMAIN_LINK,
	DOMAIN_NUMBER,
	DOMAIN_STATEMENT,
	DOMAIN_STRING,
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
 * domain emits a nested `kind: "composite"` field-binding, reached through a
 * lazy reference so the union can name itself.
 *
 * One value, built once. Built per caller instead, every run registered a
 * schema of its own, and converting one to JSON Schema walks the recursion,
 * so the answer could never be held: one measurement put that walk at most of
 * a second per run of a feature.
 */
const fieldBindingSchema: z.ZodType = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("fact"), fieldName: z.string(), fieldDomain: z.string(), fieldType: z.string(), optional: z.boolean(), factId: z.string() }).strict(),
	z.object({ kind: z.literal("argument"), fieldName: z.string(), fieldDomain: z.string(), fieldType: z.string(), optional: z.boolean() }).strict(),
	z
		.object({
			kind: z.literal("composite"),
			fieldName: z.string(),
			fieldDomain: z.string(),
			fieldType: z.string(),
			optional: z.boolean(),
			fields: z.array(z.lazy(() => fieldBindingSchema)),
		})
		.strict(),
]);

/**
 * One resolved michi (path) shape used by both `DOMAIN_MICHI` and the
 * `michi` array inside `DOMAIN_GOAL_RESOLUTION`. The composite binding
 * variant lets a single input domain decompose into per-field sub-bindings
 * (haibun's sh:node / rdfs:range channel via `topology.ranges`).
 */
const michiSchema: z.ZodType = z
	.object({
		steps: z.array(z.object({ stepperName: z.string(), stepName: z.string(), gwta: z.string().optional(), productsDomain: z.string() }).strict()),
		bindings: z.array(
			z.discriminatedUnion("kind", [
				z.object({ kind: z.literal("fact"), domain: z.string(), factId: z.string() }).strict(),
				z.object({ kind: z.literal("argument"), domain: z.string() }).strict(),
				z.object({ kind: z.literal("composite"), domain: z.string(), fields: z.array(fieldBindingSchema) }).strict(),
			]),
		),
	})
	.strict();

/** DOMAIN_GOAL_RESOLUTION product shape — the resolver's four findings. Exported so GoalResolutionStepper validates its products against the same schema the domain registers. */
export const goalResolutionSchema = z.discriminatedUnion("finding", [
	z.object({ finding: z.literal("satisfied"), goal: z.string(), factIds: z.array(z.string()), michi: z.array(michiSchema), truncated: z.boolean() }),
	z.object({ finding: z.literal("michi"), goal: z.string(), michi: z.array(michiSchema), truncated: z.boolean() }),
	z.object({ finding: z.literal("unreachable"), goal: z.string(), missing: z.array(z.string()) }),
	z.object({ finding: z.literal("refused"), goal: z.string(), refusalReason: z.enum(["anonymous-outputs-present", "capability-context-required"]), detail: z.string() }),
]);

/**
 * DOMAIN_CHAIN_WALK product shape: a walk toward a goal, as a reader is shown it. A walk is a resolved path held open
 * one step at a time, so what it reports is where it has got to, what the next step is, and what that step still needs
 * from whoever is walking it.
 */
export const chainWalkSchema = z
	.object({
		walk: z.string(),
		goal: z.string(),
		status: z.string(),
		stepIndex: z.number().int().nonnegative(),
		/** Every step of the path, named as it is dispatched. */
		steps: z.array(z.string()),
		/** The step the next advance runs; absent once the walk is done. */
		next: z.string().optional(),
		/** What the next step takes, named as it declares them: what an advance must supply for the walk to go on. */
		needs: z.array(z.string()),
		/** What each step that has run asserted. */
		factIds: z.array(z.string()),
		error: z.string().optional(),
	})
	.strict();

/** DOMAIN_AFFORDANCES product shape — forward-reachable steps and goal-resolution verdicts. Strict: unknown keys throw, surfacing producer drift instead of silently dropping data on the way to the SPA. */
export const affordancesSchema = z
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
		// Per-domain composite-field map (haibun's sh:node / rdfs:range equivalent) — the registered topology.ranges, so the SPA's chain view can emit synthetic field nodes between composite domains and their components. Absent when no domain declares ranges.
		composites: z.record(z.string(), z.record(z.string(), z.string())).optional(),
		// Registered waypoints projected as panel entries — contributed to `show affordances` by every stepper with the ProvidesWaypoints capability (e.g. ActivitiesStepper). Each is a virtual step registered with a gwta the SPA's step-caller renders into a parameter form.
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
	.strict();

/** DOMAIN_CHAIN_LINT product shape — orphan/starved/unreachable findings plus an optional affordance overlay (forward/goals) the bound Mermaid view renders. */
export const chainLintSchema = z
	.object({
		findings: z.array(z.unknown()),
		summary: z.object({ "orphan-step": z.number(), "starved-step": z.number(), "unreachable-domain": z.number(), "unproduced-domain": z.number() }).strict(),
		// Optional graph payload the bound view (shu-domain-chain-view) renders as a Mermaid chain; the view falls back to subscribing to shu:affordances when the producer omits these.
		forward: z.array(z.unknown()).optional(),
		goals: z.array(z.unknown()).optional(),
		composites: z.record(z.string(), z.record(z.string(), z.string())).optional(),
	})
	.strict();

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
		// Declared here, beside the schema it validates with: two steppers each declared this domain from their own
		// copy of the schema, so which copy validated a query depended on which stepper registered first.
		selectors: [DOMAIN_GRAPH_QUERY],
		schema: GraphQuerySchema,
		coerce: objectCoercer(GraphQuerySchema),
		description: "A request for records of one type from the graph, with optional filters, sort order, and a result limit.",
	},
	{
		selectors: [DOMAIN_DENSITY_QUERY],
		schema: DensityQuerySchema,
		coerce: objectCoercer(DensityQuerySchema),
		description: "A request for how many records of one type fall in each division of a span of time, by how each turned out.",
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
	// DOMAIN_DOMAIN_KEY is registered dynamically in Executor.addStepperConcerns
	// after all other domains are collected, so its enum reflects the live registry.
	{
		selectors: [DOMAIN_MICHI],
		schema: michiSchema,
		description: "One concrete path the resolver found from working memory to a goal: ordered steps plus per-input bindings.",
	},
	{
		selectors: [DOMAIN_GOAL_RESOLUTION],
		schema: goalResolutionSchema,
		description: "The four findings of the goal resolver: satisfied (existing facts + paths to produce more), michi (enumerated paths), unreachable, refused.",
	},
	{
		selectors: [DOMAIN_AFFORDANCES],
		schema: affordancesSchema,
		description: "What can I do next: forward-reachable steps and goal-resolution verdicts.",
		ui: { component: "shu-affordances-panel" },
	},
	{
		selectors: [DOMAIN_CHAIN_WALK],
		schema: chainWalkSchema,
		description: "A walk toward a goal, held open one step at a time: where it has got to, what runs next, and what that step still needs from whoever is walking it.",
	},
	{
		selectors: [DOMAIN_CHAIN_LINT],
		schema: chainLintSchema,
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
			return findFeatureStepsFromStatement(label, steppers, world, featureStep.source?.path, [...seqStart, 0], -1);
		},
	},
];

// Core domain registry factory. Returns coercion functions for built-in domains.
export const getCoreDomains = (world: TWorld) => mapDefinitionsToDomains(getCoreDomainDefinitions(world));
