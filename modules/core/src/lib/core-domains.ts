import { z } from "zod";
import { DOMAIN_GRAPH_QUERY, GraphQuerySchema, DOMAIN_DENSITY_QUERY, DensityQuerySchema } from "./quad-types.js";
import { fromJsonText } from "./json-text.js";
import { extractSeqPathPrefix, parseSeqPath } from "./seq-path.js";
import { LintFindingSchema, LintSummarySchema } from "./domain-chain-lint.js";
import { AStepper, TFeatureStep } from "./astepper.js";
import { TDomainDefinition } from "./resources.js";
import type { TWorld } from "./world.js";
import { TStepValue } from "../schema/protocol.js";
import {
	DOMAIN_ACTIONS,
	DOMAIN_AFFORDANCES,
	DOMAIN_CHAIN_LINT,
	DOMAIN_CHAIN_WALK,
	DOMAIN_DATE,
	DOMAIN_GOAL_RESOLUTION,
	DOMAIN_MICHI,
	DOMAIN_JSON,
	DOMAIN_LINK,
	DOMAIN_NUMBER,
	DOMAIN_RECORD_ID,
	DOMAIN_STATEMENT,
	DOMAIN_STRING,
	DOMAIN_TEXT,
	DOMAIN_VARIABLE_NAME,
	DOMAIN_DOMAIN_NAME,
	DOMAIN_GLOB,
	DOMAIN_FILE_PATH,
	DOMAIN_ROUTE,
	DOMAIN_BEARER_TOKEN,
	DOMAIN_USER_NAME,
	DOMAIN_PASSWORD,
	DOMAIN_PERSISTED_TYPES,
	DOMAIN_BACKGROUND_NAMES,
	DOMAIN_STEP_PATH,
	DOMAIN_DURATION,
	DOMAIN_STEP_METHOD,
	DOMAIN_LINK_REL,
	DOMAIN_WALK_ID,
	listedSchema,
	backgroundNamesSchema,
	DOMAIN_TITLE,
	deriveNamingDomains,
	mapDefinitionsToDomains,
	recordIdInputSchema,
} from "./domains.js";
import { findFeatureStepsFromStatement } from "../phases/Resolver.js";

const numberSchema = z.coerce.number({ error: "invalid number" }).refine((value) => Number.isFinite(value), "invalid number");
const stringSchema = z.coerce.string({ error: "value is required" });
const statementSchema = z.string({ error: "statement label is required" }).min(1, "statement cannot be empty");
const nameSchema = z.string().min(1, "a name cannot be empty");
const dateSchema = z.coerce.date({ error: "invalid date" });
/** A step's place read from its dot-joined sequence path, or from an id beginning with one. */
const stepPathSchema = z.preprocess((value, ctx) => {
	if (typeof value !== "string") return value;
	const prefix = extractSeqPathPrefix(value);
	const path = prefix === null ? null : parseSeqPath(prefix);
	if (path === null) ctx.addIssue({ code: "custom", message: `${JSON.stringify(value)} names no step: a step's place is dot-joined integers, such as 0.1.5.3` });
	return path ?? value;
}, z.array(z.number().int()).min(1));
/** A length of time in milliseconds, read from seconds or milliseconds such as `2s` or `30 ms`, or a number of milliseconds. */
const durationSchema = z.preprocess((value, ctx) => {
	if (typeof value !== "string") return value;
	const match = /^(\d+(?:\.\d+)?)\s*(ms|s)$/.exec(value.trim());
	if (!match) ctx.addIssue({ code: "custom", message: `${JSON.stringify(value)} is no length of time: give seconds or milliseconds, such as 2s or 30 ms` });
	return match ? Number(match[1]) * (match[2] === "s" ? 1000 : 1) : value;
}, z.number().nonnegative());

/**
 * Per-field binding inside a composite binding. Mirrors `TFieldBinding` in
 * `goal-resolver.ts`. Recursive: a field that ranges over another composite
 * domain emits a nested `kind: "composite"` field-binding, reached through a
 * lazy reference so the union can name itself.
 *
 * One value, built once. A function called per caller registers a schema of
 * its own for every run, and converting one to JSON Schema walks the
 * recursion, so no conversion of it could ever be held.
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

/** DOMAIN_GOAL_RESOLUTION product shape: the resolver's four findings. Exported so GoalResolutionStepper validates its products against the same schema the domain registers. */
export const goalResolutionSchema = z.discriminatedUnion("finding", [
	z.object({ finding: z.literal("satisfied"), goal: z.string(), factIds: z.array(z.string()), michi: z.array(michiSchema), truncated: z.boolean() }),
	z.object({ finding: z.literal("michi"), goal: z.string(), michi: z.array(michiSchema), truncated: z.boolean() }),
	z.object({ finding: z.literal("unreachable"), goal: z.string(), missing: z.array(z.string()) }),
	z.object({ finding: z.literal("refused"), goal: z.string(), refusalReason: z.enum(["capability-context-required"]), detail: z.string() }),
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

/** DOMAIN_AFFORDANCES product shape, forward-reachable steps and goal-resolution verdicts. Strict: unknown keys throw, surfacing producer drift instead of silently dropping data on the way to the SPA. */
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
		// Per-domain composite-field map (haibun's sh:node / rdfs:range equivalent): the registered topology.ranges, so the SPA's chain view can emit synthetic field nodes between composite domains and their components. Absent when no domain declares ranges.
		composites: z.record(z.string(), z.record(z.string(), z.string())).optional(),
		// Registered waypoints projected as panel entries, contributed to `show affordances` by every stepper with the ProvidesWaypoints capability (e.g. ActivitiesStepper). Each is a virtual step registered with a gwta the SPA's step-caller renders into a parameter form.
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
		// The run whose facts these are, which is where a fact's step is: a fact's id is that step's seqPath.
		execution: z.string(),
	})
	.strict();

