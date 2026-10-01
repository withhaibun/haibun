/**
 * Calling a registered step BY NAME, with its arguments as data rather than as a written line.
 *
 * Every caller that runs a step without a feature file, whether an external protocol, a chain, a goal, or an agent
 * acting on a granted proposal, needs the same four things: the tool from the registry, a synthetic seqPath, a feature step
 * built for transport, and dispatch. Doing them here means one place decides what a data-borne call looks like, so
 * such a call is indistinguishable from a written one to the step's own gate, cycles and record.
 *
 * A name that is not registered is answered, not thrown: each caller defines what the missing step means in its own
 * terms, and the seqPath is returned because a caller that records what it ran needs the identity of the call.
 */
import { buildFeatureStepForTransport, runRegistry, stepMethodName, type StepTool } from "./step-registry.js";
import { dispatchStep, type DispatchContext } from "./step-dispatch.js";
import { allocateSyntheticSeqPath } from "./host-id.js";
import type { TSeqPath, TStepResult } from "../schema/protocol.js";

/** What a call by name answers: the step is not registered here, or it ran and this is what it produced. */
type TStepCall = { seqPath: TSeqPath; result: TStepResult };

export async function callStepByName(ctx: DispatchContext, method: string, input: Record<string, unknown> = {}): Promise<TStepCall> {
	const tool = ctx.registry.named(method);
	const seqPath = allocateSyntheticSeqPath(ctx.world);
	const result = await dispatchStep(ctx, buildFeatureStepForTransport(tool, input, seqPath));
	return { seqPath, result };
}

/**
 * The same call from a stepper, which holds its world and the steppers it was set up with, but doesn't hold a registry.
 *
 * Actuality's own registry is used: a registry built again lacks the tools a transport put on actuality's.
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

/** What a call to `tool` answers a caller who reads what the step changed: the read its step names, once the step passed. A
 *  read that doesn't pass leaves the step's own answer, since the step did what it was asked. */
export async function answeredFor(ctx: DispatchContext, tool: StepTool, result: TStepResult): Promise<TStepResult> {
	const { answeredBy, stepperName } = tool.descriptor;
	if (!result.ok || !answeredBy) return result;
	const { result: read } = await callStepByName(ctx, stepMethodName(stepperName, answeredBy));
	return read.ok ? read : result;
}
