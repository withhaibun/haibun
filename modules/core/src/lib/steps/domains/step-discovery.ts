/**
 * The shape of actuality's declarations. A page, a remote host, an MCP host, a model and a feature line read the
 * declarations in this one shape.
 *
 * This module declares the step descriptor once. The registry holds one descriptor per step. The show steps step returns
 * the descriptors. An MCP host and a model receive tool definitions built from them. A remote host's proxy registers the
 * descriptors it reads. The browser imports this module, so it doesn't import the code that builds schemas.
 */
import { z } from "zod";
import { ConcernCatalogSchema } from "../../domains/hypermedia.js";
import { HYPERMEDIA, productData } from "../../domains/protocol.js";
import { readAction } from "../../domains/actions.js";
import { Access, AccessLevelSchema } from "../../domains/resources.js";

/** The method of the step that shows actuality's declarations. The `Haibun` stepper declares it, so the configuration of
 *  an instance that serves callers lists `haibun`. */
export const SHOW_STEPS_METHOD = "Haibun-showSteps";

/** The action the show steps step requires: a public read. A caller calls show steps before it reads any step's
 *  declaration, so a caller names this action without a prior read. */
export const SHOW_STEPS_ACTION = readAction(Access.public);

/** The method of the step that resolves a line to one of the steps a caller may call. */
export const VALIDATE_STEP_METHOD = "Haibun-validateStep";

/** Whether a line resolves to one step: the method of that step and each of its parameters' terms as the line states them,
 *  or why the line doesn't resolve to exactly one. */
export type TStepValidation = { valid: true; method: string; values: Record<string, string> } | { valid: false; error: string };

/** The domain of the detail that a read of actuality's declarations returns for each declaration. */
export const DOMAIN_STEP_DETAIL = "step-detail";
/** A summary names each declaration, states what it does and links its definition. A definition adds the schemas and
 *  links a step's call. A caller searches summaries and reads the definitions of the steps it calls. */
export const STEP_DETAIL = { summary: "summary", definition: "definition" } as const;
export const StepDetailSchema = z.enum(STEP_DETAIL);
type TStepDetail = z.infer<typeof StepDetailSchema>;

/** A read of actuality's declarations at `detail`. It selects each declaration whose text contains `text` in a
 *  case-insensitive comparison. */
export type TStepsQuery = { text: string; detail: TStepDetail };

/** A read at the definition detail of every declaration actuality holds. Every text contains the empty text, so this read
 *  selects every declaration. A page and a remote host send this read. */
export const EVERY_DEFINITION = { text: "", detail: STEP_DETAIL.definition } as const satisfies TStepsQuery;

/** The JSON Schema of a step's arguments. It is an object with a property for each argument, and every property is required. */
const InputSchemaSchema = z.looseObject({ type: z.literal("object"), properties: z.record(z.string(), z.record(z.string(), z.unknown())), required: z.array(z.string()) });
export type TInputSchema = z.infer<typeof InputSchemaSchema>;

