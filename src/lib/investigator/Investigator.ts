import { IStepper, ok, TVStep, TResolvedFeature, TResolvedPaths, TResult, TStepResult } from '../defs';

export class Investigator {
  steppers: IStepper[];
  options: any;

  constructor(steppers: IStepper[], options: any) {
    this.steppers = steppers;
    this.options = options;
  }

  async investigate(mappedValidatedSteps: TResolvedPaths): Promise<TResult> {
    const results = await this.investigateRecursively(mappedValidatedSteps, {}, true);
    console.log('RESULTS', results);
    
    return { ...ok, results };
  }

  async investigateRecursively(features: TResolvedPaths, results: any, allOk: boolean) {
    for (const [path, featureOrNode] of Object.entries(features)) {
      if (featureOrNode.vsteps) {
        for (const step of (featureOrNode as TResolvedFeature).vsteps) {
          const res = await this.doStep(step);
          allOk = allOk && res.ok;
          if (!res.ok) {
            allOk = false;
          }
          results[path] = res;
        }
      } else {
        results[path] = await this.investigateRecursively(featureOrNode as TResolvedPaths, featureOrNode, allOk);
      }
    }
    return results;
  }

  async doStep(vstep: TVStep): Promise<TStepResult> {
    let ok = true;
    let stepResults = [];
    for (const a of vstep.actions) {
      const res = await a.step.action(a.named || {});
      console.log(a.name, a.step.match, a.named, 'res:', res);
      stepResults.push(res);
      ok = ok && res.ok;
      if (!res.ok) {
        break;
      }
    }
    return { ok, stepResults};
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
