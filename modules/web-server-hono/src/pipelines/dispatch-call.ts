/**
 * A call to one of actuality's steps from outside a feature, as `/rpc` and MCP carry it. A call is refused before its
 * input is read, and alike whether its step exists, so a refusal doesn't map the steps a caller may not call. A call it
 * may make is validated and built into a feature step, at the caller's seqPath or at one this host allocates, and runs
 * as whoever proved themselves at the boundary, holding only what the request presented.
 */
import type { TWorld } from "@haibun/core/lib/world.js";
import type { AStepper } from "@haibun/core/lib/astepper.js";
import type { TFeatureStep } from "@haibun/core/lib/astepper.js";
import type { TStepResult } from "@haibun/core/lib/domains/protocol.js";
import type { TRestsOn } from "@haibun/core/lib/domains/authority-types.js";
import type { TRpcRefusal } from "@haibun/core/lib/rpc-wire.js";
import { proveStep, type DispatchContext } from "@haibun/core/lib/step-dispatch.js";
import { validatedFeatureStep } from "@haibun/core/lib/call-step.js";
import { refusal } from "@haibun/core/lib/steps/pipelines/gate.js";
import type { StepRegistry, StepTool } from "@haibun/core/lib/step-registry.js";
import { lackedByCall } from "@haibun/core/lib/domains/actions.js";
import { allocateSyntheticSeqPath } from "@haibun/core/lib/domains/host-id.js";
import { runActingAs } from "@haibun/core/lib/domains/capability-context.js";
import { notARead } from "../domains/web-server.js";

/** Who makes a call and under what: the actions the request invoked and those its caller holds, who proved themselves,
 *  what their proof rests on, and the delegate a refusal names as able to grant the lacked action. */
export type TCaller = { granted: string[]; held: string[]; principal: string | undefined; restsOn: TRestsOn | undefined; delegate: string | undefined };

/** A call as its transport states it: the method, its arguments, whether it requests a read, and the caller's seqPath. */
export type TStepCall = { method: string; params: Record<string, unknown>; asks: "read" | "act" | undefined; seqPath: number[] | undefined };

/** The step a call runs, built at its seqPath, or the refusal of the call. */
export type TCalledStep = { tool: StepTool; featureStep: TFeatureStep } | { refused: TRpcRefusal };

/** Where actuality dispatches a call: its registry, its world and its steppers. */
export type TDispatchWithin = { registry: StepRegistry; world: TWorld; steppers: AStepper[] };

/**
 * The step a call runs, or its refusal: a call is refused where its step isn't registered or its caller lacks what the
 * step requires, and where it requests a read of a step that doesn't declare itself one. A caller without a seqPath, such
 * as an external caller or MCP, runs at a seqPath this host allocates. Throws where the input doesn't validate.
 */
export function calledStep({ registry, world, steppers }: TDispatchWithin, call: TStepCall, caller: TCaller): TCalledStep {
	const { method, params, asks, seqPath } = call;
	const tool = registry.get(method);
	const lacked = tool && lackedByCall({ invoked: caller.granted, held: caller.held }, tool.descriptor);
	if (!tool || lacked) return { refused: refusal(method, lacked, caller.delegate) };
	if (asks === "read" && !tool.descriptor.read) return { refused: { error: notARead(method) } };
	const at = seqPath !== undefined && seqPath.length > 0 ? seqPath : allocateSyntheticSeqPath(world);
	return { tool, featureStep: validatedFeatureStep(tool, params, at, world, steppers) };
}

/** The dispatch of a call's step as its caller, holding only what the request presented: the server was started inside a
 *  step of actuality, and a caller doesn't hold what that step held. */
export const dispatchedAs = (within: TDispatchWithin, caller: TCaller): DispatchContext => ({ ...within, grantedCapability: caller.granted, held: caller.held });

/** Runs a call's step as whoever proved themselves at the boundary, so what the step records names the reader who called
 *  it rather than the process that carried it out. */
export function dispatchCall(within: TDispatchWithin, caller: TCaller, featureStep: TFeatureStep): Promise<TStepResult> {
	return runActingAs(caller.principal, () => proveStep(dispatchedAs(within, caller), featureStep), caller.restsOn);
}
