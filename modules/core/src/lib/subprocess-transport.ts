/**
 * subprocess-transport.ts
 *
 * Parent-side subprocess transport. Forks a child process running runSubprocess(),
 * reads its step list via IPC, and injects proxy StepTools into the parent's StepRegistry.
 *
 * Uses Node.js fork() IPC (structured-clone messages) — no framing, no seq IDs, no readline.
 * The child signals readiness with { type: "ready", steps }, then serves
 * { type: "call", method, params, seqPath } → { type: "result", ok, products|error }.
 *
 * seqPath threading: every call includes the caller's seqPath so the child
 * can append its own step numbers, preserving the full [feature.scenario.step...] hierarchy.
 */

import { fork, type ChildProcess } from "child_process";
import type { TWorld } from "./defs.js";
import type { TActionResult } from "../schema/protocol.js";
import { actionNotOK } from "./util/index.js";
import { type StepTool, type StepRegistry } from "./step-dispatch.js";
import type { StepDescriptor } from "./stepper-registry.js";
import type { SubprocessMessage, SubprocessResultMessage } from "./subprocess-runner.js";

export class SubprocessTransport {
	private constructor(
		private child: ChildProcess,
		private stepDescriptors: StepDescriptor[],
	) {
		child.on("exit", (code) => {
			if (this.pending) {
				this.pending({ type: "result", ok: false, error: `subprocess exited with code ${code}` });
				this.pending = null;
			}
		});
	}

	// At most one in-flight call at a time (subprocess steps execute sequentially).
	private pending: ((r: SubprocessResultMessage) => void) | null = null;

	static async spawn(entryPath: string, _world: TWorld): Promise<SubprocessTransport> {
		const child = fork(entryPath, [], { silent: true });

		child.stderr?.on("data", (data: Buffer) => {
			process.stderr.write(`[subprocess] ${data.toString()}`);
		});

		const stepDescriptors = await new Promise<StepDescriptor[]>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error(`subprocess at ${entryPath} did not send ready message within 10s`)), 10_000);

			child.once("message", (msg: SubprocessMessage) => {
				clearTimeout(timeout);
				if (msg.type !== "ready") {
					reject(new Error(`subprocess first message was not "ready": ${JSON.stringify(msg)}`));
					return;
				}
				resolve(msg.steps);
			});

			child.once("exit", (code) => {
				clearTimeout(timeout);
				reject(new Error(`subprocess exited before ready (code ${code})`));
			});
		});

		return new SubprocessTransport(child, stepDescriptors);
	}

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
				transport: "subprocess",
				handler: (featureStep, _world) =>
					this.call(
						descriptor.method,
						featureStep.action?.stepValuesMap ? Object.fromEntries(Object.entries(featureStep.action.stepValuesMap).map(([k, v]) => [k, v.term])) : {},
						featureStep.seqPath,
					),
			};
			registry.set(tool);
		}
	}

	call(method: string, params: Record<string, unknown>, seqPath?: number[]): Promise<TActionResult> {
		return new Promise((resolve, reject) => {
			if (this.pending) {
				reject(new Error("SubprocessTransport: concurrent calls not supported"));
				return;
			}
			this.pending = (result) => {
				this.pending = null;
				if (result.ok) {
					resolve({ ok: true, products: result.products });
				} else {
					resolve(actionNotOK((result as { type: "result"; ok: false; error: string }).error));
				}
			};
			this.child.on("message", this.handleMessage);
			this.child.send({ type: "call", method, params, seqPath: seqPath ?? [0] });
		});
	}

	private handleMessage = (msg: SubprocessMessage) => {
		if (msg.type !== "result") return;
		this.child.off("message", this.handleMessage);
		if (this.pending) this.pending(msg);
	};

	kill(): void {
		this.child.kill();
	}

	get descriptors(): StepDescriptor[] {
		return this.stepDescriptors;
	}
}
