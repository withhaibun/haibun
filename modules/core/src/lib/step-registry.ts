import { z } from "zod";
import { jsonSchemaOf } from "./json-schema-of.js";
import { AStepper, type TStepperStep, type TFeatureStep } from "./astepper.js";
import type { TWorld } from "./world.js";
import { buildConcernCatalog } from "./hypermedia.js";
import { ControlEvent, STEPS_CHANGED, type TActionResult, type TSeqPath } from "../schema/protocol.js";
import { namedInterpolation, mapInputToStepValues } from "./namedVars.js";
import { constructorName, actionNotOK } from "./util/index.js";
import { populateActionArgs } from "./populateActionArgs.js";
import { DOMAIN_STATEMENT, paramDomainKey } from "./domains.js";
import { zodTypeLabel } from "./composite-domain.js";
import { isPersisted } from "./resources.js";
import { mayCall, requiredAction } from "./actions.js";
import { resolveOutputSchema, validateProducts } from "./tool-validation.js";
import {
	STEP_DETAIL,
	containsText,
	domainSummary,
	stepDefinition,
	stepSummary,
	stepperStepsLink,
	type TDomainDiscoveryInfo,
	type TInputSchema,
	type TStepDefinitions,
	type TStepDescriptor,
	type TStepSummaries,
	type TStepperSummary,
	type TStepsQuery,
} from "./step-discovery.js";

/**
 * A registered step tool: the unit of dispatch for any transport (RPC, MCP, a model's turn, a subprocess).
 */
export type StepTool = {
	/** The step as every caller discovers it. */
	descriptor: TStepDescriptor;
	/** Zod schemas for each input parameter, keyed by parameter name. Used for runtime validation. */
	paramSchemas: Map<string, z.ZodType>;
	/** Domain key for each parameter, keyed by parameter name. Used for domain.coerce() after Zod validation. */
	paramDomainKeys: Map<string, string>;
	/** The registered stepper-step definition. Absent for proxy tools (RemoteStepperProxy, subprocess), which dispatch out of process. */
	stepDef?: TStepperStep;
	/** Where the step runs: in this process, at a remote host, or in a subprocess. */
	transport: "local" | "remote" | "subprocess";
	/** True if the step action is an async function (observable execution time). */
	isAsync: boolean;
	handler: (featureStep: TFeatureStep, world: TWorld) => Promise<TActionResult>;
};

/**
 * Live-refreshable step registry. Single source of truth for all transports (SSE, MCP, subprocess).
 * Call refresh() to rebuild in-place when steppers change without restarting.
 */
export class StepRegistry {
	private tools = new Map<string, StepTool>();
	/** Names injected via inject(), which survive refresh() so transports (RemoteStepperProxy, subprocess) register once and stay live across per-feature rebuilds. */
	private injectedNames = new Set<string>();
	/** Every step's description as one text, which a change to the registry is compared by. */
	private described = "";
	/** What is told when the registry's steps change. */
	private changeListeners = new Set<() => void>();

	constructor(steppers: AStepper[], world: TWorld) {
		this.refresh(steppers, world);
	}

	/** Rebuild stepper-owned entries in-place. Injected tools are preserved. */
	refresh(steppers: AStepper[], world: TWorld): void {
		const next = buildStepRegistry(steppers, world);
		for (const name of this.injectedNames) {
			const existing = this.tools.get(name);
			if (existing) next.set(name, existing);
		}
		this.replace(next);
	}

	/** Add or replace the steps a transport reaches in another process, which survive refresh(). */
	inject(tools: StepTool[]): void {
		const next = new Map(this.tools);
		for (const tool of tools) {
			next.set(tool.descriptor.method, tool);
			this.injectedNames.add(tool.descriptor.method);
		}
		this.replace(next);
	}

	/** Hold the tools given, and announce them where they describe the steps differently. A change that describes every
	 *  step as it was is not announced. */
	private replace(next: Map<string, StepTool>): void {
		this.tools = next;
		const described = JSON.stringify(this.descriptors());
		if (described === this.described) return;
		this.described = described;
		for (const listener of this.changeListeners) listener();
	}

