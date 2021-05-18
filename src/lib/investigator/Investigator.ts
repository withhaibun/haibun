import { TPaths, IStepper, ok, notOk, TVStep, TResolvedFeature, TResolvedPaths } from '../defs';
import { expandBackgrounds, expandFeatures } from '../features';
import { Resolver } from '../Resolver';

export class Investigator {
  steppers: IStepper[];
  options: any;

  constructor(steppers: IStepper[], options: any) {
    this.steppers = steppers;
    this.options = options;
  }

  async investigate(features: TPaths, backgrounds: TPaths) {
    const expandedBackgrounds = await expandBackgrounds(backgrounds);
    const expandedFeatures = await expandFeatures(features, expandedBackgrounds);
    const validator = new Resolver(this.steppers, this.options);
    const mappedValidatedSteps = await validator.resolveSteps(expandedFeatures);

    try {
      const results = await this.investigateRecursively(mappedValidatedSteps, {});
      return { ...ok, results };
    } catch (error) {
      console.error('failed', error);
      return { ...notOk, error };
    }
  }

  async investigateRecursively(features: TResolvedPaths, results: any) {
    for (const [path, featureOrNode] of Object.entries(features)) {
      if (featureOrNode.vsteps) {
        for (const step of (featureOrNode as TResolvedFeature).vsteps) {
          results[path] = await this.doStep(step).catch((e) => console.error(e));
        }
      } else {
        results[path] = await this.investigateRecursively(featureOrNode as TResolvedPaths, results);
      }
    }
    return results;
  }

  async doStep(vstep: TVStep) {
    for (const action of vstep.actions) {
      const res = await action.step.action(action.named);
      return res;
    }
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
