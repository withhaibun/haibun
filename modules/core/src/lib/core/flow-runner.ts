import { TWorld, TFeatureStep, TStepInput } from '../defs.js';
import { TSeqPath, TActionResult, TStepResult, ExecutionIntent } from '../../schema/protocol.js';
import { AStepper } from '../astepper.js';
import { actionNotOK } from '../util/index.js';
import { Resolver } from '../../phases/Resolver.js';
import { executeStep, incSeqPath, syntheticSeqPathDirection } from '../../phases/Executor.js';
import { StepRegistry } from '../step-dispatch.js';

export class FlowRunner {
	private resolver: Resolver;
	private registry: StepRegistry;

	constructor(private world: TWorld, private steppers: AStepper[]) {
		this.resolver = new Resolver(steppers);
		this.registry = (world.runtime?.stepRegistry as StepRegistry) ?? new StepRegistry(steppers, world);
	}

	async runStatement(statement: string | TStepInput, options: { args?: Record<string, string>, intent?: ExecutionIntent, parentStep?: TFeatureStep, seqPath?: TSeqPath } = {}): Promise<TActionResult> {
		const { intent = { mode: 'authoritative' } } = options;

		const stmtText = typeof statement === 'string' ? statement : statement.in;

		const allArgs = { ...options.parentStep?.runtimeArgs, ...options.args };
		let statementWithArgs = stmtText;
		if (Object.keys(allArgs).length > 0) {
			for (const [key, value] of Object.entries(allArgs)) {
				statementWithArgs = statementWithArgs.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
			}
		}

		let action;
		try {
			action = this.resolver.findSingleStepAction(statementWithArgs);
		} catch (e: unknown) {
			if (intent.mode === 'speculative') {
				return actionNotOK(e instanceof Error ? e.message : String(e));
			}
			throw e;
		}

		const step = action.step;
		let resolvedPath: string;
		let resolvedLineNumber: number | undefined;

		if (step?.source?.path) {
			resolvedPath = step.source.path;
			resolvedLineNumber = step.source.lineNumber;
		} else if (options.parentStep?.source?.path) {
			resolvedPath = options.parentStep.source.path;
			resolvedLineNumber = options.parentStep.source.lineNumber;
		} else if (typeof statement !== 'string' && statement.source?.path) {
			resolvedPath = statement.source.path;
			resolvedLineNumber = statement.source.lineNumber;
		} else if (this.world.runtime.currentFeaturePath) {
			resolvedPath = this.world.runtime.currentFeaturePath;
		} else {
			resolvedPath = '<dynamic>';
		}

		let seqPath = options.seqPath;
		if (!seqPath) {
			if (options.parentStep) {
				seqPath = incSeqPath(this.world.runtime.stepResults, [...options.parentStep.seqPath, 1], 1);
			} else {
				throw new Error(`runStatement requires seqPath or parentStep. Statement: ${stmtText}`);
			}
		}

		const mergedArgs = { ...options.parentStep?.runtimeArgs, ...options.args };

		const featureStep: TFeatureStep = {
			source: { path: resolvedPath, lineNumber: resolvedLineNumber },
			in: statementWithArgs,
			seqPath,
			action,
			intent,
			isSubStep: !!options.parentStep,
			isAfterEveryStep: options.parentStep?.isAfterEveryStep,
			runtimeArgs: Object.keys(mergedArgs).length > 0 ? mergedArgs : undefined,
		};

		try {
			const result: TStepResult = await executeStep(this.registry, this.steppers, featureStep, this.world);
			return result;
		} catch (e: unknown) {
			if (intent.mode === 'speculative') {
				return actionNotOK(e instanceof Error ? e.message : String(e));
			}
			throw e;
		}
	}

	async runStatements(statements: (string | TStepInput)[], options: { args?: Record<string, string>, intent?: ExecutionIntent, parentStep?: TFeatureStep } = {}): Promise<TActionResult> {
		let lastResult: TActionResult = { ok: true };
		for (const stmt of statements) {
			lastResult = await this.runStatement(stmt, options);
			if (!lastResult.ok) return lastResult;
		}
		return lastResult;
	}

	async runSteps(steps: TFeatureStep[], options: { intent?: ExecutionIntent, parentStep?: TFeatureStep } = {}): Promise<TActionResult> {
		const { intent = { mode: 'authoritative' }, parentStep } = options;
		let lastResult: TActionResult = { ok: true };

		for (const step of steps) {
			let mappedStep: TFeatureStep = {
				...step,
				intent,
				runtimeArgs: { ...parentStep?.runtimeArgs, ...step.runtimeArgs },
			};
			if (parentStep) {
				const baseSeqPath = [...parentStep.seqPath, 1];
				const isAfterEvery = parentStep.isAfterEveryStep || mappedStep.isAfterEveryStep;
				const dir = syntheticSeqPathDirection(intent.mode === 'speculative' || isAfterEvery);
				const seqPath = incSeqPath(this.world.runtime.stepResults, baseSeqPath, dir);
				mappedStep = { ...mappedStep, seqPath, isSubStep: true, isAfterEveryStep: isAfterEvery };
			}

			try {
				lastResult = await executeStep(this.registry, this.steppers, mappedStep, this.world);
				if (!lastResult.ok) return lastResult;
			} catch (e) {
				if (intent.mode === 'speculative') {
					return actionNotOK(e instanceof Error ? e.message : String(e));
				}
				throw e;
			}
		}
		return lastResult;
	}
}
