/**
 * remote-stepper-proxy.ts
 *
 * Client-side proxy for a remote haibun host. Reads step descriptors through
 * the host's show steps step, then injects proxy StepTools into
 * the parent registry. Each proxy handler forwards calls over HTTP, signed
 * for the capability the remote step declares, where it declares one.
 *
 * Follows the same pattern as SubprocessTransport.injectInto() but uses
 * HTTP/JSON-RPC instead of Node.js fork() IPC.
 */

import { RecordSchema } from "./json-text.js";
import { AStepper } from "./astepper.js";
import { runSteppers, type TWorld } from "./world.js";
import type { TActionResult } from "../schema/protocol.js";
import { actionNotOK } from "./util/index.js";
import { type StepTool, type StepRegistry, hostScopedMethodName } from "./step-registry.js";
import { callInput } from "./populateActionArgs.js";
import { EVERY_DEFINITION, SHOW_STEPS_ACTION, SHOW_STEPS_METHOD, readShownSteps, type TStepDescriptor } from "./step-discovery.js";
import { RpcCallFailed, RpcClient, discoverInstance } from "./rpc-client.js";
import { requestSigner } from "./session-authority.js";

export class RemoteStepperProxy extends AStepper {
	readonly name: string;
	description: string;
	private stepDescriptors: TStepDescriptor[] = [];
	private rpc: RpcClient;
	/**
	 * Remote host's hostId, discovered at setWorld via action.begin.
	 * Used to prefix registry keys so multiple remotes (and local) don't
	 * collide on identical method names.
	 */
	private hostId: number | undefined;

	constructor(private remoteUrl: string) {
		super();
		const host = new URL(remoteUrl).host;
		this.name = `RemoteProxy_${host.replace(/[^a-zA-Z0-9]/g, "_")}`;
		this.description = `Proxy for remote stepper host at ${remoteUrl}`;
		this.rpc = new RpcClient({ baseUrl: remoteUrl, sign: (request, action) => requestSigner(this.getWorld().runtime)(request, action) });
	}

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		await super.setWorld(world, steppers);
		await this.discoverHostId();
		await this.fetchStepDescriptors();
	}

	/** Read the host id through the handshake every remote surface begins with, so injected tools carry its prefix. */
	private async discoverHostId(): Promise<void> {
		this.hostId = (await discoverInstance(this.rpc, this.remoteUrl)).hostId;
	}

	/** The remote host's hostId. Undefined before setWorld completes. */
	get remoteHostId(): number | undefined {
		return this.hostId;
	}

	/** Read every step the remote host offers this process, through the step every caller reads a run's declarations by:
	 *  signed like any other call, so the host shows the steps this process holds there and doesn't show others. */
	private async fetchStepDescriptors(): Promise<void> {
		const result = await this.rpc.call(SHOW_STEPS_METHOD, EVERY_DEFINITION, [], { action: SHOW_STEPS_ACTION });
		this.stepDescriptors = readShownSteps(result, EVERY_DEFINITION.detail).steps.map(({ _links, ...descriptor }) => descriptor);
	}

	/**
	 * Inject proxy StepTools into the parent registry. Remote tools are
	 * keyed `host{hostId}_{method}` so they never collide with local tools
	 * (bare method names) or with other remote hosts.
	 */
	injectInto(registry: StepRegistry): void {
		if (this.hostId === undefined) throw new Error("RemoteStepperProxy.injectInto called before setWorld discovered the host id");
		const hostId = this.hostId;
		const remoteOrigin = new URL(this.remoteUrl).origin;
		const tools = this.stepDescriptors.map(
			(descriptor): StepTool => ({
				descriptor: { ...descriptor, method: hostScopedMethodName(hostId, descriptor.method), remoteOrigin },
				paramDomainKeys: new Map(),
				isAsync: true,
				transport: "remote",
				// Dispatch over RPC using the un-prefixed method name: the prefix is
				// a local registry-naming concern, not part of the wire call.
				// A statement's values are read where it was written, as a local step's are, so the far side is sent values.
				handler: async (featureStep, world) => this.call(descriptor, await callInput(featureStep, world, runSteppers(world)), featureStep.seqPath),
			}),
		);
		registry.inject(tools);
	}

	/** Call a step on the remote host via shared RpcClient, invoking the capability it declares. A step that doesn't declare
	 *  products doesn't return them, whatever the answer carries in their place. */
	private async call(descriptor: TStepDescriptor, params: Record<string, unknown>, seqPath: number[]): Promise<TActionResult> {
		const { method, capability } = descriptor;
		// The remote step's refusal is this step's failure; a call that fails some other way is thrown.
		const result = await this.rpc.call(method, params, seqPath, { action: capability }).catch((e: unknown) => {
			if (e instanceof RpcCallFailed) return e;
			throw e;
		});
		if (result instanceof RpcCallFailed) return actionNotOK(`${method}: ${result.reason}`);
		const answersWithProducts = descriptor.outputSchema !== undefined || descriptor.productsOf !== undefined;
		return answersWithProducts ? { ok: true, products: RecordSchema.parse(result) } : { ok: true };
	}

	/** IStepTransport.attach: duck-typed, so it doesn't need an import from web-server-hono. */
	attach(registry: StepRegistry, _webserver: unknown): void {
		this.injectInto(registry);
	}

	/** IStepTransport.detach: HTTP transport doesn't hold a resource that needs cleanup. */
	detach(): void {
		/* no-op */
	}

	get descriptors(): TStepDescriptor[] {
		return this.stepDescriptors;
	}

	steps = {};
}
