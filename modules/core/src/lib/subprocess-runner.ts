/**
 * subprocess-runner.ts
 *
 * Minimal child-process entry point for subprocess sandboxing (Phase 6).
 * Spawned by SubprocessTransport. Reads JSON-RPC 2.0 from stdin, dispatches
 * to registered steppers, writes responses to stdout.
 *
 * Protocol (newline-delimited JSON over stdio):
 *   Startup:  child → { type: "ready", steps: StepDescriptor[] }
 *   Request:  parent → { jsonrpc: "2.0", id, method, params?, seqPath? }
 *   Response: child  → { jsonrpc: "2.0", id, result } | { jsonrpc: "2.0", id, error }
 */

import { createInterface } from "readline";
import type { CStepper, TWorld } from "./defs.js";
import { StepRegistry, validateToolInput } from "./step-dispatch.js";
import { createSteppers, setStepperWorldsAndDomains } from "./util/index.js";
import { addStepperConcerns } from "../phases/Executor.js";
import { StepperRegistry, type StepDescriptor } from "./stepper-registry.js";

export type SubprocessReadyMessage = {
	type: "ready";
	steps: StepDescriptor[];
};

/**
 * Run the subprocess event loop: set up steppers, emit ready, serve RPC calls via stdio.
 * Call this from the child process entry point.
 */
export async function runSubprocess(
	csteppers: CStepper[],
	world: TWorld,
): Promise<void> {
	const steppers = await createSteppers(csteppers);
	await setStepperWorldsAndDomains(steppers, world);
	await addStepperConcerns(world, steppers);

	const registry = new StepRegistry(steppers, world);
	const steps = StepperRegistry.getMetadata(steppers);

	// Signal readiness with step list so parent can register our steps
	const ready: SubprocessReadyMessage = { type: "ready", steps };
	process.stdout.write(JSON.stringify(ready) + "\n");

	// Serve RPC calls from stdin
	const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

	for await (const line of rl) {
		if (!line.trim()) continue;
		let req: { jsonrpc: string; id: string; method: string; params?: Record<string, unknown>; seqPath?: number[] };
		try {
			req = JSON.parse(line);
		} catch {
			continue;
		}
		if (req.jsonrpc !== "2.0" || !req.id || !req.method) continue;

		const tool = registry.get(req.method);
		if (!tool) {
			process.stdout.write(
				JSON.stringify({ jsonrpc: "2.0", id: req.id, error: `Method not found: ${req.method}` }) + "\n",
			);
			continue;
		}

		try {
			const params = req.params ?? {};
			const validated = validateToolInput(tool, params, world);
			const hr = await tool.handler(validated, req.seqPath);
			if (hr.ok) {
				process.stdout.write(
					JSON.stringify({ jsonrpc: "2.0", id: req.id, result: hr.products }) + "\n",
				);
			} else {
				process.stdout.write(
					JSON.stringify({ jsonrpc: "2.0", id: req.id, error: (hr as { ok: false; error: string }).error }) + "\n",
				);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stdout.write(
				JSON.stringify({ jsonrpc: "2.0", id: req.id, error: msg }) + "\n",
			);
		}
	}
}
