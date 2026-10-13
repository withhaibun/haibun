import { z } from "zod";
import { DOMAIN_GRAPH_QUERY, GraphQuerySchema, DOMAIN_DENSITY_QUERY, DensityQuerySchema } from "./quad-types.js";
import { fromJsonText, JsonObjectTextSchema } from "./json-text.js";
import { DOMAIN_FILE_DATA, DOMAIN_IMAGE_REFERENCE, FileDataSchema, ImageReferenceSchema, recordedFileData } from "./media-object.js";
import { extractSeqPathPrefix, parseSeqPath, seqPathDomainDefinition } from "./seq-path.js";
import { factDomainDefinition } from "./records/domains/facts.js";
import { variableDomainDefinition } from "./records/domains/variables.js";
import { classDomainDefinition, propertyDomainDefinition } from "./records/domains/ontology.js";
import { LintFindingSchema, LintSummarySchema } from "./domain-chain-lint.js";
import { AStepper, TFeatureStep } from "./astepper.js";
import { TDomainDefinition } from "./resources.js";
import type { TWorld } from "./world.js";
import { TStepValue } from "../schema/protocol.js";
import { DOMAIN_INDIVIDUAL_ADDRESS, IndividualAddressSchema } from "./typed-links.js";
import {
	DOMAIN_ACTIONS,
	DOMAIN_AFFORDANCES,
	DOMAIN_CHAIN_LINT,
	DOMAIN_CHAIN_WALK,
	DOMAIN_DATE,
	DOMAIN_GOAL_RESOLUTION,
	DOMAIN_MICHI,
	DOMAIN_JSON,
	DOMAIN_JSON_OBJECT,
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
	DOMAIN_VARIABLE_VALUE,
	DURATION_TERM,
	DOMAIN_TEMPLATE,
	DOMAIN_WAYPOINT_ARGUMENT,
	DOMAIN_LINE_COMMENT,
	DOMAIN_HYPERMEDIA_DECLARATION,
	DOMAIN_SET_VALUES,
	DOMAIN_STATEMENT_LINES,
	listedSchema,
	backgroundNamesSchema,
	setValuesSchema,
	DOMAIN_TITLE,
	deriveNamingDomains,
	mapDefinitionsToDomains,
	recordIdInputSchema,
	NameSchema,
} from "./domains.js";
import { findFeatureStepsFromStatement } from "../phases/Resolver.js";

const numberSchema = z.coerce.number({ error: "invalid number" }).refine((value) => Number.isFinite(value), "invalid number");
const stringSchema = z.coerce.string({ error: "value is required" });
const statementSchema = z.string({ error: "statement label is required" }).min(1, "statement cannot be empty");
const dateSchema = z.coerce.date({ error: "invalid date" });
/** Reads a step's place from its dot-joined sequence path, or from an id that begins with one. */
const stepPathSchema = z.preprocess((value, ctx) => {
	if (typeof value !== "string") return value;
	const prefix = extractSeqPathPrefix(value);
	const path = prefix === null ? null : parseSeqPath(prefix);
	if (path === null) ctx.addIssue({ code: "custom", message: `${JSON.stringify(value)} doesn't name a step: a step's place is dot-joined integers, such as 0.1.5.3` });
	return path ?? value;
}, z.array(z.number().int()).min(1));
/** Reads a length of time in milliseconds from seconds or milliseconds, such as `2s` or `30 ms`, or from a number of milliseconds. */
const durationSchema = z.preprocess((value, ctx) => {
	if (typeof value !== "string") return value;
	const match = DURATION_TERM.exec(value.trim());
	if (!match) ctx.addIssue({ code: "custom", message: `${JSON.stringify(value)} isn't a length of time: give seconds or milliseconds, such as 2s or 30 ms` });
	return match ? Number(match[1]) * (match[2] === "s" ? 1000 : 1) : value;
}, z.number().nonnegative());

