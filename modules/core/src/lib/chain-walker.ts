/**
 * Chain walker — advances a chain instance one step at a time.
 *
 * Given an existing `TChainInstance`, `advanceChainInstance` resolves the next
 * step from the instance's michi, dispatches it through the shared dispatcher
 * with a freshly allocated synthetic seqPath, and persists the produced fact
 * id back onto the instance. The walker never auto-advances past one step —
 * the SPA pauses between steps to collect user input where the michi
 * declares `kind: "argument"` bindings.
 *
 * The walker treats the dispatcher's `stepIndex === michi.steps.length` as the
 * terminal state: the instance status flips to `completed`. A step failure
 * flips status to `failed` and stops the walk; the SPA can present the error
 * and let the user retry the step or abandon the walk.
 */
import type { TWorld } from "./world.js";
import type { StepRegistry } from "./step-dispatch.js";
import type { AStepper } from "./astepper.js";
import { buildFeatureStepForTransport, dispatchStep, stepMethodName } from "./step-dispatch.js";
import { allocateSyntheticSeqPath } from "./host-id.js";
import { formatSeqPath } from "./seq-path.js";
import { CHAIN_INSTANCE_STATUS, getChainInstance, updateChainInstance, type TChainInstance } from "./chain-instance.js";

export type TChainAdvanceResult =
	| { kind: "advanced"; instance: TChainInstance; factIds: string[] }
	| { kind: "completed"; instance: TChainInstance }
	| { kind: "failed"; instance: TChainInstance; error: string };

export type TChainWalkerContext = {
	registry: StepRegistry;
	world: TWorld;
	steppers: AStepper[];
	grantedCapability?: string | string[];
};

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

	if (inst.stepIndex >= inst.michi.steps.length) {
		if (inst.status !== CHAIN_INSTANCE_STATUS.COMPLETED) {
			await updateChainInstance(world, inst.id, { status: CHAIN_INSTANCE_STATUS.COMPLETED });
		}
		return { kind: "completed", instance: { ...inst, status: CHAIN_INSTANCE_STATUS.COMPLETED } };
	}

	const step = inst.michi.steps[inst.stepIndex];
	const method = stepMethodName(step.stepperName, step.stepName);
	const tool = registry.get(method);
	if (!tool) {
		const error = `chain step ${inst.stepIndex} (${method}) is not registered`;
		await updateChainInstance(world, inst.id, { status: CHAIN_INSTANCE_STATUS.FAILED });
		return { kind: "failed", instance: { ...inst, status: CHAIN_INSTANCE_STATUS.FAILED }, error };
	}

	const nextArgs = inst.stepArgs.map((existing, i) => (i === inst.stepIndex ? { ...existing, ...stepArgs } : existing));
	await updateChainInstance(world, inst.id, { status: CHAIN_INSTANCE_STATUS.RUNNING, stepArgs: nextArgs });

	const seqPath = allocateSyntheticSeqPath(world);
	const featureStep = buildFeatureStepForTransport(tool, stepArgs, seqPath);
	const result = await dispatchStep({ registry, world, steppers, grantedCapability }, featureStep);

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
