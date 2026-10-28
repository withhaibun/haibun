/**
 * The shape of actuality's declarations. A page, a remote host, an MCP host, a model and a feature line read the
 * declarations in this one shape.
 *
 * This module declares the step descriptor once. The registry holds one descriptor per step. The show steps step returns
 * the descriptors. An MCP host and a model receive tool definitions built from them. A remote host's proxy registers the
 * descriptors it reads. The browser imports this module, so it doesn't import the code that builds schemas.
 */
import { z } from "zod";
import { ConcernCatalogSchema, CountedFields } from "../../domains/hypermedia.js";
import { HYPERMEDIA, productData } from "../../domains/protocol.js";
import { ActionSchema, readAction } from "../../domains/actions.js";
import { StepMethodSchema, type TStepMethod } from "./step-method.js";
import { DomainKeySchema } from "../../domains/domains.js";
import { Access, AccessLevelSchema, RecordNamespaceSchema } from "../../domains/resources.js";

/** The lines and the methods of the steps that show actuality's declarations: the steps a caller may call, their
 *  definitions, and the steppers. The `Haibun` stepper declares them, so the configuration of an instance that serves
 *  callers lists `haibun`. */
export const SHOW_STEPS_LINE = "show steps";
export const SHOW_STEPS_METHOD = "Haibun-showSteps" as TStepMethod;
export const SHOW_STEP_DEFINITIONS_LINE = "show step definitions";
export const SHOW_STEP_DEFINITIONS_METHOD = "Haibun-showStepDefinitions" as TStepMethod;
/** The method of the combinator that keeps the items of a statement's list that hold a text. */
export const MATCHING_METHOD = "Haibun-matching" as TStepMethod;
/** The methods of the combinators that keep the first items of a statement's list, and the items after the first. A caller
 *  over a transport reads a window of a list with them, stating the read as a call. */
export const LIMITED_TO_METHOD = "Haibun-limitedTo" as TStepMethod;
export const SKIPPING_METHOD = "Haibun-skipping" as TStepMethod;

/** The action the reads of actuality's declarations require: a public read. A caller reads them before it reads any step's
 *  declaration, so a caller names this action without a prior read. */
export const SHOW_STEPS_ACTION = readAction(Access.public);

/** The method of the step that resolves a line to one of the steps a caller may call. */
export const VALIDATE_STEP_METHOD = "Haibun-validateStep" as TStepMethod;

/** Whether a line resolves to one step: the method of that step and each of its parameters' terms as the line states them,
 *  or why the line doesn't resolve to exactly one. */
export type TStepValidation =
	| { valid: true; method: string; values: Record<string, string>; readings: Record<string, string> }
	| { valid: false; error: string; completions: string[] };

/** The product domains of the reads of actuality's declarations. Each holds a list, which the list combinators read. */
export const DOMAIN_STEP_SUMMARIES = "step-summaries";
export const DOMAIN_STEP_DEFINITIONS = "step-definitions";

/** The JSON Schema of a step's arguments. It is an object with a property for each argument, and every property is required. */
const InputSchemaSchema = z.looseObject({ type: z.literal("object"), properties: z.record(z.string(), z.record(z.string(), z.unknown())), required: z.array(z.string()) });
export type TInputSchema = z.infer<typeof InputSchemaSchema>;

