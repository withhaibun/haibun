import type { StepRegistry } from "./step-registry.js";
import type { DispatchContext } from "./step-dispatch.js";
import { stepMethodName } from "./step-registry.js";
import { callStepByName } from "./call-step.js";
import { formatSeqPath } from "./seq-path.js";
import { actingAs } from "./capability-context.js";
import { validateToolInput } from "./tool-validation.js";
import { errorDetail } from "./util/index.js";
import { CHAIN_INSTANCE_STATUS, getChainInstance, updateChainInstance, type TChainInstance } from "./chain-instance.js";

export type TChainAdvanceResult =
	| { kind: "advanced"; instance: TChainInstance; factIds: string[] }
	| { kind: "completed"; instance: TChainInstance }
	| { kind: "failed"; instance: TChainInstance; error: string };

/** What walking a chain needs is what dispatching a step needs: the registry, the world, the steppers and the
 *  authority the walk runs under. */
export type TChainWalkerContext = DispatchContext;

/**
 * Run the chain instance's next pending step. The caller supplies
 * `stepArgs` for the step about to run; the walker merges those into the
 * instance's `stepArgs` slot before dispatching. Returns either
 *   - the updated instance + the fact ids produced (advanced),
 *   - the instance with status `completed` (no more steps), or
 *   - the instance with status `failed` and an error string.
 */
export async function advanceChainInstance(ctx: TChainWalkerContext, instanceId: string, stepArgs: Record<string, unknown>): Promise<TChainAdvanceResult> {
	const { registry, world, steppers, grantedCapability } = ctx;
	const inst = await getChainInstance(world, instanceId);
	if (!inst) throw new Error(`chain instance not found: ${instanceId}`);
	// A walk is one reader's. Whoever is acting must be who began it, so a handle to a walk is not authority over it:
	// the arguments each step runs with are the walker's own, and another reader supplying them is another reader acting.
	const acting = actingAs();
	if (inst.owner !== acting) throw new Error(`chain instance ${instanceId} was begun by ${inst.owner ?? "no one"}, and ${acting ?? "no one"} is acting`);

	if (inst.stepIndex >= inst.michi.steps.length) {
		if (inst.status !== CHAIN_INSTANCE_STATUS.COMPLETED) {
			await updateChainInstance(world, inst.id, { status: CHAIN_INSTANCE_STATUS.COMPLETED });
		}
		return { kind: "completed", instance: { ...inst, status: CHAIN_INSTANCE_STATUS.COMPLETED } };
	}

	const step = inst.michi.steps[inst.stepIndex];
	const method = stepMethodName(step.stepperName, step.stepName);
	if (!registry.get(method)) {
		const error = `chain step ${inst.stepIndex} (${method}) is not registered`;
		await updateChainInstance(world, inst.id, { status: CHAIN_INSTANCE_STATUS.FAILED });
		return { kind: "failed", instance: { ...inst, status: CHAIN_INSTANCE_STATUS.FAILED }, error };
	}

	// What a step is given is held to what that step declares it takes, and coerced by the domains it names, exactly as
	// for a caller reaching it over the wire. A walk that could hand a step anything would be a way past the validation
	// every other caller passes through, so what is dispatched below is what came back from it.
	let given: Record<string, unknown>;
	try {
		given = validateToolInput([inst.stepIndex], registry.get(method) as NonNullable<ReturnType<StepRegistry["get"]>>, stepArgs, world);
	} catch (err) {
		const error = `chain step ${inst.stepIndex} (${method}) was given what it does not take: ${errorDetail(err)}`;
		await updateChainInstance(world, inst.id, { status: CHAIN_INSTANCE_STATUS.FAILED });
		return { kind: "failed", instance: { ...inst, status: CHAIN_INSTANCE_STATUS.FAILED }, error };
	}

	const nextArgs = inst.stepArgs.map((existing, i) => (i === inst.stepIndex ? { ...existing, ...given } : existing));
	await updateChainInstance(world, inst.id, { status: CHAIN_INSTANCE_STATUS.RUNNING, stepArgs: nextArgs });

	const call = await callStepByName({ registry, world, steppers, grantedCapability }, method, given);
	if (!call.registered) throw new Error(`chain step ${inst.stepIndex} (${method}) left the registry mid-advance`);
	const { seqPath, result } = call;

	if (!result.ok) {
		const error = result.errorMessage ?? `chain step ${inst.stepIndex} (${method}) failed`;
		await updateChainInstance(world, inst.id, { status: CHAIN_INSTANCE_STATUS.FAILED });
		return { kind: "failed", instance: { ...inst, stepArgs: nextArgs, status: CHAIN_INSTANCE_STATUS.FAILED }, error };
	}

	const factId = formatSeqPath(seqPath);
	const nextFactIds = inst.stepFactIds.map((existing, i) => (i === inst.stepIndex ? [...existing, factId] : existing));
	const nextStepIndex = inst.stepIndex + 1;
	const nextStatus = nextStepIndex >= inst.michi.steps.length ? CHAIN_INSTANCE_STATUS.COMPLETED : CHAIN_INSTANCE_STATUS.PENDING;
	await updateChainInstance(world, inst.id, { stepIndex: nextStepIndex, status: nextStatus, stepFactIds: nextFactIds, stepArgs: nextArgs });
	const advanced: TChainInstance = { ...inst, stepIndex: nextStepIndex, status: nextStatus, stepFactIds: nextFactIds, stepArgs: nextArgs };
	if (nextStatus === CHAIN_INSTANCE_STATUS.COMPLETED) return { kind: "completed", instance: advanced };
	return { kind: "advanced", instance: advanced, factIds: nextFactIds[inst.stepIndex] };
}
