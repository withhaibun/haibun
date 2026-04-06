/**
 * subprocess-runner.ts
 *
 * Child process entry point for subprocess sandboxing.
 * Forked by SubprocessTransport. Uses Node.js IPC (process.send / process.on('message')).
 *
 * Protocol (structured-clone messages over IPC):
 *   Startup:  child → { type: "ready", steps: StepDescriptor[] }
 *   Request:  parent → { type: "call", method, params?, seqPath? }
 *   Response: child  → { type: "result", ok: true, products } | { type: "result", ok: false, error }
 */

import type { CStepper, TWorld } from "./defs.js";
import { StepRegistry, validateToolInput, buildSyntheticFeatureStep } from "./step-dispatch.js";
import { createSteppers, setStepperWorldsAndDomains } from "./util/index.js";
import { addStepperConcerns } from "../phases/Executor.js";
import { StepperRegistry, type StepDescriptor } from "./stepper-registry.js";

export type SubprocessReadyMessage = { type: "ready"; steps: StepDescriptor[] };
export type SubprocessCallMessage = { type: "call"; method: string; params?: Record<string, unknown>; seqPath?: number[] };
export type SubprocessResultMessage = { type: "result"; ok: true; products: Record<string, unknown> } | { type: "result"; ok: false; error: string };

export type SubprocessMessage = SubprocessReadyMessage | SubprocessCallMessage | SubprocessResultMessage;

export async function runSubprocess(csteppers: CStepper[], world: TWorld): Promise<void> {
	const steppers = await createSteppers(csteppers);
	await setStepperWorldsAndDomains(steppers, world);
	await addStepperConcerns(world, steppers);
	world.runtime.steppers = steppers;

	const registry = new StepRegistry(steppers, world);
	const steps = StepperRegistry.getMetadata(steppers);

	process.send?.({ type: "ready", steps } satisfies SubprocessReadyMessage);

	process.on("message", async (msg: SubprocessMessage) => {
		if (msg.type !== "call") return;

		const tool = registry.get(msg.method);
		if (!tool) {
			process.send?.({ type: "result", ok: false, error: `Method not found: ${msg.method}` } satisfies SubprocessResultMessage);
			return;
		}

		try {
			const validated = validateToolInput(tool, msg.params ?? {}, world);
			const featureStep = buildSyntheticFeatureStep(tool, validated, msg.seqPath ?? [0]);
			const hr = await tool.handler(featureStep, world);
			if (hr.ok) {
				process.send?.({ type: "result", ok: true, products: hr.products ?? {} } satisfies SubprocessResultMessage);
			} else {
				process.send?.({ type: "result", ok: false, error: hr.errorMessage ?? "Step failed" } satisfies SubprocessResultMessage);
			}
		} catch (err) {
			process.send?.({
				type: "result",
				ok: false,
				error: err instanceof Error ? err.message : String(err),
			} satisfies SubprocessResultMessage);
		}
	});
}