/** DOMAIN_CHAIN_LINT product shape, orphan/unsupplied/unreachable findings plus an optional affordance overlay (forward/goals) the bound Mermaid view renders. */
export const chainLintSchema = z
	.object({
		findings: z.array(LintFindingSchema),
		summary: LintSummarySchema,
		// Optional graph payload the bound view (shu-domain-chain-view) renders as a Mermaid chain; the view falls back to subscribing to shu:affordances when the producer omits these.
		forward: z.array(z.unknown()).optional(),
		goals: z.array(z.unknown()).optional(),
		composites: z.record(z.string(), z.record(z.string(), z.string())).optional(),
		// The run whose facts these are, which is where a fact's step is: a fact's id is that step's seqPath.
		execution: z.string(),
	})
	.strict();

const getCoreDomainDefinitions = (world: TWorld): TDomainDefinition[] => [
	{
		selectors: [DOMAIN_STRING],
		schema: stringSchema,
		description: "Plain string literal captured from feature text.",
	},
	{
		selectors: [DOMAIN_TEXT],
		schema: stringSchema,
		description: "Free text a person writes: a note, a question, a reason or a passage quoted, read as written.",
	},
	{ selectors: [DOMAIN_VARIABLE_NAME], schema: nameSchema, written: true, description: "The name of a variable, as the line writes it." },
	{ selectors: [DOMAIN_DOMAIN_NAME], schema: nameSchema, written: true, description: "The name a declaration gives a new domain, as the line writes it." },
	{ selectors: [DOMAIN_GLOB], schema: nameSchema, description: "A pattern in which * stands for any run of characters." },
	{ selectors: [DOMAIN_FILE_PATH], schema: nameSchema, description: "A file or directory's path, as a storage or the file system reads it." },
	{ selectors: [DOMAIN_TITLE], schema: nameSchema, written: true, description: "The title a feature, scenario, activity or waypoint is given, as the line writes it." },
	{ selectors: [DOMAIN_ROUTE], schema: nameSchema, description: "The path a web server serves something at, such as /shu." },
	{
		selectors: [DOMAIN_BEARER_TOKEN],
		schema: z.string().min(1, "a token cannot be empty"),
		description: "A token whose holder is granted what it grants, sent as `Authorization: Bearer` (RFC 6750).",
	},
	{ selectors: [DOMAIN_USER_NAME], schema: nameSchema, description: "The name an account signs in with." },
	{ selectors: [DOMAIN_PERSISTED_TYPES], schema: listedSchema(nameSchema, "type"), description: "Types records persist as, given as a list or as text separated by commas." },
	{
		selectors: [DOMAIN_BACKGROUND_NAMES],
		schema: backgroundNamesSchema,
		description: "The backgrounds a feature includes, by name, given as a list or as text separated by commas.",
	},
	{ selectors: [DOMAIN_PASSWORD], schema: z.string().min(1, "a password cannot be empty"), description: "The secret an account signs in with." },
	{
		selectors: [DOMAIN_STEP_PATH],
		schema: stepPathSchema,
		description: "A step's place in the run: its dot-joined sequence path, such as 0.1.5.3, or an id that begins with one, as an event's does.",
	},
	{ selectors: [DOMAIN_DURATION], schema: durationSchema, description: "A length of time, given as seconds or milliseconds, such as 2s or 30 ms, read as milliseconds." },
	{
		selectors: [DOMAIN_STEP_METHOD],
		schema: z.string().regex(/^[A-Za-z0-9_]+-[A-Za-z0-9_]+$/, "names no step: a step is named by its stepper and step joined by a hyphen"),
		description: "A step as a call names it, its stepper and step joined by a hyphen, such as Haibun-showSteps.",
	},
	{ selectors: [DOMAIN_LINK_REL], schema: nameSchema, description: "A link relation, by the name a predicate carries it under, such as cites." },
	{ selectors: [DOMAIN_WALK_ID], schema: nameSchema, description: "The id of a walk begun toward a goal, which each advance of it names." },
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
		schema: fromJsonText(GraphQuerySchema),
		description: "A request for records of one type from the graph, with optional filters, sort order, and a result limit.",
	},
	{
		selectors: [DOMAIN_DENSITY_QUERY],
		schema: fromJsonText(DensityQuerySchema),
		description: "A request for how many records of one type fall in each division of a span of time, by how each turned out.",
	},
	{
		selectors: [DOMAIN_ACTIONS],
		schema: listedSchema(z.string().min(1), "action"),
		description: "The actions a caller holds or a delegation allows, such as `Read:public` or `WebPlaywright:attach`, given as a list or as text separated by commas.",
	},
	{
		selectors: [DOMAIN_RECORD_ID],
		schema: recordIdInputSchema,
		description: "The id of a record, of the type another parameter of the same step names.",
	},
	{
		selectors: [DOMAIN_JSON],
		schema: fromJsonText(z.json()),
		description: "A JSON value, given as its text or as the value.",
	},
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
		description: "Domain-chain lint report: orphans, unsupplied steps, unreachable domains.",
		ui: { component: "shu-domain-chain-view" },
	},
	{
		selectors: [DOMAIN_STATEMENT],
		schema: statementSchema,
		written: true,
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
export const getCoreDomains = (world: TWorld) => deriveNamingDomains(mapDefinitionsToDomains(getCoreDomainDefinitions(world)));