/** A step as every caller discovers it. A step another host declares is named with that host's prefix. */
export const StepDescriptorSchema = z
	.object({
		method: z.string().min(1),
		stepperName: z.string().min(1),
		stepperDescription: z.string().min(1),
		stepName: z.string().min(1),
		/** The step's line: its gwta, its exact text or its match. */
		pattern: z.string().min(1),
		/** What the step does, where its definition states more than its pattern. */
		description: z.string().optional(),
		/** The domain of each parameter. */
		paramDomains: z.record(z.string(), z.string()),
		/** The domain of the products the step returns, where it declares one. */
		productsDomain: z.string().optional(),
		/** The statement parameter whose products the step returns as its own, where the step returns a statement's products. */
		productsOf: z.string().optional(),
		/** Each parameter naming a record by its id, with the parameter naming the record's type. */
		recordIds: z.record(z.string(), z.string()).optional(),
		/** Each parameter taking a record's fields, with the parameter naming the record's type. */
		recordData: z.record(z.string(), z.string()).optional(),
		/** The action a caller holds to call the step. */
		capability: z.string(),
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

/** A read of actuality's declarations with the given text and detail. */
const readOf = <D extends TStepDetail>(text: string, detail: D) => ({ method: SHOW_STEPS_METHOD, params: { text, detail } }) as const;
const readLinkSchema = <D extends TStepDetail>(detail: D) =>
	z.object({ method: z.literal(SHOW_STEPS_METHOD), params: z.object({ text: z.string(), detail: z.literal(detail) }).strict() }).strict();
const definitionLinksSchema = z.object({ definition: readLinkSchema(STEP_DETAIL.definition) }).strict();

/** One stepper whose steps a read matched: its name, what it does, how many of its steps matched, and the read of the
 *  summaries of its steps. A stepper another host declares is named with that host's prefix. */
const StepperSummarySchema = z
	.object({ stepper: z.string(), description: z.string(), steps: z.number(), [HYPERMEDIA.LINKS]: z.object({ steps: readLinkSchema(STEP_DETAIL.summary) }).strict() })
	.strict();
export type TStepperSummary = z.infer<typeof StepperSummarySchema>;

/** A step as a summary states it, linking its definition. */
const StepSummarySchema = StepDescriptorSchema.pick({ method: true, stepperName: true, pattern: true, description: true, capability: true }).extend({
	[HYPERMEDIA.LINKS]: definitionLinksSchema,
});
/** A domain as a summary states it, linking its definition. */
const DomainSummarySchema = z.object({ description: z.string().optional(), [HYPERMEDIA.LINKS]: definitionLinksSchema }).strict();
/** A step as a definition states it, linking its call. */
const StepDefinitionSchema = StepDescriptorSchema.extend({ [HYPERMEDIA.LINKS]: z.object({ call: z.object({ method: z.string() }).strict() }).strict() });
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

/** What a read of actuality's declarations returns at each detail. Both details key their domains by name. */
const StepSummariesSchema = z
	.object({
		detail: z.literal(STEP_DETAIL.summary),
		steppers: z.array(StepperSummarySchema),
		steps: z.array(StepSummarySchema),
		domains: z.record(z.string(), DomainSummarySchema),
	})
	.strict();
const StepDefinitionsSchema = z
	.object({
		detail: z.literal(STEP_DETAIL.definition),
		steppers: z.array(StepperSummarySchema),
		steps: z.array(StepDefinitionSchema),
		domains: z.record(z.string(), DomainDiscoveryInfoSchema),
		concerns: ConcernCatalogSchema,
		predicates: z.array(PredicateSchema),
	})
	.strict();
export const StepDiscoverySchema = z.discriminatedUnion("detail", [StepSummariesSchema, StepDefinitionsSchema]);
export type TStepSummaries = z.infer<typeof StepSummariesSchema>;
export type TStepDefinitions = z.infer<typeof StepDefinitionsSchema>;
type TStepDiscovery = z.infer<typeof StepDiscoverySchema>;

/** What the show steps step does, which its definition states. */
export const SHOW_STEPS_DESCRIPTION = `Reads actuality's declarations: the steps its caller may call, and every domain. The text is compared with each step's method, pattern and description, and with each domain's name and description. The comparison ignores case. An empty text matches every step and domain. A method names its stepper and a hyphen first, so the text GraphStepper- matches the steps of GraphStepper and of any stepper whose name ends in GraphStepper. The ${STEP_DETAIL.summary} detail names each match, states what it does and links its definition. The ${STEP_DETAIL.definition} detail adds each step's argument and product schemas and links its call, and the registry's predicates, which a formula names. A step whose definition you read is one you may call. Every result lists the steppers whose steps matched.`;

/** A tool as MCP defines it. A model provider sends the same fields under its own field names. */
export type TToolDefinition = { name: string; description: string; inputSchema: TInputSchema };

/** Returns whether any of the texts contains the given text in a case-insensitive comparison. */
export function containsText(texts: Array<string | undefined>, text: string): boolean {
	const sought = text.toLowerCase();
	return texts.some((candidate) => candidate !== undefined && candidate.toLowerCase().includes(sought));
}

/** The read of the summaries of a stepper's steps, by the stepper's name and the hyphen that separates a method's
 *  stepper from its step. */
export const stepperStepsLink = (stepper: string) => readOf(`${stepper}-`, STEP_DETAIL.summary);
/** The read of the definitions of the declarations that contain a text. */
const definitionLink = (text: string) => readOf(text, STEP_DETAIL.definition);

/** A step as a summary states it. */
export const stepSummary = ({ method, stepperName, pattern, description, capability }: TStepDescriptor): TStepSummaries["steps"][number] => ({
	method,
	stepperName,
	pattern,
	description,
	capability,
	[HYPERMEDIA.LINKS]: { definition: definitionLink(method) },
});
/** A domain as a summary states it. */
export const domainSummary = (domain: string, description: string | undefined): TStepSummaries["domains"][string] => ({
	description,
	[HYPERMEDIA.LINKS]: { definition: definitionLink(domain) },
});
/** A step as a definition states it. */
export const stepDefinition = (step: TStepDescriptor): TStepDefinition => ({ ...step, [HYPERMEDIA.LINKS]: { call: { method: step.method } } });

/** Parses the products of a call to show steps at the detail the call requested. A dispatched step's products carry its
 *  seqPath and its domain's hypermedia markers. These fields aren't actuality's declarations, so productData drops them. */
export function readShownSteps(products: unknown, detail: typeof STEP_DETAIL.summary): TStepSummaries;
export function readShownSteps(products: unknown, detail: typeof STEP_DETAIL.definition): TStepDefinitions;
export function readShownSteps(products: unknown, detail: TStepDetail): TStepDiscovery {
	const shown = productData(z.record(z.string(), z.unknown()).parse(products));
	return (detail === STEP_DETAIL.summary ? StepSummariesSchema : StepDefinitionsSchema).parse(shown);
}

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
	const ask = `Call ${SHOW_STEPS_METHOD} to find the step a request needs.`;
	if (steppers.length === 0) return ask;
	const listed = steppers.map((entry) => `- ${entry.stepper} (${entry.steps} steps): ${entry.description}`).join("\n");
	return `${ask}\n\nSteppers whose steps you hold:\n${listed}`;
}
