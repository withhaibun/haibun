import { TWorld, TFeatureStep, TActionResult, TSeqPath, ExecMode, TStepResult, TNotOKActionResult } from '../defs.js';
import { AStepper } from '../astepper.js';
import { interpolate } from '../util/variables.js';
import { Resolver } from '../../phases/Resolver.js';
import { FeatureExecutor, incSeqPath } from '../../phases/Executor.js';
import { ExecutionIntent, FlowSignal, SystemMessage } from './protocol.js';

export class FlowRunner {
  private resolver: Resolver;

  constructor(private world: TWorld, private steppers: AStepper[]) {
    this.resolver = new Resolver(steppers);
  }

  async runStatement(statement: string, options: { args?: Record<string, string>, intent?: ExecutionIntent, parentStep?: TFeatureStep, seqPath?: TSeqPath } = {}): Promise<FlowSignal> {
    const { args = {}, intent = { mode: 'authoritative' } } = options;

    const interpolated = interpolate(statement, args, this.world);

    let action;
    try {
      action = this.resolver.findSingleStepAction(interpolated);
    } catch (e) {
      if (intent.mode === 'speculative') {
        return { kind: 'fail', message: e.message };
      }
      throw e;
    }

    let seqPath = options.seqPath;
    if (!seqPath) {
      if (options.parentStep) {
        seqPath = incSeqPath(this.world.runtime.stepResults, [...options.parentStep.seqPath, 1], 1);
      } else {
        throw new Error(`runStatement requires seqPath or parentStep. Statement: ${statement}`);
      }
    }

    const featureStep: TFeatureStep = {
      path: options.parentStep?.path || this.world.runtime.feature || 'unknown',
      in: interpolated,
      seqPath,
      action,
      intent,
      isSubStep: !!options.parentStep
    };

    const result = await FeatureExecutor.doFeatureStep(this.steppers, featureStep, this.world);

    if (result.ok) {
      return { kind: 'ok', payload: result.stepActionResult };
    } else {
      const msg = (result.stepActionResult as TNotOKActionResult).message;
      return { kind: 'fail', message: msg, payload: result.stepActionResult };
    }
  }

  async runStatements(statements: string[], options: { args?: Record<string, string>, intent?: ExecutionIntent, parentStep?: TFeatureStep } = {}): Promise<FlowSignal> {
    let lastResult: FlowSignal | undefined;
    for (const stmt of statements) {
      const result = await this.runStatement(stmt, options);
      if (result.kind !== 'ok') {
        return result;
      }
      lastResult = result;
    }
    return { kind: 'ok', payload: lastResult?.payload };
  }

  async runSteps(steps: TFeatureStep[], options: { intent?: ExecutionIntent, parentStep?: TFeatureStep } = {}): Promise<FlowSignal> {
    const { intent = { mode: 'authoritative' }, parentStep } = options;

    let lastResult: FlowSignal | undefined;

    for (const step of steps) {
      let mappedStep: TFeatureStep = { ...step, intent };
      if (parentStep) {
        // For nested steps, we append to the parent's seqPath.
        // We use incSeqPath to ensure we get a unique path based on what has already executed.
        // This handles loops and repeated calls correctly.
        const baseSeqPath = [...parentStep.seqPath, 1];
        const dir = intent.mode === 'speculative' ? -1 : 1;
        const seqPath = incSeqPath(this.world.runtime.stepResults, baseSeqPath, dir);
        mappedStep = { ...mappedStep, seqPath, isSubStep: true };
      }

      const result = await FeatureExecutor.doFeatureStep(this.steppers, mappedStep, this.world);

      // If not using cycles (which doFeatureStep defaults to WITH_CYCLES), we might need to push results.
      // But doFeatureStep pushes results if WITH_CYCLES.
      // If we are in speculative mode, doFeatureStep might still push results if we don't change execMode.
      // However, FlowRunner doesn't currently control execMode passed to doFeatureStep directly, 
      // it relies on FeatureExecutor defaults.
      // If we want to avoid polluting stepResults in speculative mode, we might need to adjust FeatureExecutor or pass a flag.
      // But for now, to ensure incSeqPath works, we NEED results in stepResults.
      // So we accept that speculative steps might be in stepResults (which is probably fine for debugging).

      if (!result.ok) {
        const msg = (result.stepActionResult as TNotOKActionResult).message;
        return { kind: 'fail', message: msg, payload: result.stepActionResult };
      }
      lastResult = { kind: 'ok', payload: result.stepActionResult };
    }
    return { kind: 'ok', payload: lastResult?.payload };
  }
}
