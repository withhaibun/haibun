/**
 * Runs statements and steps that a step runs within itself, such as a condition, a proof or an activity. Each runs as a
 * substep of the step that runs it, through dispatch, and inherits that step's intent.
 */
import type { TStepInput } from "../../actuality/domains/execution.js";
import type { TWorld } from "../../actuality/domains/world.js";
import type { TSeqPath, TActionResult, TStepResult, ExecutionIntent } from "../../domains/protocol.js";
import type { AStepper, TFeatureStep } from "../domains/stepper.js";
import { actionNotOK, errorDetail } from "../../util/index.js";
import { Resolver } from "../../actuality/pipelines/resolver.js";
import { nextSeqPath } from "../../actuality/pipelines/step-dispatch.js";
import { syntheticSeqPathDirection } from "../../actuality/domains/seq-path.js";
import { dispatchStep } from "../../actuality/pipelines/step-dispatch.js";
import { runRegistry, type StepRegistry } from "./step-registry.js";

/** How a step runs: its intent, its parent step and its target host. */
type TRunOptions = { intent?: ExecutionIntent; parentStep?: TFeatureStep; targetHostId?: number };
/** How a statement runs: the arguments it binds, its intent and its parent step. */
type TStatementOptions = { args?: Record<string, string>; intent?: ExecutionIntent; parentStep?: TFeatureStep };

/** The intent of a statement that doesn't state one and doesn't run under a step: actuality's own claim. */
const AUTHORITATIVE: ExecutionIntent = { mode: "authoritative" };
/** The source of a statement that its step, its parent, its input and the feature in progress don't locate. */
const DYNAMIC_SOURCE = "<dynamic>";

/**
 * The intent a statement runs with: the one stated, or the intent of the step that runs it. A statement run under a
 * speculative step is part of what that step tries, not a claim of actuality's own, so speculation is inherited, and a
 * caller that means otherwise states an intent of its own.
 */
function intentOf(stated: ExecutionIntent | undefined, parentStep: TFeatureStep | undefined): ExecutionIntent {
	if (stated !== undefined) return stated;
	return parentStep?.intent === undefined ? AUTHORITATIVE : parentStep.intent;
}

/** The mode a statement run under `parentStep` takes where it doesn't state one: the step's own, else actuality's claim. */
export const inheritedMode = (parentStep: TFeatureStep): ExecutionIntent["mode"] => intentOf(undefined, parentStep).mode;

export class FlowRunner {
	private resolver: Resolver;

	constructor(
		private world: TWorld,
		private steppers: AStepper[],
	) {
		this.resolver = new Resolver(steppers, []);
	}

	/** Read at dispatch time: Executor assigns actuality's registry after the steppers' setWorld. */
	private get registry(): StepRegistry {
		return runRegistry(this.world);
	}

	/** The source of a statement: its step's, its parent's, its input's, or the feature in progress. */
	private sourceOf(step: TFeatureStep["action"]["step"], statement: string | TStepInput, parentStep: TFeatureStep | undefined): { path: string; lineNumber?: number } {
		if (step.source?.path) return { path: step.source.path, lineNumber: step.source.lineNumber };
		if (parentStep?.source?.path) return { path: parentStep.source.path, lineNumber: parentStep.source.lineNumber };
		if (typeof statement !== "string" && statement.source?.path) return { path: statement.source.path, lineNumber: statement.source.lineNumber };
		const { currentFeaturePath } = this.world.runtime;
		return { path: currentFeaturePath === undefined ? DYNAMIC_SOURCE : currentFeaturePath };
	}

	async runStatement(statement: string | TStepInput, options: TStatementOptions & { seqPath?: TSeqPath }): Promise<TActionResult> {
		const intent = intentOf(options.intent, options.parentStep);
		const stmtText = typeof statement === "string" ? statement : statement.in;
		let action: TFeatureStep["action"];
		try {
			action = this.resolver.findSingleStepAction(stmtText);
		} catch (e: unknown) {
			if (intent.mode === "speculative") return actionNotOK(`the statement ${stmtText} doesn't resolve to a step: ${errorDetail(e)}`);
			throw e;
		}
		const { parentStep } = options;
		const seqPath = options.seqPath === undefined ? parentStep && nextSeqPath(this.world, parentStep.seqPath, 1) : options.seqPath;
		if (seqPath === undefined) throw new Error(`the statement ${stmtText} runs without a seqPath or a parent step; state one of them`);
		const mergedArgs = { ...parentStep?.runtimeArgs, ...options.args };
		const featureStep: TFeatureStep = {
			source: this.sourceOf(action.step, statement, parentStep),
			in: stmtText,
			seqPath,
			action,
			intent,
			isSubStep: parentStep !== undefined,
			isAfterEveryStep: parentStep?.isAfterEveryStep,
			runtimeArgs: Object.keys(mergedArgs).length > 0 ? mergedArgs : undefined,
		};
		try {
			return await dispatchStep({ registry: this.registry, world: this.world, steppers: this.steppers }, featureStep);
		} catch (e: unknown) {
			if (intent.mode === "speculative") return actionNotOK(`the statement ${stmtText} threw: ${errorDetail(e)}`);
			throw e;
		}
	}

	/** Runs statements in order, and returns the first failure or the last result. An empty list passes. */
	async runStatements(statements: (string | TStepInput)[], options: TStatementOptions): Promise<TActionResult> {
		let lastResult: TActionResult = { ok: true };
		for (const stmt of statements) {
			lastResult = await this.runStatement(stmt, options);
			if (!lastResult.ok) return lastResult;
		}
		return lastResult;
	}

	/** Dispatches one step, as a substep of `parentStep` where one is stated, and returns its result with the path of its record. */
	runStep(step: TFeatureStep, options: TRunOptions): Promise<TStepResult> {
		const { parentStep, targetHostId } = options;
		const intent = intentOf(options.intent, parentStep);
		let mappedStep: TFeatureStep = {
			...step,
			intent,
			runtimeArgs: { ...parentStep?.runtimeArgs, ...step.runtimeArgs },
			targetHostId: targetHostId === undefined ? step.targetHostId : targetHostId,
		};
		if (parentStep) {
			const isAfterEvery = parentStep.isAfterEveryStep || mappedStep.isAfterEveryStep;
			const dir = syntheticSeqPathDirection(intent.mode === "speculative" || isAfterEvery === true);
			const seqPath = nextSeqPath(this.world, parentStep.seqPath, dir);
			mappedStep = { ...mappedStep, seqPath, isSubStep: true, isAfterEveryStep: isAfterEvery };
		}
		return dispatchStep({ registry: this.registry, world: this.world, steppers: this.steppers }, mappedStep);
	}

	/** Runs steps in order, and returns the first failure or the last result. An empty list passes. */
	async runSteps(steps: TFeatureStep[], options: TRunOptions): Promise<TActionResult> {
		const intent = intentOf(options.intent, options.parentStep);
		let lastResult: TActionResult = { ok: true };
		for (const step of steps) {
			try {
				lastResult = await this.runStep(step, { ...options, intent });
				if (!lastResult.ok) return lastResult;
			} catch (e) {
				if (intent.mode === "speculative") return actionNotOK(`the step ${step.in} threw: ${errorDetail(e)}`);
				throw e;
			}
		}
		return lastResult;
	}
}
