import { IStepper, TVStep, TResolvedFeature, TResult, TStepResult, TLogger, TFeatureResult, TActionResult } from './defs';
import { actionNotOK } from './util';
export class Executor {
  steppers: IStepper[];
  options: any;
  logger: TLogger;

  constructor(steppers: IStepper[], options: any, logger: TLogger) {
    this.steppers = steppers;
    this.options = options;
    this.logger = logger;
  }

  async execute(features: TResolvedFeature[]): Promise<TResult> {
    let ok = true;
    let featureResults: TFeatureResult[] = [];
    for (const feature of features) {
      this.logger.log(`feature: ${feature.path}`);
      const featureResult = await this.doFeature(feature);
      ok = ok && featureResult.ok;
      featureResults.push(featureResult);
    }
    return { ok, results: featureResults };
  }

  async doFeature(feature: TResolvedFeature): Promise<TFeatureResult> {
    let ok = true;
    let stepResults: TStepResult[] = [];
    for (const step of feature.vsteps) {
      this.logger.log(`   ${step.in}\r`);
      const result = await Executor.doFeatureStep(step, this.logger);
      ok = ok && result.ok;
      this.logger.log(ok);
      stepResults.push(result);
      if (!ok) {
        break;
      }
    }
    const featureResult: TFeatureResult = { path: feature.path, ok, stepResults };
    return featureResult;
  }
  static async doFeatureStep(vstep: TVStep, logger: TLogger): Promise<TStepResult> {
    let ok = true;
    let actionResults = [];
    for (const a of vstep.actions) {
      let res: TActionResult;
      try {
        res = await a.step.action(a.named, vstep);
      } catch (caught: any) {
        logger.error(caught.stack);
        res = actionNotOK(caught.message, { caught: caught.stack.toString() });
      }
      actionResults.push({ ...res, name: a.name });

      ok = ok && res.ok;
      if (!res.ok) {
        break;
      }
    }
    return { ok, in: vstep.in, actionResults, seq: vstep.seq };
  }

  async close() {
    for (const s of this.steppers) {
      if (s.close) {
        console.info('closing', s.constructor.name);
        await s.close();
      }
    }
  }
}
