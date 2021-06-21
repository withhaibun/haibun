import { IStepper, TVStep, TResolvedFeature, TResult, TStepResult, TResultError, notOk, TLogger, TFeatureResult } from '../defs';

type TErrorWithMessage = {
  message: string;
};

export class Investigator {
  steppers: IStepper[];
  options: any;
  logger: TLogger;

  constructor(steppers: IStepper[], options: any, logger: TLogger) {
    this.steppers = steppers;
    this.options = options;
    this.logger = logger;
  }

  async investigate(features: TResolvedFeature[]): Promise<TResult> {
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
    let extra = undefined;
    for (const step of feature.vsteps) {
      this.logger.log(`   ${step.in}\r`);
      const { result, error } = await Investigator.doStep(step);
      ok = ok && result.ok;
      this.logger.log(ok);
      stepResults.push(result);
      if (error) {
        extra = error;
        break;
      }
    }
    const featureResult: TFeatureResult = { path: feature.path, ok, stepResults };
    if (extra) {
      featureResult.failure = { error: extra };
    }
    return featureResult;
  }
  static async doStep(vstep: TVStep): Promise<{ result: TStepResult; error: TResultError | undefined }> {
    let ok = true;
    let actionResults = [];
    let error;
    let details;
    for (const a of vstep.actions) {
      let res;
      try {
        res = await a.step.action(a.named);
      } catch (caught: any) {
        console.error(caught);
        res = notOk;
        details = { message: caught.message, vstep };
        error = caught;
        break;
      }
      actionResults.push({ ...res, name: a.name });

      ok = ok && res.ok;
      if (!res.ok) {
        error = { context: a, details };
        break;
      }
    }
    return { result: { ok, in: vstep.in, actionResults, seq: vstep.seq }, error };
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