/**
 * The schema of a per-field binding inside a composite binding. It matches `TFieldBinding` in `goal-resolver.ts`. The
 * binding of a field that ranges over another composite domain is a nested `kind: "composite"` field-binding. The union
 * references itself through `z.lazy`.
 *
 * The schema is a module-level constant. jsonSchemaOf holds one conversion per schema object, so the conversion walks
 * the recursion once per process.
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
 * The shape of one resolved michi (path). `DOMAIN_MICHI` and the `michi` array of `DOMAIN_GOAL_RESOLUTION` both use it.
 * The composite binding variant holds the per-field sub-bindings of one input domain. `topology.ranges` declares the
 * fields, as sh:node and rdfs:range do.
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

/** The DOMAIN_GOAL_RESOLUTION product shape holds one of the resolver's four findings. GoalResolutionStepper validates its products against this exported schema, and the domain registers the same schema. */
export const goalResolutionSchema = z.discriminatedUnion("finding", [
	z.object({ finding: z.literal("satisfied"), goal: z.string(), factIds: z.array(z.string()), michi: z.array(michiSchema), truncated: z.boolean() }),
	z.object({ finding: z.literal("michi"), goal: z.string(), michi: z.array(michiSchema), truncated: z.boolean() }),
	z.object({ finding: z.literal("unreachable"), goal: z.string(), missing: z.array(z.string()) }),
	z.object({ finding: z.literal("refused"), goal: z.string(), refusalReason: z.enum(["capability-context-required"]), detail: z.string() }),
]);

/**
 * The DOMAIN_CHAIN_WALK product shape describes a walk toward a goal. A walk runs a resolved path one step per advance,
 * and its state is held between advances. The shape holds every step of the path, the walk's position, the next step,
 * and the parameters the next step takes from the caller.
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
		/** The names of the parameters the next step declares. An advance supplies them to continue the walk. */
		needs: z.array(z.string()),
		/** The ids of the facts each completed step asserted. */
		factIds: z.array(z.string()),
		error: z.string().optional(),
	})
	.strict();

/** The DOMAIN_AFFORDANCES product shape holds the forward-chaining frontier and the goal-resolution verdicts. The schema is strict, so parsing throws on a key the schema doesn't declare, and doesn't drop the key before the SPA receives it. */
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
		// Maps each composite domain to its field ranges, from the registered topology.ranges. topology.ranges is haibun's equivalent of sh:node and rdfs:range. The SPA's chain view renders a field node between each field's domain and the composite domain. Absent when the domains don't declare ranges.
		composites: z.record(z.string(), z.record(z.string(), z.string())).optional(),
		// Registered waypoints as panel entries. Every stepper with the ProvidesWaypoints capability, such as ActivitiesStepper, adds its waypoints to the affordances snapshot. Each is a virtual step registered with a gwta, and shu-step-caller renders the gwta as a parameter form.
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
		// The id of the execution whose steps asserted these facts. A fact's id is the seqPath of its step within this execution.
		execution: z.string(),
	})
	.strict();

/** The DOMAIN_CHAIN_LINT product shape holds the lint findings and their summary, with the affordance snapshot the bound view draws
 *  as the chain beside the findings. */
export const chainLintSchema = z
	.object({
		findings: z.array(LintFindingSchema),
		summary: LintSummarySchema,
		// The affordance snapshot that shu-domain-chain-view draws as the chain beside the findings. `show chain lint` carries the
		// snapshot the view reads: forward, goals and the satisfied domains, with the report's findings and their summary. The view
		// throws on a report without them.
		forward: z.array(z.unknown()).optional(),
		goals: z.array(z.unknown()).optional(),
		satisfiedDomains: z.array(z.string()),
		satisfiedFacts: z.record(z.string(), z.array(z.string())),
		composites: z.record(z.string(), z.record(z.string(), z.string())).optional(),
		// The id of the execution whose steps asserted these facts. A fact's id is the seqPath of its step within this execution.
		execution: z.string(),
	})
	.strict();

