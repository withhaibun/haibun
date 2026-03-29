/**
 * subprocess-transport.ts
 *
 * Parent-side subprocess transport (Phase 6).
 * Spawns a child process running runSubprocess(), reads its step list,
 * and injects proxy StepTools into the parent's StepRegistry that dispatch
 * calls to the child via stdin/stdout JSON-RPC.
 *
 * seqPath threading: every call includes the caller's seqPath so the child
 * can append its own step numbers, preserving the full [feature.scenario.step...] hierarchy.
 *
 * Usage:
 *   const transport = await SubprocessTransport.spawn('/path/to/child-entry.js', world);
 *   transport.injectInto(registry);
 *   // ... run tests ...
 *   transport.kill();
 */

import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import type { TWorld } from "./defs.js";
import { type StepTool, type StepRegistry } from "./step-dispatch.js";
import type { StepDescriptor } from "./stepper-registry.js";
import type { SubprocessReadyMessage } from "./subprocess-runner.js";

type PendingCall = {
	resolve: (value: { ok: true; products: Record<string, unknown> } | { ok: false; error: string }) => void;
	reject: (err: Error) => void;
};

export class SubprocessTransport {
	private child: ChildProcess;
	private pending = new Map<string, PendingCall>();
	private seq = 0;
	private stepDescriptors: StepDescriptor[] = [];

	private constructor(child: ChildProcess, stepDescriptors: StepDescriptor[]) {
		this.child = child;
		this.stepDescriptors = stepDescriptors;

		child.stderr?.on("data", (data: Buffer) => {
			process.stderr.write(`[subprocess] ${data.toString()}`);
		});

		child.on("exit", (code) => {
			for (const [id, p] of this.pending) {
				p.reject(new Error(`subprocess exited with code ${code} (pending: ${id})`));
			}
			this.pending.clear();
		});
	}

	/**
	 * Spawn a child subprocess, wait for its ready message, then attach the response listener.
	 * Uses a single readline interface for the entire lifetime of the child process.
	 */
	static async spawn(entryPath: string, _world: TWorld): Promise<SubprocessTransport> {
		const child = spawn(process.execPath, [entryPath], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		// Single readline — handles both the ready message and all subsequent RPC responses.
		const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });

		const stepDescriptors = await new Promise<StepDescriptor[]>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error(`subprocess at ${entryPath} did not send ready message within 10s`));
			}, 10_000);

			rl.once("line", (line) => {
				clearTimeout(timeout);
				try {
					const msg = JSON.parse(line) as SubprocessReadyMessage;
					if (msg.type !== "ready") {
						reject(new Error(`subprocess first message was not "ready": ${line}`));
						return;
					}
					resolve(msg.steps);
				} catch (e) {
					reject(new Error(`subprocess ready parse failed: ${e}`));
				}
			});

			child.on("exit", (code) => {
				clearTimeout(timeout);
				reject(new Error(`subprocess exited before ready (code ${code})`));
			});
		});

		const transport = new SubprocessTransport(child, stepDescriptors);

		// Attach RPC response handler on the same readline instance
		rl.on("line", (line) => {
			if (!line.trim()) return;
			let msg: { jsonrpc: string; id: string; result?: Record<string, unknown>; error?: string };
			try {
				msg = JSON.parse(line);
			} catch {
				return;
			}
			const pending = transport.pending.get(msg.id);
			if (!pending) return;
			transport.pending.delete(msg.id);
			if (msg.error !== undefined) {
				pending.resolve({ ok: false, error: msg.error });
			} else {
				pending.resolve({ ok: true, products: msg.result ?? {} });
			}
		});

		return transport;
	}

	/**
	 * Inject proxy StepTools for each child step into the parent registry.
	 * Each tool's handler pipes the call to the child and returns its response.
	 */
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
				handler: async (input, seqPath) => {
					return this.call(descriptor.method, input, seqPath);
				},
			};
			registry.set(tool);
		}
	}

	/**
	 * Send a JSON-RPC call to the child and await the response.
	 */
	call(
		method: string,
		params: Record<string, unknown>,
		seqPath?: number[],
	): Promise<{ ok: true; products: Record<string, unknown> } | { ok: false; error: string }> {
		return new Promise((resolve, reject) => {
			const id = `sp-${++this.seq}`;
			this.pending.set(id, { resolve, reject });
			const req = {
				jsonrpc: "2.0" as const,
				id,
				method,
				params,
				seqPath: seqPath ?? [0],
			};
			this.child.stdin!.write(JSON.stringify(req) + "\n");
		});
	}

	/**
	 * Kill the child process and clean up.
	 */
	kill(): void {
		this.child.stdin?.end();
		this.child.kill();
	}

	get descriptors(): StepDescriptor[] {
		return this.stepDescriptors;
	}
}
