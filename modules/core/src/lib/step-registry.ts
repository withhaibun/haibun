import { z } from "zod";
import { AStepper, type TStepperStep, type TFeatureStep } from "./astepper.js";
import type { TWorld } from "./world.js";
import { buildConcernCatalog, type TConcernCatalog } from "./hypermedia.js";
import type { TActionResult, TSeqPath } from "../schema/protocol.js";
import { namedInterpolation, mapInputToStepValues } from "./namedVars.js";
import { constructorName, actionNotOK } from "./util/index.js";
import { populateActionArgs } from "./populateActionArgs.js";
import { DOMAIN_STRING, normalizeDomainKey } from "./domains.js";
import { zodTypeLabel } from "./composite-domain.js";
import { StepperRegistry, type StepDescriptor } from "./stepper-registry.js";
import { isPersisted } from "./resources.js";
import { resolveOutputSchema } from "./tool-validation.js";

/**
 * A registered step tool — the unit of dispatch for any transport (MCP, SSE, etc.).
 */
export type StepTool = {
	name: string;
	description: string;
	inputSchema: StepToolInputSchema;
	/** Zod schemas for each input parameter, keyed by parameter name. Used for runtime validation. */
	paramSchemas: Map<string, z.ZodType>;
	/** Domain key for each parameter, keyed by parameter name. Used for domain.coerce() after Zod validation. */
	paramDomainKeys: Map<string, string>;
	/** JSON Schema describing the products this step returns. Built from the step's productsDomain, productsDomains, or productsSchema. */
	outputSchema?: Record<string, unknown>;
	stepperName: string;
	stepName: string;
	/** The registered stepper-step definition. Carries productsDomain, productsDomains, productsSchema, capability, gwta, etc.
	 * Absent for proxy tools (RemoteStepperProxy, subprocess) where dispatch happens out-of-process. */
	stepDef?: TStepperStep;
	/**
	 * Optional capability label for permission gating (ZCAP-LD hook).
	 * Transports check this before dispatching. e.g. "GraphStepper:read", "LlmStepper:*"
	 */
	capability?: string;
	/** Transport type — set by proxy transports (remote, subprocess). Defaults to "local". */
	transport?: "local" | "remote" | "subprocess";
	/** Remote host URL — set by RemoteStepperProxy for dispatch tracing. */
	remoteHost?: string;
	/** True if the step action is an async function (observable execution time). */
	isAsync: boolean;
	handler: (featureStep: TFeatureStep, world: TWorld) => Promise<TActionResult>;
};

export type StepToolInputSchema = {
	type: "object";
	properties?: Record<string, { type?: string; description?: string; [key: string]: unknown }>;
	required?: string[];
	[key: string]: unknown;
};

/**
 * Live-refreshable step registry. Single source of truth for all transports (SSE, MCP, subprocess).
 * Call refresh() to rebuild in-place when steppers change without restarting.
 */
export class StepRegistry {
	private tools = new Map<string, StepTool>();
	/** Names injected via set() — survive refresh() so transports (RemoteStepperProxy, subprocess) register once and stay live across per-feature rebuilds. */
	private injectedNames = new Set<string>();

	constructor(steppers: AStepper[], world: TWorld) {
		this.refresh(steppers, world);
	}

	/** Rebuild stepper-owned entries in-place. Externally-injected tools (via set()) are preserved. */
	refresh(steppers: AStepper[], world: TWorld): void {
		const next = buildStepRegistry(steppers, world);
		for (const name of this.injectedNames) {
			const existing = this.tools.get(name);
			if (existing) next.set(name, existing);
		}
		this.tools = next;
	}

	get(name: string): StepTool | undefined {
		return this.tools.get(name);
	}

	list(): StepTool[] {
		return Array.from(this.tools.values());
	}

	get size(): number {
		return this.tools.size;
	}

	has(name: string): boolean {
		return this.tools.has(name);
	}

