import { jsonSchemaFor } from "./json-schema-of.js";
import { AStepper, type TStepperStep, type TFeatureStep } from "./astepper.js";
import { runSteppers, type TWorld } from "./world.js";
import { buildConcernCatalog } from "./hypermedia.js";
import { ControlEvent, HYPERMEDIA, STEPS_CHANGED, type TActionResult, type TSeqPath } from "../schema/protocol.js";
import { namedInterpolation, mapInputToStepValues, literalTerm, renderStepLine } from "./namedVars.js";
import { constructorName, actionNotOK } from "./util/index.js";
import { populateActionArgs } from "./populateActionArgs.js";
import { DOMAIN_DOMAIN_KEY, DOMAIN_RECORD_ID, DOMAIN_STATEMENT, paramDomainKey, registeredDomain } from "./domains.js";
import { DOMAIN_PERSISTED_TYPE, isPersisted, withinAccess, type AccessLevel } from "./resources.js";
import { lackedByCall, mayCall, requiredAction, type TCallAuthority } from "./actions.js";
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
 * A registered step tool. Every transport (RPC, MCP, a model's turn) dispatches a step through one.
 */
export type StepTool = {
	/** The step as every caller discovers it. */
	descriptor: TStepDescriptor;
	/** The domain key of each parameter, keyed by parameter name. Validation reads each domain when a call arrives, so it
	 *  reads a domain that a feature declared after the registry was built. */
	paramDomainKeys: Map<string, string>;
	/** The registered stepper-step definition. A proxy tool (RemoteStepperProxy) doesn't have one, since it dispatches out of process. */
	stepDef?: TStepperStep;
	/** Where the step runs: in this process or at a remote host. */
	transport: "local" | "remote";
	/** True if the step action is an async function. The step start event carries it, since an async action's execution time is observable. */
	isAsync: boolean;
	handler: (featureStep: TFeatureStep, world: TWorld) => Promise<TActionResult>;
};

/**
 * A step registry that refresh() rebuilds in place. Every transport (SSE, MCP) reads its steps from it.
 * Call refresh() when the steppers change, without a restart.
 */
export class StepRegistry {
	private tools = new Map<string, StepTool>();
	/** The names of the tools inject() added. refresh() keeps these tools, so a transport (RemoteStepperProxy) registers them
	 *  once and they stay registered across per-feature rebuilds. */
	private injectedNames = new Set<string>();
	/** Every step's descriptor as one JSON text. replace() compares the next registry's text with it to detect a change. */
	private described = "";
	/** The listeners that replace() calls when the registry's steps change. */
	private changeListeners = new Set<() => void>();

	constructor(steppers: AStepper[], world: TWorld) {
		this.refresh(steppers, world);
	}

	/** Rebuild the entries of the given steppers in place. refresh() keeps the injected tools. */
	refresh(steppers: AStepper[], world: TWorld): void {
		const next = buildStepRegistry(steppers, world);
		for (const name of this.injectedNames) {
			const existing = this.tools.get(name);
			if (existing) next.set(name, existing);
		}
		this.replace(next);
	}

	/** Add or replace the steps that a transport dispatches to another process. refresh() keeps these steps. */
	inject(tools: StepTool[]): void {
		const next = new Map(this.tools);
		for (const tool of tools) {
			next.set(tool.descriptor.method, tool);
			this.injectedNames.add(tool.descriptor.method);
		}
		this.replace(next);
	}

	/** Hold the given tools. Call each change listener when their descriptors differ from the previous descriptors. A
	 *  replacement with the same descriptors doesn't call the listeners. */
	private replace(next: Map<string, StepTool>): void {
		this.tools = next;
		const described = JSON.stringify(this.descriptors());
		if (described === this.described) return;
		this.described = described;
		for (const listener of this.changeListeners) listener();
	}

	/** Call `listener` each time the registry's steps change, until the returned function is called. A caller that lists
	 *  the steps to its own clients lists them again, as an MCP server sends its clients a tool list change notification. */
	onChange(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	get(name: string): StepTool | undefined {
		return this.tools.get(name);
	}

	/** The step `name` names. Throws for a step that actuality doesn't register. */
	named(name: string): StepTool {
		const tool = this.tools.get(name);
		if (!tool) throw new Error(`"${name}" isn't a step actuality registers; show steps lists the method names actuality registers`);
		return tool;
	}

	list(): StepTool[] {
		return Array.from(this.tools.values());
	}

	descriptors(): TStepDescriptor[] {
		return this.list().map((tool) => tool.descriptor);
	}

	/** The steps whose required action `held` holds. Every listing of actuality's steps to a caller reads this, so a listing
	 *  shows a caller only the steps it may call. */
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

/** Open actuality's step registry over actuality's steppers. The registry's change listener emits a STEPS_CHANGED control
 *  event on actuality's stream for each change to its steps. A page that read the steps reads them again on that event. */
export function openRunRegistry(world: TWorld, steppers: AStepper[]): StepRegistry {
	const registry = new StepRegistry(steppers, world);
	world.runtime.stepRegistry = registry;
	let changes = 0;
	registry.onChange(() =>
		world.eventLogger.emit(ControlEvent.parse({ id: `${STEPS_CHANGED}-${++changes}`, timestamp: Date.now(), kind: "control", level: "debug", signal: STEPS_CHANGED })),
	);
	return registry;
}

/** Actuality's step registry. It holds every step actuality declares and every step its transports injected. Every caller
 *  of actuality dispatches and discovers steps against it. */
export function runRegistry(world: TWorld): StepRegistry {
	if (!world.runtime.stepRegistry) throw new Error("actuality doesn't hold a step registry");
	return world.runtime.stepRegistry;
}

const HOST_SCOPE = /^host(\d+)_/;

/** The host id a registry key names, or undefined for a step of this process. */
export function hostOfMethodName(name: string): number | undefined {
	const at = name.match(HOST_SCOPE);
	return at ? Number(at[1]) : undefined;
}

/** A host-scoped key without its host prefix. Its own host registers the step under this name, and a caller of that host
 *  writes this name. */
export function bareMethodName(name: string): string {
	return name.replace(HOST_SCOPE, "");
}

/**
 * Registry key for a step routed to a specific hostId: `host{hostId}_{method}`.
 *
 * A caller also uses the key as the step's name. A model's tool name may hold only letters, digits, underscores and
 * hyphens, so the prefix doesn't use other punctuation. The `host` prefix keeps the key from beginning with a digit.
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
	const { inputSchema, paramDomainKeys } = buildInputSchema(stepperName, stepName, stepDef, world);
	if (stepDef.productsOf !== undefined && paramDomainKeys.get(stepDef.productsOf) !== DOMAIN_STATEMENT)
		throw new Error(`step ${stepperName}.${stepName}: productsOf names {${stepDef.productsOf}}, which isn't a statement its phrase takes`);
	assertRecordIds(`step ${stepperName}.${stepName}`, stepDef, paramDomainKeys);
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
			...(stepDef.recordIds ? { recordIds: stepDef.recordIds } : {}),
			...(stepDef.recordData ? { recordData: stepDef.recordData } : {}),
			capability: requiredAction(stepperName, stepName, stepDef),
			...(stepDef.readsAt ? { readsAt: stepDef.readsAt } : {}),
			read: stepDef.read === true,
			fallback: stepDef.fallback === true,
			answersTheTurn: stepDef.answersTheTurn === true,
			...(stepDef.answeredBy ? { answeredBy: stepDef.answeredBy } : {}),
			inputSchema,
			outputSchema,
		},
		paramDomainKeys,
		stepDef,
		transport: "local",
		isAsync: stepDef.action.constructor.name === "AsyncFunction",
		handler: createStepHandler(stepperName, stepName, stepDef),
	};
}

/** The domains of a parameter that names a record's type. */
const TYPE_NAMING_DOMAINS: readonly string[] = [DOMAIN_PERSISTED_TYPE, DOMAIN_DOMAIN_KEY];

/** Throws unless the step's record pairings hold. recordIds pairs each `record-id` parameter with a parameter that names
 *  its record's type. recordData pairs a parameter the phrase takes with a parameter that names its record's type. */
function assertRecordIds(step: string, stepDef: TStepperStep, paramDomainKeys: Map<string, string>): void {
	for (const [id, type] of Object.entries(stepDef.recordIds ?? {})) {
		if (paramDomainKeys.get(id) !== DOMAIN_RECORD_ID) throw new Error(`${step}: recordIds names {${id}}, which isn't a ${DOMAIN_RECORD_ID} its phrase takes`);
		if (!TYPE_NAMING_DOMAINS.includes(paramDomainKeys.get(type) ?? "")) throw new Error(`${step}: recordIds pairs {${id}} with {${type}}, which doesn't name a type`);
	}
	for (const [param, domain] of paramDomainKeys)
		if (domain === DOMAIN_RECORD_ID && stepDef.recordIds?.[param] === undefined)
			throw new Error(`${step}: {${param}} is a ${DOMAIN_RECORD_ID} that its recordIds doesn't pair with a type`);
	for (const [data, type] of Object.entries(stepDef.recordData ?? {})) {
		if (!paramDomainKeys.has(data)) throw new Error(`${step}: recordData names {${data}}, which its phrase doesn't take`);
		if (!TYPE_NAMING_DOMAINS.includes(paramDomainKeys.get(type) ?? "")) throw new Error(`${step}: recordData pairs {${data}} with {${type}}, which doesn't name a type`);
	}
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
 * All callers (feature loop, FlowRunner, RPC, MCP) use the same signature.
 * External transports build a synthetic featureStep before calling.
 */
export function createStepHandler(stepperName: string, stepName: string, stepDef: TStepperStep): (featureStep: TFeatureStep, world: TWorld) => Promise<TActionResult> {
	return async (featureStep: TFeatureStep, world: TWorld): Promise<TActionResult> => {
		try {
			const args = await populateActionArgs(featureStep, world, runSteppers(world));
			const result = await stepDef.action(args, featureStep);
			// A failed result states its reason in errorMessage. Code that the types don't check can omit it, and that failure
			// is replaced by one that names the step.
			if (!result.ok && typeof result.errorMessage !== "string") throw new Error(`${stepperName}.${stepName} failed without stating why`);
			// Products are validated here, where args is resolved, since a statement the step ran names the domain of the
			// products the step passes on.
			const productsError = result.ok ? validateProducts(stepperName, stepName, stepDef, world, result.products, args) : undefined;
			return productsError ? actionNotOK(productsError) : result;
		} catch (caught) {
			// A thrown error becomes a failed result that carries the error's message, as a returned failure carries its
			// errorMessage. The code that presents the failure names the step, as an RPC response names its method.
			return actionNotOK(caught instanceof Error ? caught.message : String(caught));
		}
	};
}

/**
 * Build a TFeatureStep for a call from a transport (RPC, MCP).
 * Feature-file dispatch already holds one. This function constructs it from the tool and
 * the raw input. It uses the registered stepDef, so dispatch (augment, autoAssert,
 * preconditions) receives the same shape from both paths.
 */
export function buildFeatureStepForTransport(tool: StepTool, input: Record<string, unknown>, seqPath: TSeqPath): TFeatureStep {
	// A proxy tool (RemoteStepperProxy) dispatches out of process and doesn't have a local stepDef. The carrier holds the
	// step's pattern and an action that returns a failure, so the handler can run.
	const { descriptor } = tool;
	const step = tool.stepDef ?? ({ gwta: descriptor.pattern, action: () => actionNotOK(`${descriptor.method} doesn't have an in-process stepDef`) } as TStepperStep);
	// A tool of another host is registered under a host-scoped name. Its stepper and step names are the names that host
	// registers. Dispatch resolves a step by those names. A call to a remote tool without targetHostId resolves the local
	// step of the same name and runs it in this process.
	const targetHostId = hostOfMethodName(descriptor.method);
	return {
		...(targetHostId === undefined ? {} : { targetHostId }),
		// `in` holds the feature line that states this call, so the record of a call from outside actuality is a line a feature can run.
		in: renderStepLine(descriptor.pattern, Object.fromEntries(Object.entries(input).map(([name, value]) => [name, literalTerm(value, descriptor.paramDomains[name])]))),
		action: { stepperName: descriptor.stepperName, actionName: descriptor.stepName, step, stepValuesMap: mapInputToStepValues(input, descriptor.pattern) },
		seqPath,
		programmatic: true,
	};
}

/**
 * The domain of each parameter that a step's phrase names, as `{name: domain}`. A parameter whose domain the phrase doesn't
 * name takes `string`. A step's schemas, the typed step graph and dispatch all read its input domains through this function.
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
 * Build the JSON Schema of a step's input parameters for discovery.
 * jsonSchemaFor converts each Zod domain schema into a full JSON Schema
 * (enums, object structures, descriptions) for MCP and SSE consumers.
 * Returns the JSON Schema and each parameter's domain key. Validation reads each domain by its key at call time.
 */
function buildInputSchema(stepperName: string, stepName: string, stepDef: TStepperStep, world: TWorld): { inputSchema: TInputSchema; paramDomainKeys: Map<string, string> } {
	const properties: TInputSchema["properties"] = {};
	const required: string[] = [];
	const paramDomainKeys = stepParamDomains(stepDef);

	for (const [term, domainKey] of paramDomainKeys) {
		const domain = registeredDomain(world.domains, domainKey, `step ${stepperName}.${stepName}: {${term}}`);
		// The schema describes what a caller must supply, so defaulted fields are optional.
		const jsonSchema = jsonSchemaFor(`step ${stepperName}.${stepName}: {${term}}'s domain "${domainKey}"`, domain.schema, "input");
		properties[term] = domain.description && !jsonSchema.description ? { ...jsonSchema, description: domain.description } : { ...jsonSchema };
		required.push(term);
	}

	return { inputSchema: { type: "object" as const, properties, required }, paramDomainKeys };
}

/** Refuse a call that its caller may not make. A call is refused where it didn't invoke the step's action, or where its
 *  caller doesn't hold a read at the step's `readsAt` level. A call is also refused where the read in force is narrower
 *  than the step's `readsAt` level. */
export function authorizeToolCapability(step: Pick<TStepDescriptor, "method" | "capability" | "readsAt">, call: TCallAuthority, readsIn?: AccessLevel): void {
	const lacked = lackedByCall(call, step);
	if (lacked) throw new Error(namedRefusal(step.method, lacked));
	if (step.readsAt && readsIn && !withinAccess(step.readsAt, readsIn)) throw new Error(`${step.method} reads at ${step.readsAt}, and this call reads at ${readsIn}`);
}

/** A refusal that names the action the step requires. A caller can request that action from a holder. */
const namedRefusal = (method: string, required: string): string => `${method}: capability ${required} required`;

/**
 * The refusal that a caller from outside actuality receives. A caller that proved a key receives a refusal that names the
 * action the step requires, or states that the step doesn't exist, since that caller can request the action from a
 * holder. A caller that didn't prove a key receives only a statement that it may not make the call. That refusal is the
 * same whether the step exists or not, so it doesn't reveal which steps actuality registers.
 */
export function refusal(method: string, required: string | undefined, principal: string | undefined): string {
	if (!principal) return `${method}: not a call this caller may make`;
	return required ? namedRefusal(method, required) : `${method}: unknown step method`;
}

/** Each stepper that the steps name, in the order the steps name them. Each entry holds the stepper's description, the
 *  number of its steps in `steps` and the link that reads the summaries of its steps. A stepper that another host declares
 *  is named with that host's prefix. steppersOf returns every stepper of actuality when it reads every step of a
 *  registry. discoverSteps returns this list with the steps that matched. */
export function steppersOf(steps: TStepDescriptor[]): TStepperSummary[] {
	const byStepper = new Map<string, TStepperSummary>();
	for (const step of steps) {
		const host = hostOfMethodName(step.method);
		const stepper = host === undefined ? step.stepperName : hostScopedMethodName(host, step.stepperName);
		const entry = byStepper.get(stepper);
		if (entry) entry.steps += 1;
		else byStepper.set(stepper, { stepper, description: step.stepperDescription, steps: 1, [HYPERMEDIA.LINKS]: { steps: stepperStepsLink(stepper) } });
	}
	return [...byStepper.values()];
}

/**
 * What actuality declares to a caller. The result holds each step and each domain whose text contains the query's text,
 * compared without regard to case. It also holds the steppers of the matched steps. A step's texts are its method, its
 * pattern and its description, so a stepper's name and a hyphen match that stepper's steps. A domain's texts are its
 * name and its description.
 *
 * A step is shown only to a caller that holds the action it requires, so a caller isn't shown a step it may not call.
 * Every matching domain is shown whatever the caller holds, since a record can't be read without the declaration of its
 * type. The registry is actuality's registry, which holds the steps a transport injected.
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

/** A registered domain as a read of actuality's declarations states it. It holds the domain's enum values where its schema
 *  states them. It holds the domain's ui without the component's source. A client loads the source from the URL the
 *  domain names. */
function domainDiscoveryInfo(key: string, domain: TWorld["domains"][string]): TDomainDiscoveryInfo {
	const enumerated = domain.values ? undefined : jsonSchemaFor(`domain "${key}"`, domain.schema, "input").enum;
	const values = domain.values ?? (Array.isArray(enumerated) ? (enumerated as string[]) : undefined);
	const ui = domain.ui ? (({ jsContent: _source, ...rest }) => rest)(domain.ui) : undefined;
	return { description: domain.description, values, stepperName: domain.stepperName, persistedAs: isPersisted(domain.topology) ? domain.topology.persistedAs : undefined, ui };
}
