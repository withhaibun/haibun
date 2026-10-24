/**
 * The steps of a remote haibun host as this process registers them. The host id is read through the handshake that begins
 * every remote surface, and the step descriptors through the host's show steps step. Each proxy StepTool forwards its call
 * through the remote steps port. A call is signed for the capability the remote step declares where the step declares one.
 */
import { RecordSchema } from "../../domains/json-text.js";
import { runSteppers } from "../../actuality/domains/world.js";
import type { TActionResult } from "../../domains/protocol.js";
import { actionNotOK } from "../../domains/util.js";
import type { StepTool } from "../../steps/pipelines/step-registry.js";
import { hostScopedMethodName } from "../../steps/domains/step-method.js";
import { callInput } from "../../steps/pipelines/populate-action-args.js";
import { readStepDefinitions, SHOW_STEP_DEFINITIONS_METHOD, SHOW_STEPS_ACTION, type TStepDescriptor } from "../../steps/domains/step-discovery.js";
import { NO_INPUT } from "../../steps/pipelines/call-step.js";
import type { TRemoteSteps } from "../ports.js";

/** A remote host as this process reads it: its host id, which prefixes its registry keys, and the steps it offers this process. */
export type TRemoteHost = { hostId: number; descriptors: TStepDescriptor[] };

/** Reads the host id through the handshake, then the steps the host offers this process through the read of the step definitions. Every
 *  caller reads actuality's step declarations through that step. The call is signed like any other, so the host states which of
 *  its steps this process may call there, and only those are registered. */
export async function readRemoteHost(rpc: TRemoteSteps, remoteUrl: string): Promise<TRemoteHost> {
	const { hostId } = await rpc.handshake();
	const shown = await rpc.call(SHOW_STEP_DEFINITIONS_METHOD, NO_INPUT, [], SHOW_STEPS_ACTION);
	if (!shown.served)
		throw new Error(`the steps of ${remoteUrl} weren't read: ${shown.reason}. Check that the host is serving and that this process holds ${SHOW_STEPS_ACTION} there.`);
	const callable = readStepDefinitions(shown.result).steps.filter((step) => step.callable);
	return { hostId, descriptors: callable.map(({ _links, callable: _callable, ...descriptor }) => descriptor) };
}

/**
 * The proxy StepTools of a remote host's steps. Remote tools are keyed `host{hostId}_{method}`. Local tools use bare method
 * names, so the keys don't collide with local tools or with other remote hosts' tools.
 */
export function remoteTools(rpc: TRemoteSteps, remoteUrl: string, { hostId, descriptors }: TRemoteHost): StepTool[] {
	const remoteOrigin = new URL(remoteUrl).origin;
	return descriptors.map(
		(descriptor): StepTool => ({
			descriptor: { ...descriptor, method: hostScopedMethodName(hostId, descriptor.method), remoteOrigin },
			paramDomainKeys: new Map(),
			isAsync: true,
			transport: "remote",
			// The RPC call uses the unprefixed method name. The prefix names the tool in the local registry and isn't part
			// of the wire call. A statement's values are read where the statement was written, as a local step's are, so
			// the remote host receives values.
			// A list combinator's listings are functions this process holds, so a statement the host runs states its own combinators.
			handler: async (featureStep, world) =>
				featureStep.listings !== undefined && featureStep.listings.length > 0
					? actionNotOK(
							`${descriptor.method} runs at ${remoteOrigin}, so a list combinator here doesn't apply to its list; state the combinator in the statement the host runs, as in \`on host ${hostId}, limited to 3, ${descriptor.pattern}\``,
						)
					: callRemote(rpc, descriptor, await callInput(featureStep, world, runSteppers(world)), featureStep.seqPath),
		}),
	);
}

/** Calls a step on the remote host and invokes the capability the step declares. The remote step's refusal is this step's
 *  failure, in the host's words where the host gave them. A step that doesn't declare products doesn't return them,
 *  whatever the host's response carries in their place. */
async function callRemote(rpc: TRemoteSteps, descriptor: TStepDescriptor, params: Record<string, unknown>, seqPath: number[]): Promise<TActionResult> {
	const { method, capability } = descriptor;
	const called = await rpc.call(method, params, seqPath, capability);
	if (!called.served) return actionNotOK(called.reason);
	const answersWithProducts = descriptor.outputSchema !== undefined || descriptor.productsOf !== undefined;
	return answersWithProducts ? { ok: true, products: RecordSchema.parse(called.result) } : { ok: true };
}