	/** Inject or overwrite a single tool (used by transports to register remote/child steps). Survives refresh(). */
	set(tool: StepTool): void {
		this.tools.set(tool.name, tool);
		this.injectedNames.add(tool.name);
	}

	/** Remove an injected tool. Used by transport detach(). */
	unset(name: string): void {
		this.tools.delete(name);
		this.injectedNames.delete(name);
	}
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
 * All steps are included. MCP filters `exposeMCP: false` separately.
 */
export function buildStepRegistry(steppers: AStepper[], world: TWorld): Map<string, StepTool> {
	const registry = new Map<string, StepTool>();

	for (const stepper of steppers) {
		const stepperName = constructorName(stepper);

		for (const [stepName, stepDef] of Object.entries(stepper.steps)) {
			const tool = createStepTool(stepperName, stepName, stepDef, world);
			registry.set(tool.name, tool);
		}
	}

	return registry;
}

export function createStepTool(stepperName: string, stepName: string, stepDef: TStepperStep, world: TWorld): StepTool {
	const { inputSchema, paramSchemas, paramDomainKeys } = buildInputSchema(stepDef, world);
	const name = stepMethodName(stepperName, stepName);
	validateInputDomains(stepperName, stepName, stepDef, paramDomainKeys);
	const resolvedOutputSchema = resolveOutputSchema(stepperName, stepName, stepDef, world);
	let outputSchema: Record<string, unknown> | undefined;
	if (resolvedOutputSchema) {
		try {
			outputSchema = z.toJSONSchema(resolvedOutputSchema) as Record<string, unknown>;
		} catch {
			/* skip if schema can't be converted */
		}
	}

	return {
		name,
		description: stepDef.gwta || stepName,
		inputSchema,
		paramSchemas,
		paramDomainKeys,
		outputSchema,
		stepperName,
		stepName,
		stepDef,
		capability: stepDef.capability,
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
			return await stepDef.action(args, featureStep);
		} catch (caught) {
			const err = caught instanceof Error ? caught : new Error(String(caught));
			return actionNotOK(`${stepperName}-${stepName}: ${err.message}`);
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
	const step = tool.stepDef ?? ({ gwta: tool.description, action: () => actionNotOK(`no in-process stepDef for ${tool.name}`) } as TStepperStep);
	// A tool of another host is registered under that host and named for it, while its stepper and step names are the
	// ones that host knows. Dispatch resolves a step by those names, so without the host here a call by name of a
	// remote tool finds the local step of the same name and answers from this process.
	const targetHostId = hostOfMethodName(tool.name);
	return {
		...(targetHostId === undefined ? {} : { targetHostId }),
		in: tool.description,
		action: {
			stepperName: tool.stepperName,
			actionName: tool.stepName,
			step,
			stepValuesMap: mapInputToStepValues(input, tool.description),
		},
		seqPath,
		programmatic: true,
	};
}

/**
 * Cross-check a step's declared `inputDomains` against the gwta-derived param-domain
 * bindings. Mismatch is a registration error — better to fail at boot than to leave
 * the goal-resolver with a graph that disagrees with dispatch.
 */
function validateInputDomains(stepperName: string, stepName: string, stepDef: TStepperStep, paramDomainKeys: Map<string, string>): void {
	if (!stepDef.inputDomains) return;
	for (const [param, declaredDomain] of Object.entries(stepDef.inputDomains)) {
		const gwtaDomain = paramDomainKeys.get(param);
		if (!gwtaDomain) {
			throw new Error(`step ${stepperName}.${stepName}: inputDomains.${param} declared as "${declaredDomain}" but gwta has no {${param}:...} slot`);
		}
		if (normalizeDomainKey(declaredDomain) !== gwtaDomain) {
			throw new Error(`step ${stepperName}.${stepName}: inputDomains.${param}="${declaredDomain}" disagrees with gwta {${param}:${gwtaDomain}}`);
		}
	}
}

/** Zod types with no JSON Schema representation (dates excepted — they surface as string/date-time). A domain
 * declaring one of these has no form and no client-side validation surface, so registration throws. */
const UNREPRESENTABLE_ZOD_TYPES = new Set(["bigint", "symbol", "undefined", "void", "never", "function", "map", "set", "promise", "custom", "file"]);

/**
 * Build a JSON Schema and Zod param schemas for a step's input parameters.
 * Uses z.toJSONSchema() to convert Zod domain schemas into full JSON Schema
 * (enums, object structures, descriptions, etc.) for MCP and SSE consumers.
 * Returns both the JSON Schema (for documentation/discovery) and the Zod schemas (for runtime validation).
 */
function buildInputSchema(stepDef: TStepperStep, world: TWorld): { inputSchema: StepToolInputSchema; paramSchemas: Map<string, z.ZodType>; paramDomainKeys: Map<string, string> } {
	const properties: Record<string, { type?: string; description?: string; [key: string]: unknown }> = {};
	const required: string[] = [];
	const paramSchemas = new Map<string, z.ZodType>();
	const paramDomainKeys = new Map<string, string>();

	if (stepDef.gwta) {
		const { stepValuesMap } = namedInterpolation(stepDef.gwta);
		if (stepValuesMap) {
			for (const v of Object.values(stepValuesMap)) {
				const rawDomain = v.domain || DOMAIN_STRING;
				const parts = rawDomain.split(" | ").sort();
				const domainKey = normalizeDomainKey(parts.join(" | "));
				const domain = world.domains?.[domainKey];

				paramDomainKeys.set(v.term, domainKey);

				if (domain?.schema) {
					paramSchemas.set(v.term, domain.schema);
					// Input semantics: the schema describes what a caller must SUPPLY, so defaulted fields are optional.
					// Date fields (z.date / z.coerce.date) surface as string/date-time: their input is an ISO string.
					// Every other type with no JSON Schema representation throws right here, at registration, naming
					// the domain and the type.
					const jsonSchema = z.toJSONSchema(domain.schema, {
						io: "input",
						unrepresentable: "any",
						override: (ctx) => {
							const nodeType = zodTypeLabel(ctx.zodSchema);
							if (nodeType === "date") {
								ctx.jsonSchema.type = "string";
								ctx.jsonSchema.format = "date-time";
								return;
							}
							if (nodeType && UNREPRESENTABLE_ZOD_TYPES.has(nodeType)) {
								throw new Error(`step.list: domain "${domainKey}" declares a "${nodeType}" field, which has no JSON Schema representation — declare a representable input type`);
							}
						},
					}) as Record<string, unknown>;
					const prop: Record<string, unknown> = { ...jsonSchema };
					if (domain.description && !prop.description) {
						prop.description = domain.description;
					}
					properties[v.term] = prop;
				} else {
					properties[v.term] = { type: "string" };
				}
				required.push(v.term);
			}
		}
	}

	return {
		inputSchema: { type: "object" as const, properties, required },
		paramSchemas,
		paramDomainKeys,
	};
}

export function capabilityAllows(granted: string | string[] | undefined, required: string): boolean {
	if (!granted) return false;
	const grantedValues = Array.isArray(granted) ? granted : [granted];
	return grantedValues.some((entry) => {
		if (entry === "*" || entry === required) return true;
		if (!entry.endsWith("*")) return false;
		const prefix = entry.slice(0, -1);
		return required.startsWith(prefix);
	});
}

export function authorizeToolCapability(tool: Pick<StepTool, "name" | "capability">, granted?: string | string[]): void {
	if (!tool.capability) return;
	if (capabilityAllows(granted, tool.capability)) return;
	throw new Error(`${tool.name}: capability ${tool.capability} required`);
}

export type DomainDiscoveryInfo = {
	description?: string;
	values?: string[];
	stepperName?: string;
	persistedAs?: string;
	/** How a domain presents itself: the component that renders it, the URL its source is served from, and its labels.
	 *  Never the component's source itself — a client loads that from the URL, and a standalone report inlines it from
	 *  the domains in memory, so a manifest that carried it would send a bundle to every caller. */
	ui?: Record<string, unknown>;
};

export type StepDiscovery = {
	steps: StepDescriptor[];
	/** Domain definitions from world.domains, serializable for SPA/RPC consumers. */
	domains: Record<string, DomainDiscoveryInfo>;
	/** Hypermedia concern catalog — persisted types with ActivityStreams/JSON-LD metadata. */
	concerns: TConcernCatalog;
};

/**
 * Build a step registry and enrich metadata with input/output schemas.
 * Single entry point for both SSE and MCP transports.
 * Accepts an existing StepRegistry instance to update in-place (for live refresh).
 */
export function discoverSteps(steppers: AStepper[], world: TWorld, stepRegistry?: StepRegistry, options?: { grantedCapability?: string | string[] }): StepDiscovery {
	if (stepRegistry) {
		stepRegistry.refresh(steppers, world);
	}
	const registry = stepRegistry ?? new StepRegistry(steppers, world);
	const all = StepperRegistry.getMetadata(steppers);
	// When a capability context is supplied, drop steps that require a
	// capability the caller wasn't granted. Steps with no capability stay
	// visible to everyone. When no context is supplied, return everything
	// (unchanged behaviour — existing callers keep the full manifest).
	const steps = options?.grantedCapability !== undefined ? all.filter((s) => !s.capability || capabilityAllows(options.grantedCapability, s.capability)) : all;
	for (const step of steps) {
		const tool = registry.get(step.method);
		if (tool) {
			step.inputSchema = tool.inputSchema;
			step.outputSchema = tool.outputSchema;
		}
	}
	// Steps this process can dispatch but no local stepper declares: another host's, injected by the transport that
	// reached it. Dispatch resolves against the registry, so a manifest built only from local steppers describes less
	// than the process can do, and a caller reading it never learns those steps exist. The pattern names the host it
	// runs at, so a reader is told whose step it is rather than left to parse the method name.
	const declared = new Set(steps.map((step) => step.method));
	for (const tool of registry.list()) {
		if (declared.has(tool.name)) continue;
		declared.add(tool.name);
		if (options?.grantedCapability !== undefined && tool.capability && !capabilityAllows(options.grantedCapability, tool.capability)) continue;
		steps.push({
			stepperName: tool.stepperName,
			stepName: tool.stepName,
			method: tool.name,
			pattern: tool.remoteHost ? `${tool.description} (at ${tool.remoteHost})` : tool.description,
			params: {},
			capability: tool.capability,
			inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
			outputSchema: tool.outputSchema as Record<string, unknown> | undefined,
		});
	}
	const domains: Record<string, DomainDiscoveryInfo> = {};
	for (const [key, domain] of Object.entries(world.domains)) {
		// Prefer explicit values; fall back to extracting enum values from z.enum schemas
		let values = domain.values;
		if (!values && domain.schema) {
			try {
				const jsonSchema = z.toJSONSchema(domain.schema) as Record<string, unknown>;
				if (Array.isArray(jsonSchema.enum)) {
					values = jsonSchema.enum as string[];
				}
			} catch {
				// schema not convertible — leave values undefined
			}
		}
		const ui = domain.ui ? (({ jsContent: _source, ...rest }) => rest)(domain.ui as Record<string, unknown> & { jsContent?: string }) : undefined;
		domains[key] = {
			description: domain.description,
			values,
			stepperName: domain.stepperName,
			persistedAs: isPersisted(domain.topology) ? domain.topology.persistedAs : undefined,
			ui,
		};
	}
	const concerns = buildConcernCatalog(world.domains);
	return { steps, domains, concerns };
}
