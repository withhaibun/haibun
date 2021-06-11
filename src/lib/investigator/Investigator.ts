import { IStepper, TVStep, TResolvedFeature, TResult, TStepResult, TResultError, notOk, TLogger } from '../defs';
import Logger from '../Logger';

export class Investigator {
  steppers: IStepper[];
  options: any;
  logger: any;

  constructor(steppers: IStepper[], options: any, logger: TLogger) {
    this.steppers = steppers;
    this.options = options;
    this.logger = logger;
  }

  async investigate(features: TResolvedFeature[]): Promise<TResult> {
    let ok = true;
    let results: TStepResult[] = [];
    for (const feature of features) {
      for (const step of feature.vsteps) {
        this.logger.log(`   ${step.in}\r`);
        const { result, error } = await Investigator.doStep(step);
        ok = ok && result.ok;
        this.logger.log(ok);
        results.push(result);
        if (error) {
          return { ok, failure: { stage: 'Investigate', error }, results };
        }
      }
    }
    return { ok, results };
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
      } catch (error) {
        res = notOk;
        details = { message: error.message, vstep };
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
