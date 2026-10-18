/**
 * A client-side proxy for a remote haibun host. It reads step descriptors through the host's show steps step and
 * injects proxy StepTools into the parent registry. Each proxy handler forwards calls over HTTP. A call is signed for
 * the capability the remote step declares where the step declares one.
 */

import { RecordSchema } from "../domains/json-text.js";
import { AStepper } from "../steps/domains/stepper.js";
import { runSteppers, type TWorld } from "../actuality/domains/world.js";
import type { TActionResult } from "../domains/protocol.js";
import { actionNotOK } from "../domains/util.js";
import { type StepTool, type StepRegistry } from "../steps/pipelines/step-registry.js";
import { hostScopedMethodName } from "../steps/domains/step-method.js";
import { callInput } from "../steps/pipelines/populate-action-args.js";
import { EVERY_DEFINITION, SHOW_STEPS_ACTION, SHOW_STEPS_METHOD, type TStepDescriptor } from "../steps/domains/step-discovery.js";
import { readShownSteps } from "../steps/domains/step-discovery.js";
import { requestSigner } from "../domains/session-authority.js";
import type { TRemoteSteps } from "./ports.js";
import { remoteSteps } from "./root.js";

export class RemoteStepperProxy extends AStepper {
	readonly name: string;
	description: string;
	private stepDescriptors: TStepDescriptor[] = [];
	private rpc: TRemoteSteps;
	/**
	 * The remote host's hostId, read at setWorld through action.begin. It prefixes registry keys, so tools from several
	 * remote hosts and local tools don't collide on one method name.
	 */
	private hostId: number | undefined;

	constructor(private remoteUrl: string) {
		super();
		const host = new URL(remoteUrl).host;
		this.name = `RemoteProxy_${host.replace(/[^a-zA-Z0-9]/g, "_")}`;
		this.description = `Proxy for remote stepper host at ${remoteUrl}`;
		this.rpc = remoteSteps(remoteUrl, (request, action) => requestSigner(this.getWorld().runtime)(request, action));
	}

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		await super.setWorld(world, steppers);
		await this.discoverHostId();
		await this.fetchStepDescriptors();
	}

	/** Reads the host id through the handshake that begins every remote surface, so injected tools carry its prefix. */
	private async discoverHostId(): Promise<void> {
		this.hostId = (await this.rpc.handshake()).hostId;
	}

	/** The remote host's hostId. Undefined before setWorld completes. */
	get remoteHostId(): number | undefined {
		return this.hostId;
	}

	/** Reads every step the remote host offers this process through the show steps step. Every caller reads actuality's
	 *  step declarations through that step. The call is signed like any other, so the host shows the steps this process
	 *  holds there and doesn't show others. */
	private async fetchStepDescriptors(): Promise<void> {
		const shown = await this.rpc.call(SHOW_STEPS_METHOD, EVERY_DEFINITION, [], SHOW_STEPS_ACTION);
		if (!shown.served)
			throw new Error(`the steps of ${this.remoteUrl} weren't read: ${shown.reason}. Check that the host is serving and that this process holds ${SHOW_STEPS_ACTION} there.`);
		this.stepDescriptors = readShownSteps(shown.result, EVERY_DEFINITION.detail).steps.map(({ _links, ...descriptor }) => descriptor);
	}

	/**
	 * Injects proxy StepTools into the parent registry. Remote tools are keyed `host{hostId}_{method}`. Local tools use
	 * bare method names, so the keys don't collide with local tools or with other remote hosts' tools.
	 */
	injectInto(registry: StepRegistry): void {
		if (this.hostId === undefined) throw new Error("RemoteStepperProxy.injectInto was called before setWorld read the host id. Call setWorld first.");
		const hostId = this.hostId;
		const remoteOrigin = new URL(this.remoteUrl).origin;
		const tools = this.stepDescriptors.map(
			(descriptor): StepTool => ({
				descriptor: { ...descriptor, method: hostScopedMethodName(hostId, descriptor.method), remoteOrigin },
				paramDomainKeys: new Map(),
				isAsync: true,
				transport: "remote",
				// The RPC call uses the unprefixed method name. The prefix names the tool in the local registry and isn't part
				// of the wire call. A statement's values are read where the statement was written, as a local step's are, so
				// the remote host receives values.
				handler: async (featureStep, world) => this.call(descriptor, await callInput(featureStep, world, runSteppers(world)), featureStep.seqPath),
			}),
		);
		registry.inject(tools);
	}

	/** Calls a step on the remote host and invokes the capability the step declares. The remote step's refusal is this step's
	 *  failure, in the host's words where the host gave them. A step that doesn't declare products doesn't return them,
	 *  whatever the host's response carries in their place. */
	private async call(descriptor: TStepDescriptor, params: Record<string, unknown>, seqPath: number[]): Promise<TActionResult> {
		const { method, capability } = descriptor;
		const called = await this.rpc.call(method, params, seqPath, capability);
		if (!called.served) return actionNotOK(called.reason);
		const answersWithProducts = descriptor.outputSchema !== undefined || descriptor.productsOf !== undefined;
		return answersWithProducts ? { ok: true, products: RecordSchema.parse(called.result) } : { ok: true };
	}

	/** Implements IStepTransport.attach. The interface is duck-typed, so this module doesn't import web-server-hono. */
	attach(registry: StepRegistry, _webserver: unknown): void {
		this.injectInto(registry);
	}

	/** Implements IStepTransport.detach. The HTTP transport doesn't hold a resource that needs cleanup. */
	detach(): void {
		/* no-op */
	}

	get descriptors(): TStepDescriptor[] {
		return this.stepDescriptors;
	}

	steps = {};
}

export default RemoteStepperProxy;
