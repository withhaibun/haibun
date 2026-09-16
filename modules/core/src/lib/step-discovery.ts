/**
 * What a run declares, in the one shape every caller reads it in: a page, a remote host, an MCP host, a model and a
 * feature line.
 *
 * A step's description is declared here once. The registry holds one per step, the show steps step returns them, an MCP
 * host and a model are given tool definitions made from them, and a remote host's proxy registers the ones it read.
 * Separate from step-registry because the browser reads this module, and step-registry builds schemas on the server.
 */
import { z } from "zod";
import { ConcernCatalogSchema } from "./hypermedia.js";

/** The step that shows what a run declares. `Haibun` declares it, so a run that serves callers lists `haibun`. */
export const SHOW_STEPS_METHOD = "Haibun-showSteps";

/** The domain of how much of each declaration a read of a run's declarations returns. */
export const DOMAIN_STEP_DETAIL = "step-detail";
/** A summary names each declaration and says what it does, and links its definition. A definition adds the schemas and
 *  links a step's call. A caller searches summaries, and reads the definitions of the steps it calls. */
export const STEP_DETAIL = { summary: "summary", definition: "definition" } as const;
export const StepDetailSchema = z.enum([STEP_DETAIL.summary, STEP_DETAIL.definition]);
export type TStepDetail = z.infer<typeof StepDetailSchema>;

/** A read of what a run declares: the declarations whose text contains `text`, compared without regard to case, at `detail`. */
export const StepsQuerySchema = z.object({ text: z.string(), detail: StepDetailSchema }).strict();
export type TStepsQuery = z.infer<typeof StepsQuerySchema>;

/** Every declaration a run holds, in full, since every text contains the empty text. A page and a remote host read this. */
export const EVERY_DEFINITION: TStepsQuery = { text: "", detail: STEP_DETAIL.definition };

/** Whether any of the texts contains the given text, compared without regard to case. */
export function containsText(texts: Array<string | undefined>, text: string): boolean {
	const sought = text.toLowerCase();
	return texts.some((candidate) => candidate !== undefined && candidate.toLowerCase().includes(sought));
}

/** The JSON Schema of a step's arguments: an object with a property for each argument, every one required. */
export const InputSchemaSchema = z.looseObject({
	type: z.literal("object"),
	properties: z.record(z.string(), z.record(z.string(), z.unknown())),
	required: z.array(z.string()),
});
export type TInputSchema = z.infer<typeof InputSchemaSchema>;

/** A step as every caller discovers it. A step another host declares is named with that host's prefix, and its pattern names the host. */
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
		params: z.record(z.string(), z.enum(["string", "number"])),
		/** The domain of each parameter. */
		paramDomains: z.record(z.string(), z.string()),
		/** The domain of the products the step returns, where it declares one. */
		productsDomain: z.string().optional(),
		/** The capability a caller holds to call the step, where the step requires one. */
		capability: z.string().optional(),
		/** Whether the step is a read: a caller that names it asks to read, and the run answers without recording the reading. */
		read: z.boolean(),
		/** Whether the step answers only when no other step answers to its name. */
		fallback: z.boolean(),
		inputSchema: InputSchemaSchema,
		/** The JSON Schema of the products the step returns, where it declares them. */
		outputSchema: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();
export type TStepDescriptor = z.infer<typeof StepDescriptorSchema>;

