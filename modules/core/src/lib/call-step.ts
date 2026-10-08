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
import { buildFeatureStepForTransport, runRegistry, stepMethodName, type StepTool } from "./step-registry.js";
import { dispatchStep, type DispatchContext } from "./step-dispatch.js";
import { allocateSyntheticSeqPath } from "./host-id.js";
import type { TSeqPath, TStepResult } from "../schema/protocol.js";

/** The result of a call by name: the call's synthetic seqPath and the step's result. */
type TStepCall = { seqPath: TSeqPath; result: TStepResult };

export async function callStepByName(ctx: DispatchContext, method: string, input: Record<string, unknown> = {}): Promise<TStepCall> {
	const tool = ctx.registry.named(method);
	const seqPath = allocateSyntheticSeqPath(ctx.world);
	const result = await dispatchStep(ctx, buildFeatureStepForTransport(tool, input, seqPath));
	return { seqPath, result };
}

/**
 * Calls a step by name from a stepper. A stepper holds its world and its steppers but doesn't hold a registry.
 *
 * The call reads actuality's registry through `runRegistry`. A new registry lacks the tools a transport added to
 * actuality's registry.
 */
export async function callStepFrom(
	from: { getWorld: () => DispatchContext["world"]; steppers?: DispatchContext["steppers"] },
	method: string,
	input: Record<string, unknown> = {},
): Promise<TStepCall> {
	const world = from.getWorld();
	const steppers = from.steppers ?? [];
	const registry = runRegistry(world);
	return await callStepByName({ registry, world, steppers }, method, input);
}

/** Returns the result of `tool` for a caller that reads what the step changed. It calls the read step that the
 *  descriptor's `answeredBy` names, whether the step passed or failed. A failed step may still have changed its target: a
 *  navigation can reach its page and fail while it waits for that page. It returns the read's result for a passed step.
 *  It returns a failed step's failure with the read's products. It returns the step's own result where the read fails or
 *  the descriptor doesn't name a read step. */
export async function answeredFor(ctx: DispatchContext, tool: StepTool, result: TStepResult): Promise<TStepResult> {
	const { answeredBy, stepperName } = tool.descriptor;
	if (!answeredBy) return result;
	const { result: read } = await callStepByName(ctx, stepMethodName(stepperName, answeredBy));
	if (!read.ok) return result;
	return result.ok ? read : { ...result, products: read.products };
}