const getCoreDomainDefinitions = (world: TWorld): TDomainDefinition[] => [
	// The types of the records core writes or derives: each step's record, the facts and variables actuality holds, and the ontology.
	seqPathDomainDefinition,
	factDomainDefinition,
	variableDomainDefinition,
	classDomainDefinition,
	propertyDomainDefinition,
	{ selectors: [DOMAIN_STRING], schema: stringSchema, description: "A plain string literal captured from feature text." },
	{ selectors: [DOMAIN_TEXT], schema: stringSchema, description: "Free text a person writes: a note, a question, a reason or a passage quoted, read as written." },
	{
		selectors: [DOMAIN_VARIABLE_NAME],
		schema: NameSchema,
		written: true,
		filled: true,
		description: "The name of a variable, as written in the line. Each {name} in it is replaced by the resolved value of name.",
	},
	{ selectors: [DOMAIN_IMAGE_REFERENCE], schema: ImageReferenceSchema, description: "An image: the location of its bytes in actuality's storage, and their media type." },
	{
		selectors: [DOMAIN_FILE_DATA],
		schema: FileDataSchema,
		recordedAs: recordedFileData,
		description: "A file's bytes as a data: URL, as a page reads a file. A step's record states the file's type and size in place of its bytes.",
	},
	{ selectors: [DOMAIN_DOMAIN_NAME], schema: NameSchema, written: true, description: "The name a declaration gives a new domain, as written in the line." },
	{ selectors: [DOMAIN_GLOB], schema: NameSchema, description: "A pattern in which * matches any sequence of characters." },
	{ selectors: [DOMAIN_FILE_PATH], schema: NameSchema, description: "A file or directory's path, as a storage or the file system reads it." },
	{ selectors: [DOMAIN_TITLE], schema: NameSchema, written: true, description: "The title of a feature, scenario, activity or waypoint, as written in the line." },
	{
		selectors: [DOMAIN_WAYPOINT_ARGUMENT],
		schema: NameSchema,
		description:
			"An argument in a call to a waypoint, for a placeholder in the waypoint's outcome pattern. It is quoted text, or the value of the variable that an unquoted name references. The activity and the proof read it as a runtime argument.",
	},
	{
		selectors: [DOMAIN_LINE_COMMENT],
		schema: z.string(),
		written: true,
		description: "The text of a line comment after `;;`, as written in the feature. Actuality doesn't act on it.",
	},
	{ selectors: [DOMAIN_ROUTE], schema: NameSchema, description: "The path at which a web server serves a resource, such as /shu." },
	{ selectors: [DOMAIN_BEARER_TOKEN], schema: NameSchema, description: "A token sent as `Authorization: Bearer` (RFC 6750). It grants its holder the access it carries." },
	{ selectors: [DOMAIN_USER_NAME], schema: NameSchema, description: "The name that identifies an account at sign-in." },
	{ selectors: [DOMAIN_PERSISTED_TYPES], schema: listedSchema(NameSchema, "type"), description: "The persisted types of records, given as a list or as text separated by commas." },
	{
		selectors: [DOMAIN_BACKGROUND_NAMES],
		schema: backgroundNamesSchema,
		written: true,
		description: "The names of the backgrounds a feature includes, given as a list or as text separated by commas, as written in the line.",
	},
	{ selectors: [DOMAIN_PASSWORD], schema: NameSchema, description: "The secret that authenticates an account at sign-in." },
	{
		selectors: [DOMAIN_STEP_PATH],
		schema: stepPathSchema,
		description: "A step's place in actuality: its dot-joined sequence path, such as 0.1.5.3, or an id that begins with one, as an event's does.",
	},
	{ selectors: [DOMAIN_DURATION], schema: durationSchema, description: "A length of time, given as seconds or milliseconds, such as 2s or 30 ms, read as milliseconds." },
	{
		selectors: [DOMAIN_STEP_METHOD],
		schema: z.string().regex(/^[A-Za-z0-9_]+-[A-Za-z0-9_]+$/, "doesn't name a step: a step is named by its stepper and step joined by a hyphen"),
		description: "A step's name in a call: its stepper and step joined by a hyphen, such as Haibun-showSteps.",
	},
	{ selectors: [DOMAIN_LINK_REL], schema: NameSchema, description: "A link relation's name, as a statement's predicate uses it, such as cites." },
	{ selectors: [DOMAIN_WALK_ID], schema: NameSchema, description: "The id of a walk toward a goal. Each advance of the walk names this id." },
	{
		selectors: [DOMAIN_VARIABLE_VALUE],
		schema: z.unknown(),
		description:
			"A value to assign to a variable or to compare with a variable's value. The step receives it as a TStepValue with its domain, and the variable's domain coerces it.",
	},
	{ selectors: [DOMAIN_TEMPLATE], schema: z.string(), written: true, description: "Text as written in the line. A composition fills each #{name} placeholder from a variable." },
	{
		selectors: [DOMAIN_HYPERMEDIA_DECLARATION],
		schema: z.string().trim().min(1, "the declaration is empty"),
		written: true,
		description: "A declared type's hypermedia declaration, as written in the line: its JSON-LD @context, or prose naming its fields.",
	},
	{ selectors: [DOMAIN_SET_VALUES], schema: setValuesSchema, written: true, description: "The members of a bracketed list, as written in the line." },
	{
		selectors: [DOMAIN_STATEMENT_LINES],
		schema: fromJsonText(z.array(z.string().min(1)).min(1)),
		description: "Step lines, in order, as a JSON array: the statements a saved activity runs.",
	},
	{ selectors: [DOMAIN_LINK], schema: stringSchema, description: "A URI string for a navigable link." },
	{
		selectors: [DOMAIN_NUMBER],
		schema: numberSchema,
		description: "A numeric literal coerced with Number().",
		comparator: (value, baseline) => (value as number) - (baseline as number),
	},
	{
		selectors: [DOMAIN_DATE],
		schema: dateSchema,
		description: "A Date object coerced from an ISO timestamp, epoch milliseconds or a Date literal.",
		comparator: (value, baseline) => (value as Date).getTime() - (baseline as Date).getTime(),
	},
	{
		// Core declares this domain once, with GraphQuerySchema, so every step that takes a graph query validates it with one
		// schema. registerDomains keeps the first declaration of a domain key and skips later ones.
		selectors: [DOMAIN_GRAPH_QUERY],
		schema: fromJsonText(GraphQuerySchema),
		description: "A request for records of one type from the graph, with optional filters, sort order, and a result limit.",
	},
	{
		selectors: [DOMAIN_DENSITY_QUERY],
		schema: fromJsonText(DensityQuerySchema),
		description: "A request for the number of records of one type in each division of a span of time, grouped by a field that states each record's outcome.",
	},
	{
		selectors: [DOMAIN_ACTIONS],
		schema: listedSchema(z.string().min(1), "action"),
		description: "The actions a caller holds or a delegation allows, such as `Read:public` or `WebPlaywright:attach`, given as a list or as text separated by commas.",
	},
	{ selectors: [DOMAIN_INDIVIDUAL_ADDRESS], schema: IndividualAddressSchema, description: "An individual, by its persisted type and its id." },
	{ selectors: [DOMAIN_RECORD_ID], schema: recordIdInputSchema, description: "The id of a record, of the type another parameter of the same step names." },
	{ selectors: [DOMAIN_JSON], schema: fromJsonText(z.json()), description: "A JSON value, given as its text or as the value." },
	{ selectors: [DOMAIN_JSON_OBJECT], schema: JsonObjectTextSchema, description: "A JSON object, given as its text or as the object." },
	{ selectors: [DOMAIN_MICHI], schema: michiSchema, description: "One path the resolver computed from working memory to a goal: its ordered steps and per-input bindings." },
	{
		selectors: [DOMAIN_GOAL_RESOLUTION],
		schema: goalResolutionSchema,
		description: "One of the goal resolver's four findings: satisfied (existing facts and paths that produce more), michi (enumerated paths), unreachable or refused.",
	},
	{
		selectors: [DOMAIN_AFFORDANCES],
		schema: affordancesSchema,
		description: "The steps the caller may call next, each with whether its inputs are ready, and the goal-resolution verdicts.",
		ui: { component: "shu-affordances-panel", summary: "Affordances" },
	},
	{
		selectors: [DOMAIN_CHAIN_WALK],
		schema: chainWalkSchema,
		description: "A walk toward a goal, run one step per advance: the path's steps, the walk's position, the next step, and the parameters the next step takes from the caller.",
	},
	{
		selectors: [DOMAIN_CHAIN_LINT],
		schema: chainLintSchema,
		description: "The domain-chain lint report: unsupplied steps, unreachable domains, unproduced domains and string parameters.",
		ui: { component: "shu-domain-chain-view" },
	},
	{
		selectors: [DOMAIN_STATEMENT],
		schema: statementSchema,
		written: true,
		description: "A reference to another Haibun statement.",
		coerce: (proto: TStepValue, featureStep?: TFeatureStep, steppers?: AStepper[]) => {
			if (!featureStep || !steppers) {
				throw new Error("statement domain coercion requires a feature step and the steppers");
			}
			const label = statementSchema.parse(proto.value);
			const seqStart = featureStep.seqPath;
			return findFeatureStepsFromStatement(label, steppers, world, featureStep.source?.path, [...seqStart, 0], -1);
		},
	},
];

// Returns the core domains as registered domains, with the naming domains that deriveNamingDomains adds.
export const getCoreDomains = (world: TWorld) => deriveNamingDomains(mapDefinitionsToDomains(getCoreDomainDefinitions(world)));
