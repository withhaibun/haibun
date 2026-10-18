/**
 * A client-side proxy for a remote haibun host. It reads step descriptors through the host's show steps step and
 * injects proxy StepTools into the parent registry. Each proxy handler forwards calls over HTTP. A call is signed for
 * the capability the remote step declares where the step declares one.
 */

import { AStepper } from "../steps/domains/stepper.js";
import type { TWorld } from "../actuality/domains/world.js";
import type { StepRegistry } from "../steps/pipelines/step-registry.js";
import type { TStepDescriptor } from "../steps/domains/step-discovery.js";
import { requestSigner } from "../domains/session-authority.js";
import type { TRemoteSteps } from "./ports.js";
import { remoteSteps } from "./root.js";
import { readRemoteHost, remoteTools, type TRemoteHost } from "./pipelines/remote-host.js";

export class RemoteStepperProxy extends AStepper {
	readonly name: string;
	description: string;
	private rpc: TRemoteSteps;
	/** The remote host's id and steps, read at setWorld. The host id prefixes registry keys, so tools from several remote
	 *  hosts and local tools don't collide on one method name. */
	private host: TRemoteHost | undefined;

	constructor(private remoteUrl: string) {
		super();
		const host = new URL(remoteUrl).host;
		this.name = `RemoteProxy_${host.replace(/[^a-zA-Z0-9]/g, "_")}`;
		this.description = `Proxy for remote stepper host at ${remoteUrl}`;
		this.rpc = remoteSteps(remoteUrl, (request, action) => requestSigner(this.getWorld().runtime)(request, action));
	}

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		await super.setWorld(world, steppers);
		this.host = await readRemoteHost(this.rpc, this.remoteUrl);
	}

	/** The remote host's hostId. Undefined before setWorld completes. */
	get remoteHostId(): number | undefined {
		return this.host?.hostId;
	}

	/** Injects proxy StepTools of the remote host's steps into the parent registry. */
	injectInto(registry: StepRegistry): void {
		if (this.host === undefined) throw new Error("RemoteStepperProxy.injectInto was called before setWorld read the remote host. Call setWorld first.");
		registry.inject(remoteTools(this.rpc, this.remoteUrl, this.host));
	}

	/** Implements IStepTransport.attach. The interface is duck-typed, so this module doesn't import web-server-hono. */
	attach(registry: StepRegistry, _webserver: unknown): void {
		this.injectInto(registry);
	}

	/** Implements IStepTransport.detach. The HTTP transport doesn't hold a resource that needs cleanup. */
	detach(): void {
		/* no-op */
	}

	/** The remote host's step descriptors. Undefined before setWorld completes. */
	get descriptors(): TStepDescriptor[] | undefined {
		return this.host?.descriptors;
	}

	steps = {};
}

export default RemoteStepperProxy;
