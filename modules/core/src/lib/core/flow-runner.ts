import { TWorld, TFeatureStep, TStepInput } from '../defs.js';
import { TSeqPath, TNotOKActionResult } from '../../schema/protocol.js';
import { AStepper } from '../astepper.js';
import { Resolver } from '../../phases/Resolver.js';
import { FeatureExecutor, incSeqPath } from '../../phases/Executor.js';
import { ExecutionIntent, FlowSignal } from '../../schema/protocol.js';

export class FlowRunner {
	private resolver: Resolver;

	constructor(private world: TWorld, private steppers: AStepper[]) {
		this.resolver = new Resolver(steppers);
	}

	async runStatement(statement: string | TStepInput, options: { args?: Record<string, string>, intent?: ExecutionIntent, parentStep?: TFeatureStep, seqPath?: TSeqPath } = {}): Promise<FlowSignal> {
		const { intent = { mode: 'authoritative' } } = options;

		const stmtText = typeof statement === 'string' ? statement : statement.in;

		// Merge parent runtimeArgs with current args (current takes precedence)
		// This enables nested quantifiers: outer vars are visible to inner statements
		const allArgs = { ...options.parentStep?.runtimeArgs, ...options.args };

		// Interpolate {varName} patterns using merged args
		let statementWithArgs = stmtText;
		if (Object.keys(allArgs).length > 0) {
			for (const [key, value] of Object.entries(allArgs)) {
				statementWithArgs = statementWithArgs.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
			}
		}

		// Resolve the action first - this gives us access to step metadata including source
		let action;
		try {
			action = this.resolver.findSingleStepAction(statementWithArgs);
		} catch (e: unknown) {
			if (intent.mode === 'speculative') {
				return { kind: 'fail', message: e instanceof Error ? e.message : String(e) };
			}
			throw e;
		}

		// Derive source path: prefer resolved step's source, then parentStep, then input statement
		const step = action.step;
		let resolvedPath: string;
		let resolvedLineNumber: number | undefined;

		if (step?.source?.path) {
			// Step definition has its own source (e.g., activity, waypoint)
			resolvedPath = step.source.path;
			resolvedLineNumber = step.source.lineNumber;
		} else if (options.parentStep?.source?.path) {
			// Fall back to parent step's source (e.g., quantifier calling nested statement)
			resolvedPath = options.parentStep.source.path;
			resolvedLineNumber = options.parentStep.source.lineNumber;
		} else if (typeof statement !== 'string' && statement.source?.path) {
			// Use input statement's source if provided
			resolvedPath = statement.source.path;
			resolvedLineNumber = statement.source.lineNumber;
		} else if (this.world.runtime.currentFeaturePath) {
			// Fall back to current feature path (e.g., debugger executing ad-hoc statements)
			resolvedPath = this.world.runtime.currentFeaturePath;
		} else {
			// No source available - use placeholder for dynamic/ad-hoc statements (debugger, REPL, etc.)
			resolvedPath = '<dynamic>';
		}

		// Compute seqPath for this statement
		let seqPath = options.seqPath;
		if (!seqPath) {
			if (options.parentStep) {
				seqPath = incSeqPath(this.world.runtime.stepResults, [...options.parentStep.seqPath, 1], 1);
			} else {
				throw new Error(`runStatement requires seqPath or parentStep. Statement: ${stmtText}`);
			}
		}

		// Merge parent args with current args (current takes precedence)
		const mergedArgs = { ...options.parentStep?.runtimeArgs, ...options.args };

		const featureStep: TFeatureStep = {
			source: {
				path: resolvedPath,
				lineNumber: resolvedLineNumber,
			},
			in: statementWithArgs,
			seqPath,
			action,
			intent,
			isSubStep: !!options.parentStep,
			runtimeArgs: Object.keys(mergedArgs).length > 0 ? mergedArgs : undefined
		};

		let result;
		try {
			result = await FeatureExecutor.doFeatureStep(this.steppers, featureStep, this.world);
		} catch (e: unknown) {
			if (intent.mode === 'speculative') {
				return { kind: 'fail', message: e instanceof Error ? e.message : String(e) };
			}
			throw e;
		}

		if (result.ok) {
			return { kind: 'ok', topics: result.stepActionResult };
		} else {
			const msg = (result.stepActionResult as TNotOKActionResult).message;
			return { kind: 'fail', message: msg, topics: result.stepActionResult };
		}
	}

	async runStatements(statements: (string | TStepInput)[], options: { args?: Record<string, string>, intent?: ExecutionIntent, parentStep?: TFeatureStep } = {}): Promise<FlowSignal> {
		let lastResult: FlowSignal | undefined;
		for (const stmt of statements) {
			const result = await this.runStatement(stmt, options);
			if (result.kind !== 'ok') {
				return result;
			}
			lastResult = result;
		}
		return { kind: 'ok', topics: lastResult?.topics };
	}

	async runSteps(steps: TFeatureStep[], options: { intent?: ExecutionIntent, parentStep?: TFeatureStep } = {}): Promise<FlowSignal> {
		const { intent = { mode: 'authoritative' }, parentStep } = options;

		let lastResult: FlowSignal | undefined;

		for (const step of steps) {
			let mappedStep: TFeatureStep = {
				...step,
				intent,
				runtimeArgs: { ...parentStep?.runtimeArgs, ...step.runtimeArgs }
			};
			if (parentStep) {
				// For nested steps, we append to the parent's seqPath.
				// We use incSeqPath to ensure we get a unique path based on what has already executed.
				// This handles loops and repeated calls correctly.
				const baseSeqPath = [...parentStep.seqPath, 1];
				const dir = intent.mode === 'speculative' ? -1 : 1;
				const seqPath = incSeqPath(this.world.runtime.stepResults, baseSeqPath, dir);
				mappedStep = { ...mappedStep, seqPath, isSubStep: true };
			}

			let result;
			try {
				result = await FeatureExecutor.doFeatureStep(this.steppers, mappedStep, this.world);
			} catch (e) {
				if (intent.mode === 'speculative') {
					return { kind: 'fail', message: e instanceof Error ? e.message : String(e) };
				}
				throw e;
			}

			if (!result.ok) {
				const msg = (result.stepActionResult as TNotOKActionResult).message;
				return { kind: 'fail', message: msg, topics: result.stepActionResult };
			}

			// If not using cycles (which doFeatureStep defaults to WITH_CYCLES), we might need to push results.
			// But doFeatureStep pushes results if WITH_CYCLES.
			// If we are in speculative mode, doFeatureStep might still push results if we don't change execMode.
			// However, FlowRunner doesn't currently control execMode passed to doFeatureStep directly,
			// it relies on FeatureExecutor defaults.
			// If we want to avoid polluting stepResults in speculative mode, we might need to adjust FeatureExecutor or pass a flag.
			// But for now, to ensure incSeqPath works, we NEED results in stepResults.
			// So we accept that speculative steps might be in stepResults (which is probably fine for debugging).

			lastResult = { kind: 'ok', topics: result.stepActionResult };
		}
		return { kind: 'ok', topics: lastResult?.topics };
	}
}