/** A step as every caller discovers it. A step another host declares is named with that host's prefix. */
export const StepDescriptorSchema = z
	.object({
		method: StepMethodSchema,
		stepperName: z.string().min(1),
		stepperDescription: z.string().min(1),
		stepName: z.string().min(1),
		/** The step's line: its gwta, its exact text or its match. */
		pattern: z.string().min(1),
		/** What the step does, where its definition states more than its pattern. */
		description: z.string().optional(),
		/** The domain of each parameter. */
		paramDomains: z.record(z.string(), DomainKeySchema),
		/** The domain of the products the step returns, where it declares one. */
		productsDomain: DomainKeySchema.optional(),
		/** The statement parameter whose products the step returns as its own, where the step returns a statement's products. */
		productsOf: z.string().optional(),
		/** Each parameter naming a record by its id, with the parameter naming the record's type. */
		recordIds: z.record(z.string(), z.string()).optional(),
		/** Each parameter taking a record's fields, with the parameter naming the record's type. */
		recordData: z.record(z.string(), z.string()).optional(),
		/** The action a caller holds to call the step. */
		capability: ActionSchema,
		/** The access level of the records the step reads, where the step states one. A caller's read must reach this level. */
		readsAt: AccessLevelSchema.optional(),
		/** Whether the step is a read. A call that requests a read must name such a step, and actuality returns the result of
		 *  a read over a transport without recording a step. */
		read: z.boolean(),
		/** Whether the resolver drops the step from a line's candidates where a step that isn't a fallback also matches the line. */
		fallback: z.boolean(),
		/** Whether the step's result is the response to the turn that called it. That turn ends with the result and doesn't
		 *  send its model another request. */
		answersTheTurn: z.boolean(),
		/** The read step that returns what the step changed, where the step names one. answeredFor calls it after the step,
		 *  whether the step passed or failed. */
		answeredBy: z.string().optional(),
		/** The origin of the instance that runs the step, where another instance runs it. A transport calls the step at
		 *  this origin. */
		remoteOrigin: z.string().optional(),
		inputSchema: InputSchemaSchema,
		/** The JSON Schema of the products the step returns, where it declares them. */
		outputSchema: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();
export type TStepDescriptor = z.infer<typeof StepDescriptorSchema>;

/** A domain as a read of actuality's declarations states it. */
const DomainDiscoveryInfoSchema = z
	.object({
		description: z.string().optional(),
		values: z.array(z.string()).optional(),
		stepperName: z.string().optional(),
		persistedAs: z.string().optional(),
		/** The domain's presentation: the component that renders it, the URL of the component's source, and its labels. It
		 *  doesn't contain the component's source. A client loads the source from the URL. */
		ui: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();
export type TDomainDiscoveryInfo = z.infer<typeof DomainDiscoveryInfoSchema>;

/** The call that keeps the items of a read of actuality's declarations that hold a text: the read's line, under the matching combinator. */
const matchingLink = <L extends string>(text: string, statement: L) => ({ method: MATCHING_METHOD, params: { text, statement } }) as const;
const matchingLinkSchema = <L extends string>(statement: L) =>
	z.object({ method: z.literal(MATCHING_METHOD), params: z.object({ text: z.string(), statement: z.literal(statement) }).strict() }).strict();
const definitionLinksSchema = z.object({ definition: matchingLinkSchema(SHOW_STEP_DEFINITIONS_LINE) }).strict();

/** One stepper whose steps a read matched: its name, what it does, how many of its steps matched, and the read of the
 *  summaries of its steps. A stepper another host declares is named with that host's prefix. */
const StepperSummarySchema = z
	.object({ stepper: z.string(), description: z.string(), steps: z.number(), [HYPERMEDIA.LINKS]: z.object({ steps: matchingLinkSchema(SHOW_STEPS_LINE) }).strict() })
	.strict();
export type TStepperSummary = z.infer<typeof StepperSummarySchema>;

/** Whether the caller of a read of actuality's declarations may call a step. A step the caller can't call is listed, so a link
 *  to it leads to the action it requires. */
const CallableFields = { callable: z.boolean() };

/** A step as a summary states it, linking its definition. */
const StepSummarySchema = StepDescriptorSchema.pick({ method: true, stepperName: true, pattern: true, description: true, capability: true }).extend({
	...CallableFields,
	[HYPERMEDIA.LINKS]: definitionLinksSchema,
});
/** A domain as a summary states it, linking its definition. */
const DomainSummarySchema = z.object({ description: z.string().optional(), [HYPERMEDIA.LINKS]: definitionLinksSchema }).strict();
/** A step as a definition states it, linking its call. */
const StepDefinitionSchema = StepDescriptorSchema.extend({ ...CallableFields, [HYPERMEDIA.LINKS]: z.object({ call: z.object({ method: z.string() }).strict() }).strict() });
export type TStepDefinition = z.infer<typeof StepDefinitionSchema>;

/** A predicate of the registry as a definition states it: its name, its parts with their domains, and, where a line states it,
 *  the line and the step whose method proves it. A waypoint's head names the library that states its rule. A formula names a
 *  predicate by its name, with its parts in order. */
const PredicateSchema = z
	.object({
		name: z.string(),
		parts: z.array(z.object({ name: z.string(), domain: z.string() }).strict()).readonly(),
		line: z.string().optional(),
		method: z.string().optional(),
		waypoint: z.string().optional(),
	})
	.strict();
export type TPredicate = z.infer<typeof PredicateSchema>;

/** How an offer of a waypoint's head marks it: as a waypoint, with the library that states its rule. */
export const waypointMark = (library: string): string => `waypoint · ${library}`;

/** What a read of actuality's declarations returns: a counted list of every step actuality declares, as a summary or as a
 *  definition, each with whether its caller may call it. Both key their domains by name. */
export const StepSummariesSchema = z
	.object({ steppers: z.array(StepperSummarySchema), steps: z.array(StepSummarySchema), domains: z.record(z.string(), DomainSummarySchema), ...CountedFields })
	.strict();
export const StepDefinitionsSchema = z
	.object({
		steppers: z.array(StepperSummarySchema),
		steps: z.array(StepDefinitionSchema),
		domains: z.record(z.string(), DomainDiscoveryInfoSchema),
		concerns: ConcernCatalogSchema,
		/** The records' namespace, which names each record a page reads by its record IRI. */
		records: RecordNamespaceSchema,
		predicates: z.array(PredicateSchema),
		...CountedFields,
	})
	.strict();
export type TStepSummaries = z.infer<typeof StepSummariesSchema>;
export type TStepDefinitions = z.infer<typeof StepDefinitionsSchema>;

/** A tool as MCP defines it. A model provider sends the same fields under its own field names. */
export type TToolDefinition = { name: string; description: string; inputSchema: TInputSchema };

/** The read of the summaries of a stepper's steps, by the stepper's name and the hyphen that separates a method's
 *  stepper from its step. */
export const stepperStepsLink = (stepper: string) => matchingLink(`${stepper}-`, SHOW_STEPS_LINE);
/** The read of the definitions of the steps whose definitions hold a text. */
const definitionLink = (text: string) => matchingLink(text, SHOW_STEP_DEFINITIONS_LINE);

/** A step as a summary states it, with whether its caller may call it. */
export const stepSummary = ({ method, stepperName, pattern, description, capability }: TStepDescriptor, callable: boolean): TStepSummaries["steps"][number] => ({
	method,
	stepperName,
	pattern,
	description,
	capability,
	callable,
	[HYPERMEDIA.LINKS]: { definition: definitionLink(method) },
});
/** A domain as a summary states it. */
export const domainSummary = (domain: string, description: string | undefined): TStepSummaries["domains"][string] => ({
	description,
	[HYPERMEDIA.LINKS]: { definition: definitionLink(domain) },
});
/** A step as a definition states it, with whether its caller may call it. */
export const stepDefinition = (step: TStepDescriptor, callable: boolean): TStepDefinition => ({ ...step, callable, [HYPERMEDIA.LINKS]: { call: { method: step.method } } });

/** The products of a read of actuality's declarations as `schema` parses them. A dispatched step's products carry its seqPath
 *  and its domain's hypermedia markers. These fields aren't actuality's declarations, so productData drops them. */
const shownIn =
	<T>(schema: z.ZodType<T>) =>
	(products: unknown): T =>
		schema.parse(productData(z.record(z.string(), z.unknown()).parse(products)));
/** Parses the products of a read of the step summaries. */
export const readStepSummaries = shownIn(StepSummariesSchema);
/** Parses the products of a read of the step definitions. */
export const readStepDefinitions = shownIn(StepDefinitionsSchema);

/** A step as a tool: its method as the name, its pattern with its description, the capability it requires, the origin
 *  of the instance that runs it, and the schema of its arguments. */
export function toolDefinition(step: TStepDescriptor): TToolDefinition {
	const parts = [step.pattern, step.description, `Requires capability ${step.capability}.`, step.remoteOrigin === undefined ? undefined : `Runs at ${step.remoteOrigin}.`];
	return { name: step.method, description: parts.filter((part) => part !== undefined).join("\n\n"), inputSchema: step.inputSchema };
}

/** The instructions a caller receives before its first request. They name the step that reads actuality's declarations.
 *  They list each stepper of the steps the caller holds, with its name, what it does and how many of its steps the caller
 *  holds. The definition of show steps states how to read the declarations. A model's turn puts these instructions in its
 *  standing instruction. An MCP host sets its instructions before any caller connects, so they don't list a stepper. */
export function stepsInstructions(steppers: TStepperSummary[]): string {
	const ask = `Call ${SHOW_STEPS_METHOD} to list the steps, ${MATCHING_METHOD} with a text and the statement "${SHOW_STEPS_LINE}" to find the step a request needs, and ${SHOW_STEP_DEFINITIONS_METHOD} under ${MATCHING_METHOD} to read its definition.`;
	if (steppers.length === 0) return ask;
	const listed = steppers.map((entry) => `- ${entry.stepper} (${entry.steps} steps): ${entry.description}`).join("\n");
	return `${ask}\n\nSteppers whose steps you hold:\n${listed}`;
}
