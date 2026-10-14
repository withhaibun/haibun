/**
 * Runs each phase of actuality's start, and turns a phase's error into the executor result that reports which phase
 * failed and why.
 */
import { z } from "zod";
import type { TWorld } from "../../actuality/domains/world.js";
import type { TExecutorResult } from "../../../schema/protocol.js";
import type { AStepper } from "../domains/stepper.js";
import { INITIAL_ACTUALITY } from "../../actuality/machines/actuality.js";

/** The error a phase throws once it fails. It carries the executor result that reports the failure. */
export class PhaseBailError extends Error {
	constructor(public result: TExecutorResult) {
		super(`the phase ${result.failure?.stage} failed: ${result.failure?.error.message}`);
	}
}

export class PhaseRunner {
	public steppers: AStepper[] = [];

	/** `world` is undefined until the phase that builds it has run. */
	constructor(public world?: TWorld) {}

	public async tryPhase<T>(stage: string, fn: () => Promise<T> | T): Promise<T> {
		try {
			return await fn();
		} catch (error) {
			throw new PhaseBailError(this.createFailureResult(stage, error));
		}
	}

	/** An error as a phase's failure states it: each issue of a schema's refusal on its own line, or the error's message. */
	public static formatError(error: unknown): string {
		if (error instanceof z.ZodError) return error.issues.map((i: z.ZodIssue) => `  • ${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`).join("\n");
		return error instanceof Error ? error.message : String(error);
	}

	private createFailureResult(stage: string, error: unknown): TExecutorResult {
		return {
			ok: false,
			// A phase that fails before the world is built fails before an execution starts.
			actuality: this.world === undefined ? INITIAL_ACTUALITY : this.world.runtime.actuality.state.get(),
			shared: this.world?.shared,
			tag: this.world?.tag,
			failure: { stage, error: { message: PhaseRunner.formatError(error), details: { stack: error instanceof Error ? error.stack : undefined } } },
			steppers: this.steppers,
			featureResults: [],
		};
	}
}
