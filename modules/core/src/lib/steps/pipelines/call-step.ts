/**
 * Calls a registered step by name, with its arguments as data instead of a written line.
 *
 * A caller that runs a step without a feature file needs four things: the tool from the registry, a synthetic seqPath,
 * a feature step built for transport, and dispatch. External protocols, chains, goals and agents that act on a granted
 * proposal are such callers. This module performs all four, so one module defines the shape of a call by name. The
 * step's gate, cycles and record treat such a call the same as a written line.
 *
 * `StepRegistry.named` throws for a name that isn't registered, before dispatch. A caller that handles a missing step
 * calls `named` itself and catches the error. `callStepByName` returns the seqPath because a caller that records the call
 * needs its identity.
 */
import type { TWorld } from "../../actuality/domains/world.js";
import { runRegistry, type StepTool } from "./step-registry.js";
import { hostOfMethodName, stepMethodName } from "../domains/step-method.js";
import type { AStepper, TStepperStep, TFeatureStep } from "../domains/stepper.js";
import { mapInputToStepValues, literalTerm, renderStepLine } from "../derivations/named-vars.js";
import { actionNotOK } from "../../domains/util.js";
import { proveStep, type DispatchContext } from "../../actuality/pipelines/step-dispatch.js";
import { allocateSyntheticSeqPath } from "../../domains/host-id.js";
import type { TSeqPath, TStepResult } from "../../domains/protocol.js";

/**
 * Returns the feature step that a call from a transport (RPC, MCP) runs as. A feature line holds its feature step; a call
 * from outside actuality builds one from the tool and its input. It reads the registered step definition, so dispatch
 * (augment, autoAssert, preconditions) receives the same shape from both paths.
 */
export function buildFeatureStepForTransport(tool: StepTool, input: Readonly<Record<string, unknown>>, seqPath: TSeqPath): TFeatureStep {
	// A proxy tool (RemoteStepperProxy) dispatches out of process and doesn't hold a step definition in this process. The
	// carrier holds the step's pattern and an action that refuses, so the handler runs.
	const { descriptor } = tool;
	const step: TStepperStep =
		tool.stepDef === undefined
			? { gwta: descriptor.pattern, action: () => actionNotOK(`${descriptor.method} runs at another host, so this process doesn't run its action`) }
			: tool.stepDef;
	// A tool of another host is registered under a host-scoped method. Its stepper and step names are the names that host
	// registers, and dispatch resolves a step by those names. A call to a remote tool without targetHostId resolves the
	// local step of the same name and runs it in this process.
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

/** The result of a call by name: the call's synthetic seqPath and the step's result. */
type TStepCall = { seqPath: TSeqPath; result: TStepResult };

/** The input of a step that doesn't take an argument. */
export const NO_INPUT: Readonly<Record<string, unknown>> = {};

export async function callStepByName(ctx: DispatchContext, method: string, input: Readonly<Record<string, unknown>>): Promise<TStepCall> {
	const tool = ctx.registry.named(method);
	const seqPath = allocateSyntheticSeqPath(ctx.world);
	const result = await proveStep(ctx, buildFeatureStepForTransport(tool, input, seqPath));
	return { seqPath, result };
}

/**
 * Calls a step by name from a stepper. A stepper holds its world and its steppers but doesn't hold a registry, so the
 * call reads actuality's registry through `runRegistry`. A new registry lacks the tools a transport added to actuality's
 * registry.
 */
export async function callStepFrom(from: { getWorld: () => TWorld; steppers: AStepper[] }, method: string, input: Readonly<Record<string, unknown>>): Promise<TStepCall> {
	const world = from.getWorld();
	return await callStepByName({ registry: runRegistry(world), world, steppers: from.steppers }, method, input);
}

/** Returns the result of `tool` for a caller that reads what the step changed. It calls the read step that the
 *  descriptor's `answeredBy` names, whether the step passed or failed. A failed step may still have changed its target: a
 *  navigation can reach its page and fail while it waits for that page. It returns the read's result for a passed step.
 *  It returns a failed step's failure with the read's products. It returns the step's own result where the read fails or
 *  the descriptor doesn't name a read step. */
export async function answeredFor(ctx: DispatchContext, tool: StepTool, result: TStepResult): Promise<TStepResult> {
	const { answeredBy, stepperName } = tool.descriptor;
	if (!answeredBy) return result;
	const { result: read } = await callStepByName(ctx, stepMethodName(stepperName, answeredBy), NO_INPUT);
	if (!read.ok) return result;
	return result.ok ? read : { ...result, products: read.products };
}
