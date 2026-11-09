/**
 * A call to one of actuality's steps from outside a feature, as `/rpc` and MCP carry it. A call is refused before its
 * input is read, and alike whether its step exists, so a refusal doesn't map the steps a caller may not call. A call it
 * may make is validated and built into a feature step, at a path this host allocates under the step the call acts under,
 * and runs as whoever proved themselves at the boundary, holding only what the request presented.
 */
import type { TWorld } from "@haibun/core/lib/world.js";
import type { AStepper } from "@haibun/core/lib/astepper.js";
import type { TFeatureStep } from "@haibun/core/lib/astepper.js";
import type { TStepResult } from "@haibun/core/lib/domains/protocol.js";
import type { TRestsOn } from "@haibun/core/lib/domains/authority-types.js";
import { refusalCarried, type TRpcRefusal } from "@haibun/core/lib/rpc-wire.js";
import { stepRecordOf } from "@haibun/core/lib/seq-path.js";
import { proveClaimed, type DispatchContext } from "@haibun/core/lib/step-dispatch.js";
import { validatedFeatureStep } from "@haibun/core/lib/call-step.js";
import { refusal } from "@haibun/core/lib/steps/pipelines/gate.js";
import type { StepRegistry, StepTool } from "@haibun/core/lib/step-registry.js";
import { lackedByCall } from "@haibun/core/lib/domains/actions.js";
import { allocateCallPath } from "@haibun/core/lib/domains/host-id.js";
import { runAsCaller, runReadingAt } from "@haibun/core/lib/domains/capability-context.js";
import type { AccessLevel } from "@haibun/core/lib/domains/resources.js";
import { notARead } from "../domains/web-server.js";

/** Who makes a call and under what: the actions the request invoked and those its caller holds, who proved themselves,
 *  what their proof rests on, and the delegate a refusal names as able to grant the lacked action. */
export type TCaller = { granted: string[]; held: string[]; principal: string | undefined; restsOn: TRestsOn | undefined; delegate: string | undefined };

/** A call as its transport states it: the method, its arguments, whether it requests a read, and the path of the step it acts under. */
export type TStepCall = { method: string; params: Record<string, unknown>; asks: "read" | "act" | undefined; under: number[] | undefined };

/** The step a call runs, built at the path this host allocated, or the refusal of the call, with the step its gate refused where actuality records it. */
export type TCalledStep = { tool: StepTool; featureStep: TFeatureStep } | { refused: TRpcRefusal; gated?: TFeatureStep };

/** Where actuality dispatches a call: its registry, its world and its steppers. */
export type TDispatchWithin = { registry: StepRegistry; world: TWorld; steppers: AStepper[] };

/**
 * The step a call runs, or its refusal: a call is refused where its step isn't registered or its caller lacks what the
 * step requires, and where it requests a read of a step that doesn't declare itself one. The step runs at the path this host
 * allocates under the step the call acts under, or at a synthetic path where the call, such as an external caller's or
 * MCP's, doesn't act under one. Throws where the input doesn't validate. A call of a step that isn't a read, refused for an
 * action its caller lacks, states the step its gate refused where its input validates, which `recordedRefusal` records; its
 * refusal reads the same whether or not the input validates.
 */
export function calledStep({ registry, world, steppers }: TDispatchWithin, call: TStepCall, caller: TCaller): TCalledStep {
	const { method, params, asks, under } = call;
	const tool = registry.get(method);
	const lacked = tool && lackedByCall({ invoked: caller.granted, held: caller.held }, tool.descriptor);
	const built = (step: StepTool) => validatedFeatureStep(step, params, allocateCallPath(world, under), world, steppers);
	if (!tool || lacked) return { refused: refusal(method, lacked, caller.delegate), ...(tool && lacked && !tool.descriptor.read ? gatedOf(() => built(tool)) : {}) };
	if (asks === "read" && !tool.descriptor.read) return { refused: { error: notARead(method) } };
	return { tool, featureStep: built(tool) };
}

/** The step a gate refuses, where the call's input builds it. A call whose input doesn't validate is refused without a record. */
function gatedOf(build: () => TFeatureStep): { gated?: TFeatureStep } {
	try {
		return { gated: { ...build(), isSubStep: true } };
	} catch {
		return {};
	}
}

/** Records a call its gate refused through dispatch, whose gate writes the step's record with the refusal and the action the
 *  caller lacked, and returns the refusal with the id of that record. A refusal without a gated step is returned as it is. */
export async function recordedRefusal(within: TDispatchWithin, caller: TCaller, { refused, gated }: { refused: TRpcRefusal; gated?: TFeatureStep }): Promise<TRpcRefusal> {
	if (gated === undefined) return refused;
	try {
		await dispatchCall(within, caller, gated);
	} catch (err) {
		if (refusalCarried(err) === undefined) throw err;
	}
	return { ...refused, step: stepRecordOf(within.world.tag, gated.seqPath) };
}

/** The dispatch of a call's step as its caller, holding only what the request presented: the server was started inside a
 *  step of actuality, and a caller doesn't hold what that step held. */
export const dispatchedAs = (within: TDispatchWithin, caller: TCaller): DispatchContext => ({ ...within, grantedCapability: caller.granted, held: caller.held });

/** Runs a call's step as whoever proved themselves at the boundary, so what the step records names the reader who called
 *  it rather than the process that carried it out, reading at `readingAt` at most where the call requests a level. */
export function dispatchCall(within: TDispatchWithin, caller: TCaller, featureStep: TFeatureStep, readingAt?: AccessLevel): Promise<TStepResult> {
	return runAsCaller(caller, () => runReadingAt(readingAt, () => proveClaimed(dispatchedAs(within, caller), featureStep)));
}
