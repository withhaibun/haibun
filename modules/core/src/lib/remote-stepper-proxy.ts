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

import { AStepper } from "./astepper.js";
import type { TWorld } from "./world.js";
import type { TActionResult } from "../schema/protocol.js";
import { actionNotOK } from "./util/index.js";
import { type StepTool, type StepRegistry, hostScopedMethodName } from "./step-registry.js";
import { populateActionArgs } from "./populateActionArgs.js";
import { EVERY_DEFINITION, SHOW_STEPS_ACTION, SHOW_STEPS_METHOD, readShownSteps, type TStepDescriptor } from "./step-discovery.js";
import { RpcClient, type RpcError } from "./rpc-client.js";
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

	/** Read hostId from action.begin so injected tools carry a correct prefix. */
	private async discoverHostId(): Promise<void> {
		const result = await this.rpc.call<{ hostId?: number; seqPath?: number[] }>("action.begin", {}, []);
		if ("error" in result) {
			throw new Error(`RemoteStepperProxy: action.begin failed at ${this.remoteUrl}: ${(result as { error: string }).error}`);
		}
		const id = (result as { hostId?: number; seqPath?: number[] }).hostId ?? (result as { seqPath?: number[] }).seqPath?.[0];
		if (typeof id !== "number") {
			throw new Error(`RemoteStepperProxy: action.begin at ${this.remoteUrl} did not surface a hostId`);
		}
		this.hostId = id;
	}

	/** The remote host's hostId. Undefined before setWorld completes. */
	get remoteHostId(): number | undefined {
		return this.hostId;
	}

	/** Read every step the remote host offers this process, through the step every caller reads a run's declarations by:
	 *  signed like any other call, so the host shows the steps this process holds there and no others. */
	private async fetchStepDescriptors(): Promise<void> {
		const result = await this.rpc.call<Record<string, unknown>>(SHOW_STEPS_METHOD, EVERY_DEFINITION, [], { action: SHOW_STEPS_ACTION });
		if ("error" in result) {
			throw new Error(`RemoteStepperProxy: ${SHOW_STEPS_METHOD} failed at ${this.remoteUrl}: ${result.error}`);
		}
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
		const remoteHost = new URL(this.remoteUrl).host;
		const tools = this.stepDescriptors.map(
			(descriptor): StepTool => ({
				descriptor: { ...descriptor, method: hostScopedMethodName(hostId, descriptor.method), remoteHost },
				paramSchemas: new Map(),
				paramDomainKeys: new Map(),
				isAsync: true,
				transport: "remote",
				// Dispatch over RPC using the un-prefixed method name: the prefix is
				// a local registry-naming concern, not part of the wire call.
				// A statement's values are read where it was written, as a local step's are, so the far side is sent values.
				handler: async (featureStep, world) =>
					this.call(descriptor.method, await populateActionArgs(featureStep, world, world.runtime.steppers), featureStep.seqPath, descriptor.capability),
			}),
		);
		registry.inject(tools);
	}

	/** Call a step on the remote host via shared RpcClient, invoking the capability it declares, where it declares one. */
	private async call(method: string, params: Record<string, unknown>, seqPath: number[], action: string): Promise<TActionResult> {
		const result = await this.rpc.call<Record<string, unknown>>(method, params, seqPath, { action });
		if ("error" in result && typeof (result as RpcError).error === "string") {
			return actionNotOK(`${method}: ${(result as RpcError).error}`);
		}
		return { ok: true, products: result as Record<string, unknown> };
	}

	/** IStepTransport.attach: duck-typed, no import needed from web-server-hono. */
	attach(registry: StepRegistry, _webserver: unknown): void {
		this.injectInto(registry);
	}

	/** IStepTransport.detach: nothing to clean up for HTTP transport. */
	detach(): void {
		/* no-op */
	}

	get descriptors(): TStepDescriptor[] {
		return this.stepDescriptors;
	}

	steps = {};
}
