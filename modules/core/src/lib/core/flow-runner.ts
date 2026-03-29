import { TWorld, TFeatureStep, TStepInput } from '../defs.js';
import { TSeqPath, TNotOKActionResult } from '../../schema/protocol.js';
import { AStepper } from '../astepper.js';
import { Resolver } from '../../phases/Resolver.js';
import { executeStep, incSeqPath } from '../../phases/Executor.js';
import { ExecutionIntent, FlowSignal } from '../../schema/protocol.js';
import { StepRegistry } from '../step-dispatch.js';

export class FlowRunner {
	private resolver: Resolver;
	private registry: StepRegistry;

	constructor(private world: TWorld, private steppers: AStepper[]) {
		this.resolver = new Resolver(steppers);
		this.registry = new StepRegistry(steppers, world);
	}

	async runStatement(statement: string | TStepInput, options: { args?: Record<string, string>, intent?: ExecutionIntent, parentStep?: TFeatureStep, seqPath?: TSeqPath } = {}): Promise<FlowSignal> {
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
				return { kind: 'fail', message: e instanceof Error ? e.message : String(e) };
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

		let result;
		try {
			result = await executeStep(this.registry, this.steppers, featureStep, this.world);
		} catch (e: unknown) {
			if (intent.mode === 'speculative') {
				return { kind: 'fail', message: e instanceof Error ? e.message : String(e) };
			}
			throw e;
		}

		if (result.ok) {
			return { kind: 'ok', products: result.stepActionResult };
		}
		const msg = (result.stepActionResult as TNotOKActionResult).message;
		return { kind: 'fail', message: msg, products: result.stepActionResult };
	}

	async runStatements(statements: (string | TStepInput)[], options: { args?: Record<string, string>, intent?: ExecutionIntent, parentStep?: TFeatureStep } = {}): Promise<FlowSignal> {
		let lastResult: FlowSignal | undefined;
		for (const stmt of statements) {
			const result = await this.runStatement(stmt, options);
			if (result.kind !== 'ok') return result;
			lastResult = result;
		}
		return { kind: 'ok', products: lastResult?.products };
	}

	async runSteps(steps: TFeatureStep[], options: { intent?: ExecutionIntent, parentStep?: TFeatureStep } = {}): Promise<FlowSignal> {
		const { intent = { mode: 'authoritative' }, parentStep } = options;
		let lastResult: FlowSignal | undefined;

		for (const step of steps) {
			let mappedStep: TFeatureStep = {
				...step,
				intent,
				runtimeArgs: { ...parentStep?.runtimeArgs, ...step.runtimeArgs },
			};
			if (parentStep) {
				const baseSeqPath = [...parentStep.seqPath, 1];
				const dir = intent.mode === 'speculative' ? -1 : 1;
				const seqPath = incSeqPath(this.world.runtime.stepResults, baseSeqPath, dir);
				mappedStep = { ...mappedStep, seqPath, isSubStep: true, isAfterEveryStep: parentStep.isAfterEveryStep || mappedStep.isAfterEveryStep };
			}

			let result;
			try {
				result = await executeStep(this.registry, this.steppers, mappedStep, this.world);
			} catch (e) {
				if (intent.mode === 'speculative') {
					return { kind: 'fail', message: e instanceof Error ? e.message : String(e) };
				}
				throw e;
			}

			if (!result.ok) {
				const msg = (result.stepActionResult as TNotOKActionResult).message;
				return { kind: 'fail', message: msg, products: result.stepActionResult };
			}

			lastResult = { kind: 'ok', products: result.stepActionResult };
		}
		return { kind: 'ok', products: lastResult?.products };
	}
}
