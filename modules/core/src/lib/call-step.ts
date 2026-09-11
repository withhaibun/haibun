/**
 * Calling a registered step BY NAME, with its arguments as data rather than as a written line.
 *
 * Every caller that runs a step without a feature file, whether an external protocol, a chain, a goal, or an agent
 * acting on a granted proposal, needs the same four things: the tool from the registry, a synthetic seqPath, a feature step
 * built for transport, and dispatch. Doing them here means one place decides what a data-borne call looks like, so
 * such a call is indistinguishable from a written one to the step's own gate, cycles and record.
 *
 * A name that is not registered is answered, not thrown: each caller says what the missing step means in its own
 * terms, and the seqPath is returned because a caller that records what it ran needs the identity of the call.
 */
import { StepRegistry, buildFeatureStepForTransport } from "./step-registry.js";
import { dispatchStep, type DispatchContext } from "./step-dispatch.js";
import { allocateSyntheticSeqPath } from "./host-id.js";
import type { TSeqPath, TStepResult } from "../schema/protocol.js";

/** What a call by name answers: the step is not registered here, or it ran and this is what it produced. */
export type TStepCall = { registered: false } | { registered: true; seqPath: TSeqPath; result: TStepResult };

export async function callStepByName(ctx: DispatchContext, method: string, input: Record<string, unknown> = {}): Promise<TStepCall> {
	const tool = ctx.registry.get(method);
	if (!tool) return { registered: false };
	const seqPath = allocateSyntheticSeqPath(ctx.world);
	const result = await dispatchStep(ctx, buildFeatureStepForTransport(tool, input, seqPath));
	return { registered: true, seqPath, result };
}

/**
 * The same call from a stepper, which holds its world and the steppers it was set up with, but no registry.
 *
 * The run's own registry is used where there is one: building another takes a tool object per registered step, and a
 * fresh one lacks the tools a transport put on the live one.
 */
export async function callStepFrom(
	from: { getWorld: () => DispatchContext["world"]; steppers?: DispatchContext["steppers"] },
	method: string,
	input: Record<string, unknown> = {},
): Promise<TStepCall> {
	const world = from.getWorld();
	const steppers = from.steppers ?? [];
	const registry = (world.runtime.stepRegistry as StepRegistry | undefined) ?? new StepRegistry(steppers, world);
	return await callStepByName({ registry, world, steppers }, method, input);
}
