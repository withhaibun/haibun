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
import type { TWorld } from "./defs.js";
import type { TActionResult } from "../schema/protocol.js";
import { actionNotOK } from "./util/index.js";
import { type StepTool, type StepRegistry } from "./step-dispatch.js";
import type { StepDescriptor } from "./stepper-registry.js";

export class RemoteStepperProxy extends AStepper {
	readonly name: string;
	private stepDescriptors: StepDescriptor[] = [];

	constructor(
		private remoteUrl: string,
		private token?: string,
	) {
		super();
		const host = new URL(remoteUrl).host;
		this.name = `RemoteProxy_${host.replace(/[^a-zA-Z0-9]/g, "_")}`;
		this.description = `Proxy for remote stepper host at ${remoteUrl}`;
	}

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		await super.setWorld(world, steppers);
		await this.fetchStepDescriptors();
	}

	/** Fetch step.list from the remote host to discover available steps. */
	private async fetchStepDescriptors(): Promise<void> {
		const res = await fetch(`${this.remoteUrl}/rpc/step.list`, {
			method: "POST",
			headers: this.buildHeaders(),
			body: JSON.stringify({ jsonrpc: "2.0", id: "discover", method: "step.list", params: {} }),
		});
		if (!res.ok) throw new Error(`RemoteStepperProxy: step.list failed at ${this.remoteUrl}: ${res.status} ${res.statusText}`);
		const data = (await res.json()) as { steps?: StepDescriptor[] };
		this.stepDescriptors = data.steps ?? [];
	}

	/** Inject proxy StepTools into the parent registry. Same pattern as SubprocessTransport.injectInto(). */
	injectInto(registry: StepRegistry): void {
		for (const descriptor of this.stepDescriptors) {
			const tool: StepTool = {
				name: descriptor.method,
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

	/** Call a step on the remote host via HTTP/JSON-RPC. */
	private async call(method: string, params: Record<string, unknown>, seqPath?: number[]): Promise<TActionResult> {
		try {
			const res = await fetch(`${this.remoteUrl}/rpc/${method}`, {
				method: "POST",
				headers: this.buildHeaders(),
				body: JSON.stringify({ jsonrpc: "2.0", id: `rpc-${Date.now()}`, method, params, seqPath }),
			});
			const data = (await res.json()) as Record<string, unknown>;
			if (!res.ok || data.error) return actionNotOK(`${method}: ${data.error || `HTTP ${res.status}`}`);
			return { ok: true, products: data as Record<string, unknown> };
		} catch (err) {
			return actionNotOK(`${method}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
		return headers;
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
