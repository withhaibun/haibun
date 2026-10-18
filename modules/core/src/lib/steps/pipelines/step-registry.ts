/**
 * Actuality's step registry: one tool per step. Every transport (RPC, MCP, a model's turn) dispatches and discovers steps
 * through it. refresh() rebuilds it in place when the steppers change, and each change to its steps calls its change
 * listeners.
 */
import type { AStepper, TStepperStep, TFeatureStep } from "../domains/stepper.js";
import { runSteppers, type TWorld } from "../../actuality/domains/world.js";
import { ControlEvent, STEPS_CHANGED, type TActionResult } from "../../domains/protocol.js";
import { actionNotOK, errorDetail } from "../../domains/util.js";
import { mayCall } from "../../domains/actions.js";
import { refusalCarried } from "../../transport/ports.js";
import type { TStepDescriptor } from "../domains/step-discovery.js";
import { stepDeclaration } from "../derivations/step-tools.js";
import { validateProducts } from "../derivations/tool-validation.js";
import { argumentsOf } from "./populate-action-args.js";

/** A registered step tool. Every transport (RPC, MCP, a model's turn) dispatches a step through one. */
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

/** A step registry that refresh() rebuilds in place. Every transport (SSE, MCP) reads its steps from it. Call refresh()
 *  when the steppers change, without a restart. */
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

	/** Rebuilds the entries of the given steppers in place. refresh() keeps the injected tools. */
	refresh(steppers: AStepper[], world: TWorld): void {
		const next = buildStepRegistry(steppers, world);
		for (const name of this.injectedNames) {
			const existing = this.tools.get(name);
			if (existing) next.set(name, existing);
		}
		this.replace(next);
	}

	/** Adds or replaces the steps that a transport dispatches to another process. refresh() keeps these steps. */
	inject(tools: StepTool[]): void {
		const next = new Map(this.tools);
		for (const tool of tools) {
			next.set(tool.descriptor.method, tool);
			this.injectedNames.add(tool.descriptor.method);
		}
		this.replace(next);
	}

	/** Holds the given tools. Calls each change listener when their descriptors differ from the previous descriptors. A
	 *  replacement with the same descriptors doesn't call the listeners. */
	private replace(next: Map<string, StepTool>): void {
		this.tools = next;
		const described = JSON.stringify(this.descriptors());
		if (described === this.described) return;
		this.described = described;
		for (const listener of this.changeListeners) listener();
	}

	/** Calls `listener` each time the registry's steps change, until the returned function is called. A caller that lists
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

/** Opens actuality's step registry over actuality's steppers. The registry's change listener emits a STEPS_CHANGED control
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
	if (!world.runtime.stepRegistry) throw new Error("actuality doesn't hold a step registry; the Executor opens it as actuality starts, before a step runs");
	return world.runtime.stepRegistry;
}

/** Builds a registry of step tools from the given steppers. Each key is `${stepperName}-${stepName}` (e.g.
 *  `ExampleStepper-getTypes`). */
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
	const { descriptor, paramDomainKeys } = stepDeclaration(stepper, stepName, stepDef, world);
	return {
		descriptor,
		paramDomainKeys,
		stepDef,
		transport: "local",
		isAsync: stepDef.action.constructor.name === "AsyncFunction",
		handler: createStepHandler(descriptor.stepperName, stepName, stepDef),
	};
}

/**
 * Returns a handler that populates a step's arguments from featureStep.action.stepValuesMap, calls stepDef.action, and
 * returns its TActionResult. Every caller (the feature loop, FlowRunner, RPC, MCP) calls a step through this handler. An
 * external transport builds a feature step before it calls.
 */
export function createStepHandler(stepperName: string, stepName: string, stepDef: TStepperStep): (featureStep: TFeatureStep, world: TWorld) => Promise<TActionResult> {
	return async (featureStep: TFeatureStep, world: TWorld): Promise<TActionResult> => {
		try {
			const read = await argumentsOf(featureStep, world, runSteppers(world));
			// A parameter that doesn't read is refused with the step, the parameter and the cause, which its refusal states.
			if ("refused" in read) return actionNotOK(read.refused);
			const result = await stepDef.action(read.args, featureStep);
			// A failed result states its reason in errorMessage. Code that the types don't check can omit it, and that failure
			// is replaced by one that names the step.
			if (!result.ok && typeof result.errorMessage !== "string") throw new Error(`${stepperName}.${stepName} failed without stating why; return actionNotOK with the cause`);
			// Products are validated here, where the arguments are resolved, since a statement the step ran names the domain
			// of the products the step returns as its own.
			const productsError = result.ok ? validateProducts(stepperName, stepName, stepDef, world, result.products, read.args) : undefined;
			return productsError ? actionNotOK(productsError) : result;
		} catch (caught) {
			// A thrown error becomes a failed result that states the step threw and carries the error's message, and the remedy
			// where a refused call carries one. The code that presents the failure names the step, as an RPC response names
			// its method.
			const remedy = refusalCarried(caught)?.remedy;
			return actionNotOK(`the step threw: ${errorDetail(caught)}`, remedy === undefined ? {} : { remedy });
		}
	};
}