	/** Tell `listener` each time the registry's steps change, until the returned function is called. A caller that lists
	 *  the steps to its own clients lists them again, as an MCP server tells its clients the tool list changed. */
	onChange(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	get(name: string): StepTool | undefined {
		return this.tools.get(name);
	}

	list(): StepTool[] {
		return Array.from(this.tools.values());
	}

	descriptors(): TStepDescriptor[] {
		return this.list().map((tool) => tool.descriptor);
	}

	/** The steps a caller holding `held` is shown: those it holds what they require for. Every listing of a run's steps to
	 *  a caller reads this, so a caller learns what it may call and nothing it may not. */
	heldBy(held: string | string[] | undefined): TStepDescriptor[] {
		return this.descriptors().filter((step) => mayCall(held, step));
	}

	get size(): number {
		return this.tools.size;
	}

	has(name: string): boolean {
		return this.tools.has(name);
	}
}

/** Open the run's step registry over the run's steppers. The run signals on its stream each time the registry's steps
 *  change, and a page that read them reads them again. */
export function openRunRegistry(world: TWorld, steppers: AStepper[]): StepRegistry {
	const registry = new StepRegistry(steppers, world);
	world.runtime.stepRegistry = registry;
	let changes = 0;
	registry.onChange(() =>
		world.eventLogger.emit(ControlEvent.parse({ id: `${STEPS_CHANGED}-${++changes}`, timestamp: Date.now(), kind: "control", level: "debug", signal: STEPS_CHANGED })),
	);
	return registry;
}

/** The run's step registry, which holds every step the run declares and every step its transports injected. Every caller
 *  of the run dispatches and discovers against it. */
export function runRegistry(world: TWorld): StepRegistry {
	if (!world.runtime.stepRegistry) throw new Error("the run holds no step registry");
	return world.runtime.stepRegistry;
}

const HOST_SCOPE = /^host(\d+)_/;

/** The host a registry key belongs to, or undefined for a step of this process's own. */
export function hostOfMethodName(name: string): number | undefined {
	const at = name.match(HOST_SCOPE);
	return at ? Number(at[1]) : undefined;
}

/** A host-scoped key under the name its own host knows it by, which is what a caller of that host writes. */
export function bareMethodName(name: string): string {
	return name.replace(HOST_SCOPE, "");
}

/**
 * Registry key for a step routed at a specific hostId: `host{hostId}_{method}`.
 *
 * The key is also the name a caller uses, and a model's tool name may hold only letters, digits, underscores and
 * hyphens, so it is written with none of the punctuation a prefix would otherwise reach for. `host` in front keeps it
 * a name rather than something beginning with a digit.
 */
export function hostScopedMethodName(hostId: number, bareMethod: string): string {
	return `host${hostId}_${bareMethod}`;
}

/**
 * Build a registry of step tools from the given steppers.
 * Each key is `${stepperName}-${stepName}` (e.g. `ExampleStepper-getTypes`).
 */
export function buildStepRegistry(steppers: AStepper[], world: TWorld): Map<string, StepTool> {
	const registry = new Map<string, StepTool>();
	for (const stepper of steppers) {
		for (const [stepName, stepDef] of Object.entries(stepper.steps)) {
			const tool = createStepTool(stepper, stepName, stepDef, world);
			registry.set(tool.descriptor.method, tool);
		}
	}
	return registry;
}

export function createStepTool(stepper: AStepper, stepName: string, stepDef: TStepperStep, world: TWorld): StepTool {
	const stepperName = constructorName(stepper);
	const { inputSchema, paramSchemas, paramDomainKeys } = buildInputSchema(stepperName, stepName, stepDef, world);
	if (stepDef.productsOf !== undefined && paramDomainKeys.get(stepDef.productsOf) !== DOMAIN_STATEMENT)
		throw new Error(`step ${stepperName}.${stepName}: productsOf names {${stepDef.productsOf}}, which is no statement its phrase takes`);
	const resolvedOutputSchema = resolveOutputSchema(stepperName, stepName, stepDef, world);
	const outputSchema = resolvedOutputSchema ? jsonSchemaFor(`step ${stepperName}.${stepName}: its products schema`, resolvedOutputSchema, "output") : undefined;
	return {
		descriptor: {
			method: stepMethodName(stepperName, stepName),
			stepperName,
			stepperDescription: stepper.description,
			stepName,
			pattern: stepDef.gwta || stepDef.exact || stepDef.match?.toString() || stepName,
			description: stepDef.description,
			paramDomains: Object.fromEntries(paramDomainKeys),
			productsDomain: stepDef.productsDomain,
			productsOf: stepDef.productsOf,
			capability: requiredAction(stepperName, stepName, stepDef),
			read: stepDef.read === true,
			fallback: stepDef.fallback === true,
			answersTheTurn: stepDef.answersTheTurn === true,
			inputSchema,
			outputSchema,
		},
		paramSchemas,
		paramDomainKeys,
		stepDef,
		transport: "local",
		isAsync: stepDef.action.constructor.name === "AsyncFunction",
		handler: createStepHandler(stepperName, stepName, stepDef),
	};
}

/**
 * Generate the canonical RPC method name for a step.
 * Used by both server (registry keys) and client (typed imports).
 *
 * Accepts either a stepper class/instance or a stepper name string.
 */
export function stepMethodName(stepperOrName: string | AStepper | { name: string }, stepName: string): string {
	const name = typeof stepperOrName === "string" ? stepperOrName : "steps" in stepperOrName ? constructorName(stepperOrName as AStepper) : stepperOrName.name;
	return `${name}-${stepName}`;
}

/**
 * Create a handler that populates args from featureStep.action.stepValuesMap,
 * calls stepDef.action, and returns TActionResult.
 *
 * All callers (feature loop, FlowRunner, RPC, MCP, subprocess) use the same signature.
 * External transports build a synthetic featureStep before calling.
 */
export function createStepHandler(stepperName: string, stepName: string, stepDef: TStepperStep): (featureStep: TFeatureStep, world: TWorld) => Promise<TActionResult> {
	return async (featureStep: TFeatureStep, world: TWorld): Promise<TActionResult> => {
		try {
			const args = await populateActionArgs(featureStep, world, world.runtime.steppers);
			const result = await stepDef.action(args, featureStep);
			// Checked where the arguments were resolved, since a statement the step ran names the domain of what it passes on.
			const productsError = result.ok ? validateProducts(stepperName, stepName, stepDef, world, result.products, args) : undefined;
			return productsError ? actionNotOK(productsError) : result;
		} catch (caught) {
			// A step that throws fails as a step that refuses does: with what it said. Whoever presents the failure names the
			// step, as an RPC answer names its method.
			return actionNotOK(caught instanceof Error ? caught.message : String(caught));
		}
	};
}

/**
 * Build a TFeatureStep for a transport-originated call (RPC, MCP, subprocess).
 * Feature-file dispatch already has one; transports construct it from the tool +
 * raw input. Uses the same registered stepDef so downstream dispatch (augment,
 * autoAssert, preconditions) sees the identical shape both paths produce.
 */
export function buildFeatureStepForTransport(tool: StepTool, input: Record<string, unknown>, seqPath: TSeqPath): TFeatureStep {
	// Proxy tools (RemoteStepperProxy, subprocess) dispatch out-of-process and have no
	// local stepDef. Construct a carrier with just the description so the handler can run.
	const { descriptor } = tool;
	const step = tool.stepDef ?? ({ gwta: descriptor.pattern, action: () => actionNotOK(`no in-process stepDef for ${descriptor.method}`) } as TStepperStep);
	// A tool of another host is registered under that host and named for it, while its stepper and step names are the
	// ones that host knows. Dispatch resolves a step by those names, so without the host here a call by name of a
	// remote tool finds the local step of the same name and answers from this process.
	const targetHostId = hostOfMethodName(descriptor.method);
	return {
		...(targetHostId === undefined ? {} : { targetHostId }),
		in: descriptor.pattern,
		action: {
			stepperName: descriptor.stepperName,
			actionName: descriptor.stepName,
			step,
			stepValuesMap: mapInputToStepValues(input, descriptor.pattern),
		},
		seqPath,
		programmatic: true,
	};
}

/**
 * The domain of each parameter a step's phrase names, by parameter: `{name: domain}`, or `string` where the phrase names
 * none. The one reading of a step's input domains, which its schemas, the typed step graph and dispatch all take.
 */
export function stepParamDomains(stepDef: TStepperStep): Map<string, string> {
	const domains = new Map<string, string>();
	if (!stepDef.gwta) return domains;
	for (const v of Object.values(namedInterpolation(stepDef.gwta).stepValuesMap ?? {})) {
		domains.set(v.term, paramDomainKey(v.domain));
	}
	return domains;
}

/**
 * A schema as JSON Schema, for discovery, MCP and forms: what a caller supplies, or what a step answers. A date is an ISO
 * date-time string, and a type with no JSON Schema form is refused at registration, naming `subject`, what declares it.
 */
function jsonSchemaFor(subject: string, schema: z.ZodType, io: "input" | "output"): Record<string, unknown> {
	return jsonSchemaOf(
		schema,
		io,
		() =>
			z.toJSONSchema(schema, {
				io,
				unrepresentable: "any",
				override: (ctx) => {
					const nodeType = zodTypeLabel(ctx.zodSchema);
					if (nodeType === "date") {
						ctx.jsonSchema.type = "string";
						ctx.jsonSchema.format = "date-time";
						return;
					}
					if (nodeType && UNREPRESENTABLE_ZOD_TYPES.has(nodeType)) {
						throw new Error(`${subject} declares a "${nodeType}" field, which has no JSON Schema form; declare a representable type`);
					}
				},
			}) as Record<string, unknown>,
	);
}

/** Zod types with no JSON Schema representation (dates excepted: they surface as string/date-time). A domain
 * declaring one of these has no form and no client-side validation surface, so registration throws. */
const UNREPRESENTABLE_ZOD_TYPES = new Set(["bigint", "symbol", "undefined", "void", "never", "function", "map", "set", "promise", "custom", "file"]);

/**
 * Build a JSON Schema and Zod param schemas for a step's input parameters.
 * Uses z.toJSONSchema() to convert Zod domain schemas into full JSON Schema
 * (enums, object structures, descriptions, etc.) for MCP and SSE consumers.
 * Returns both the JSON Schema (for documentation/discovery) and the Zod schemas (for runtime validation).
 */
function buildInputSchema(
	stepperName: string,
	stepName: string,
	stepDef: TStepperStep,
	world: TWorld,
): { inputSchema: TInputSchema; paramSchemas: Map<string, z.ZodType>; paramDomainKeys: Map<string, string> } {
	const properties: TInputSchema["properties"] = {};
	const required: string[] = [];
	const paramSchemas = new Map<string, z.ZodType>();
	const paramDomainKeys = stepParamDomains(stepDef);

	for (const [term, domainKey] of paramDomainKeys) {
		const domain = world.domains?.[domainKey];
		if (!domain) {
			throw new Error(
				`step ${stepperName}.${stepName}: {${term}} names the domain "${domainKey}", which no loaded stepper registers. A parameter's domain is one a stepper declares in getConcerns, or a union of them registered as one.`,
			);
		}
		paramSchemas.set(term, domain.schema);
		// The schema describes what a caller must supply, so defaulted fields are optional.
		const jsonSchema = jsonSchemaFor(`step ${stepperName}.${stepName}: {${term}}'s domain "${domainKey}"`, domain.schema, "input");
		properties[term] = domain.description && !jsonSchema.description ? { ...jsonSchema, description: domain.description } : { ...jsonSchema };
		required.push(term);
	}

	return { inputSchema: { type: "object" as const, properties, required }, paramSchemas, paramDomainKeys };
}

export function authorizeToolCapability(step: Pick<TStepDescriptor, "method" | "capability">, granted?: string | string[]): void {
	if (mayCall(granted, step)) return;
	throw new Error(namedRefusal(step.method, step.capability));
}

/** A refusal naming the action the step requires, which a caller can ask a holder for. */
const namedRefusal = (method: string, required: string): string => `${method}: capability ${required} required`;

/**
 * What a caller from outside the run is told when its call is refused. A caller that proved a key is told the action the
 * step requires, or that no such step exists, since it can ask a holder for what it lacks. A caller that proved none is
 * told only that it may not make the call, alike whether the step exists or not, so no refusal maps the run for it.
 */
export function refusal(method: string, required: string | undefined, principal: string | undefined): string {
	if (!principal) return `${method}: not a call this caller may make`;
	return required ? namedRefusal(method, required) : `${method}: unknown step method`;
}

/** Each stepper the steps name, in the order the steps name them, with its description, the number of its steps among
 *  them and the read of the summaries of its steps. A stepper another host declares is named with that host's prefix.
 *  Every step of a registry names every stepper of the run, which a caller is told before it asks for anything. */
export function steppersOf(steps: TStepDescriptor[]): TStepperSummary[] {
	const byStepper = new Map<string, TStepperSummary>();
	for (const step of steps) {
		const host = hostOfMethodName(step.method);
		const stepper = host === undefined ? step.stepperName : hostScopedMethodName(host, step.stepperName);
		const entry = byStepper.get(stepper);
		if (entry) entry.steps += 1;
		else byStepper.set(stepper, { stepper, description: step.stepperDescription, steps: 1, _links: { steps: stepperStepsLink(stepper) } });
	}
	return [...byStepper.values()];
}

/**
 * What a run declares to a caller: each step it holds and each domain whose text contains the query's text, compared
 * without regard to case, and the steppers of the steps that matched. A step's texts are its method, its pattern and its
 * description, so a stepper's name and a hyphen read that stepper's steps; a domain's texts are its name and its
 * description.
 *
 * A step is shown only to a caller holding what it requires, so a caller learns what it may call and nothing it may not.
 * Every domain is shown, since a record can't be read without the declaration of its type. The registry is the run's,
 * which holds the steps a transport injected.
 */
export function discoverSteps(
	world: TWorld,
	registry: StepRegistry,
	query: TStepsQuery & { detail: typeof STEP_DETAIL.summary },
	held: string | string[] | undefined,
): TStepSummaries;
export function discoverSteps(
	world: TWorld,
	registry: StepRegistry,
	query: TStepsQuery & { detail: typeof STEP_DETAIL.definition },
	held: string | string[] | undefined,
): TStepDefinitions;
export function discoverSteps(world: TWorld, registry: StepRegistry, query: TStepsQuery, held: string | string[] | undefined): TStepSummaries | TStepDefinitions;
export function discoverSteps(world: TWorld, registry: StepRegistry, query: TStepsQuery, held: string | string[] | undefined): TStepSummaries | TStepDefinitions {
	const steps = registry.heldBy(held).filter((step) => containsText([step.method, step.pattern, step.description], query.text));
	const steppers = steppersOf(steps);
	const domains = Object.entries(world.domains).filter(([key, domain]) => containsText([key, domain.description], query.text));
	if (query.detail === STEP_DETAIL.summary) {
		return {
			detail: STEP_DETAIL.summary,
			steppers,
			steps: steps.map(stepSummary),
			domains: Object.fromEntries(domains.map(([key, { description }]) => [key, domainSummary(key, description)])),
		};
	}
	const catalog = buildConcernCatalog(world.domains);
	return {
		detail: STEP_DETAIL.definition,
		steppers,
		steps: steps.map(stepDefinition),
		domains: Object.fromEntries(domains.map(([key, domain]) => [key, domainDiscoveryInfo(key, domain)])),
		concerns: {
			persisted: Object.fromEntries(Object.entries(catalog.persisted).filter(([label, concern]) => containsText([label, concern.description], query.text))),
			references: Object.fromEntries(Object.entries(catalog.references).filter(([key, reference]) => containsText([key, reference.targetDomain], query.text))),
		},
	};
}

/** A registered domain as a read of a run's declarations states it: its enum values where its schema states them, and
 *  how it presents itself without the component's source, which a client loads from the URL the domain names. */
function domainDiscoveryInfo(key: string, domain: TWorld["domains"][string]): TDomainDiscoveryInfo {
	const enumerated = domain.values ? undefined : jsonSchemaFor(`domain "${key}"`, domain.schema, "input").enum;
	const values = domain.values ?? (Array.isArray(enumerated) ? (enumerated as string[]) : undefined);
	const ui = domain.ui ? (({ jsContent: _source, ...rest }) => rest)(domain.ui as Record<string, unknown> & { jsContent?: string }) : undefined;
	return {
		description: domain.description,
		values,
		stepperName: domain.stepperName,
		persistedAs: isPersisted(domain.topology) ? domain.topology.persistedAs : undefined,
		ui,
	};
}