/** A domain as a read of a run's declarations states it. */
export const DomainDiscoveryInfoSchema = z
	.object({
		description: z.string().optional(),
		values: z.array(z.string()).optional(),
		stepperName: z.string().optional(),
		persistedAs: z.string().optional(),
		/** How a domain presents itself: the component that renders it, the URL its source is served from, and its labels.
		 *  Never the component's source itself: a client loads that from the URL. */
		ui: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();
export type TDomainDiscoveryInfo = z.infer<typeof DomainDiscoveryInfoSchema>;

/** A read of a run's declarations with the text and the detail given. */
const readOf = <D extends TStepDetail>(text: string, detail: D): { method: typeof SHOW_STEPS_METHOD; params: { text: string; detail: D } } => ({
	method: SHOW_STEPS_METHOD,
	params: { text, detail },
});
const readLinkSchema = <D extends TStepDetail>(detail: D) =>
	z.object({ method: z.literal(SHOW_STEPS_METHOD), params: z.object({ text: z.string(), detail: z.literal(detail) }).strict() }).strict();

/** One stepper whose steps a read matched: its name, what it does, how many of its steps matched, and the read of the
 *  summaries of its steps. A stepper another host declares is named with that host's prefix. */
export const StepperEntrySchema = z
	.object({
		stepper: z.string(),
		description: z.string(),
		steps: z.number(),
		_links: z.object({ steps: readLinkSchema(STEP_DETAIL.summary) }).strict(),
	})
	.strict();
export type TStepperEntry = z.infer<typeof StepperEntrySchema>;

/** A step as a summary states it, linking its definition. */
export const StepSummarySchema = StepDescriptorSchema.pick({ method: true, stepperName: true, pattern: true, description: true, capability: true }).extend({
	_links: z.object({ definition: readLinkSchema(STEP_DETAIL.definition) }).strict(),
});
/** A domain as a summary states it, linking its definition. */
export const DomainSummarySchema = z
	.object({ domain: z.string(), description: z.string().optional(), _links: z.object({ definition: readLinkSchema(STEP_DETAIL.definition) }).strict() })
	.strict();
/** A step as a definition states it, linking its call. */
export const StepDefinitionSchema = StepDescriptorSchema.extend({ _links: z.object({ call: z.object({ method: z.string() }).strict() }).strict() });
export type TStepDefinition = z.infer<typeof StepDefinitionSchema>;

/** What a read of a run's declarations returns at each detail. */
export const StepSummariesSchema = z
	.object({ detail: z.literal(STEP_DETAIL.summary), steppers: z.array(StepperEntrySchema), steps: z.array(StepSummarySchema), domains: z.array(DomainSummarySchema) })
	.strict();
export const StepDefinitionsSchema = z
	.object({
		detail: z.literal(STEP_DETAIL.definition),
		steppers: z.array(StepperEntrySchema),
		steps: z.array(StepDefinitionSchema),
		domains: z.record(z.string(), DomainDiscoveryInfoSchema),
		concerns: ConcernCatalogSchema,
	})
	.strict();
export const StepDiscoverySchema = z.discriminatedUnion("detail", [StepSummariesSchema, StepDefinitionsSchema]);
export type TStepSummaries = z.infer<typeof StepSummariesSchema>;
export type TStepDefinitions = z.infer<typeof StepDefinitionsSchema>;
export type TStepDiscovery = z.infer<typeof StepDiscoverySchema>;

/** The text a caller reads a stepper's steps by: its name and the hyphen that separates a method's stepper from its step. */
export const stepperText = (stepper: string): string => `${stepper}-`;

/** The read of the summaries of a stepper's steps. */
export const stepperStepsLink = (stepper: string) => readOf(stepperText(stepper), STEP_DETAIL.summary);
/** The read of the definitions of the declarations that contain a text. */
export const definitionLink = (text: string) => readOf(text, STEP_DETAIL.definition);

/** What the show steps step does, which its definition states and every caller is told before it asks for anything. */
export const SHOW_STEPS_DESCRIPTION = `Reads what this run declares. The text is matched without regard to case against each step's method, pattern and description, and each domain's name and description; an empty text matches everything. A method names its stepper and a hyphen first, so the text GraphStepper- matches the steps of GraphStepper and of any stepper whose name ends in GraphStepper. The ${STEP_DETAIL.summary} detail names each match, says what it does and links its definition. The ${STEP_DETAIL.definition} detail adds each step's argument and product schemas and links its call, and a step whose definition you read is one you may call. Every result lists the steppers whose steps matched.`;

/** A tool as MCP defines one, which a model provider sends under its own field names. */
export type TToolDefinition = { name: string; description: string; inputSchema: TInputSchema };

/** A step as a tool: its method as the name, its pattern with its description and the capability it requires, and the
 *  schema of its arguments. */
export function toolDefinition(step: TStepDescriptor): TToolDefinition {
	const parts = [step.pattern, step.description, step.capability === undefined ? undefined : `Requires capability ${step.capability}.`];
	return { name: step.method, description: parts.filter((part) => part !== undefined).join("\n\n"), inputSchema: step.inputSchema };
}

/** What a caller is told of a run before it asks for anything: how to read the run's declarations, and each stepper by
 *  its name, what it does and how many steps it declares. An MCP host sends this as its instructions, and a model's turn
 *  states it in its standing instruction. */
export function stepsInstructions(steppers: TStepperEntry[]): string {
	const listed = steppers.map((entry) => `- ${entry.stepper} (${entry.steps} steps): ${entry.description}`).join("\n");
	return `Call ${SHOW_STEPS_METHOD} to find the step a request needs. ${SHOW_STEPS_DESCRIPTION}\n\nThis run's steppers:\n${listed}`;
}
