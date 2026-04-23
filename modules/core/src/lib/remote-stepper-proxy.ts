/**
 * remote-stepper-proxy.ts
 *
 * Client-side proxy for a remote haibun host. Fetches step descriptors via
 * the host's step.list RPC endpoint, then injects proxy StepTools into
 * the parent registry. Each proxy handler forwards calls over HTTP with
 * an Authorization: Bearer header.
 *
 * Follows the same pattern as SubprocessTransport.injectInto() but uses
 * HTTP/JSON-RPC instead of Node.js fork() IPC.
 */

import { AStepper } from "./astepper.js";
import type { TWorld } from "./execution.js";
import type { TActionResult } from "../schema/protocol.js";
import { actionNotOK } from "./util/index.js";
import { type StepTool, type StepRegistry, hostScopedMethodName } from "./step-dispatch.js";
import type { StepDescriptor } from "./stepper-registry.js";
import { RpcClient, type RpcError } from "./rpc-client.js";

export class RemoteStepperProxy extends AStepper {
	readonly name: string;
	private stepDescriptors: StepDescriptor[] = [];
	private rpc: RpcClient;
	/**
	 * Remote host's hostId, discovered at setWorld via session.beginAction.
	 * Used to prefix registry keys so multiple remotes (and local) don't
	 * collide on identical method names.
	 */
	private hostId: number | undefined;

	constructor(
		private remoteUrl: string,
		private token?: string,
	) {
		super();
		const host = new URL(remoteUrl).host;
		this.name = `RemoteProxy_${host.replace(/[^a-zA-Z0-9]/g, "_")}`;
		this.description = `Proxy for remote stepper host at ${remoteUrl}`;
		this.rpc = new RpcClient({ baseUrl: remoteUrl, capabilityToken: token });
	}

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		await super.setWorld(world, steppers);
		await this.discoverHostId();
		await this.fetchStepDescriptors();
	}

	/** Read hostId from session.beginAction so injected tools carry a correct prefix. */
	private async discoverHostId(): Promise<void> {
		const result = await this.rpc.call<{ hostId?: number; seqPath?: number[] }>("session.beginAction", {}, []);
		if ("error" in result) {
			throw new Error(`RemoteStepperProxy: session.beginAction failed at ${this.remoteUrl}: ${(result as { error: string }).error}`);
		}
		const id = (result as { hostId?: number; seqPath?: number[] }).hostId ?? (result as { seqPath?: number[] }).seqPath?.[0];
		if (typeof id !== "number") {
			throw new Error(`RemoteStepperProxy: session.beginAction at ${this.remoteUrl} did not surface a hostId`);
		}
		this.hostId = id;
	}

	/** The remote host's hostId. Undefined before setWorld completes. */
	get remoteHostId(): number | undefined {
		return this.hostId;
	}

	/**
	 * Fetch step.list from the remote host. step.list is introspection,
	 * explicitly exempt from the seqPath-required rule (per commit 5), so
	 * we pass an empty seqPath — the remote's step.list handler doesn't
	 * look at it.
	 */
	private async fetchStepDescriptors(): Promise<void> {
		const result = await this.rpc.call<{ steps?: StepDescriptor[] }>("step.list", {}, []);
		if ("error" in result) {
			throw new Error(`RemoteStepperProxy: step.list failed at ${this.remoteUrl}: ${result.error}`);
		}
		this.stepDescriptors = result.steps ?? [];
	}

	/**
	 * Inject proxy StepTools into the parent registry. Remote tools are
	 * keyed `${hostId}:${method}` so they never collide with local tools
	 * (bare method names) or with other remote hosts.
	 */
	injectInto(registry: StepRegistry): void {
		if (this.hostId === undefined) throw new Error("RemoteStepperProxy.injectInto called before setWorld discovered the host id");
		for (const descriptor of this.stepDescriptors) {
			const prefixedMethod = hostScopedMethodName(this.hostId, descriptor.method);
			const tool: StepTool = {
				name: prefixedMethod,
				description: descriptor.pattern,
				inputSchema: (descriptor.inputSchema as StepTool["inputSchema"]) ?? { type: "object" },
				paramSchemas: new Map(),
				paramDomainKeys: new Map(),
				stepperName: descriptor.stepperName,
				stepName: descriptor.stepName,
				capability: descriptor.capability,
				isAsync: true,
				transport: "remote",
				remoteHost: new URL(this.remoteUrl).host,
				// Dispatch over RPC using the un-prefixed method name — the prefix is
				// a local registry-naming concern, not part of the wire call.
				handler: (_featureStep, _world) =>
					this.call(
						descriptor.method,
						_featureStep.action?.stepValuesMap
							? Object.fromEntries(Object.entries(_featureStep.action.stepValuesMap).map(([k, v]) => [k, v.term]))
							: {},
						_featureStep.seqPath,
					),
			};
			registry.set(tool);
		}
	}

	/** Call a step on the remote host via shared RpcClient. */
	private async call(method: string, params: Record<string, unknown>, seqPath: number[] = []): Promise<TActionResult> {
		const result = await this.rpc.call<Record<string, unknown>>(method, params, seqPath);
		if ("error" in result && typeof (result as RpcError).error === "string") {
			return actionNotOK(`${method}: ${(result as RpcError).error}`);
		}
		return { ok: true, products: result as Record<string, unknown> };
	}

	/** IStepTransport.attach — duck-typed, no import needed from web-server-hono. */
	attach(registry: StepRegistry, _webserver: unknown): void {
		this.injectInto(registry);
	}

	/** IStepTransport.detach — nothing to clean up for HTTP transport. */
	detach(): void {
		/* no-op */
	}

	get descriptors(): StepDescriptor[] {
		return this.stepDescriptors;
	}

	steps = {};
}
