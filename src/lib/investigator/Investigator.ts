import { TPaths, IStepper, ok, notOk, TFeature, TVStep, TNamed, TResolvedFeature, TResolvedPaths } from '../defs';
import { expandBackgrounds, expandFeatures } from '../features';
import { Resolver } from '../Resolver';

export class Investigator {
  steppers: IStepper[];
  options: any;

  constructor(steppers: IStepper[], options: any) {
    this.steppers = steppers;
    this.options = options;
  }

  async investigate(features: TPaths, backgrounds: TResolvedPaths) {
    const expandedBackgrounds = await expandBackgrounds(backgrounds);
    const expandedFeatures = await expandFeatures(features, expandedBackgrounds);
    const validator = new Resolver(this.steppers, this.options);
    const mappedValidatedSteps = await validator.resolveSteps(expandedFeatures);

    try {
      return { ok, result: await this.investigateRecursively(mappedValidatedSteps) };
    } catch (error) {
      return { notOk, error };
    }
  }

  async investigateRecursively(features: TPaths) {
    for (const [path, featureOrNode] of Object.entries(features)) {
      if (typeof featureOrNode === 'string') {
        await this.onFeature(path, featureOrNode);
      } else {
        await this.onNode(path, featureOrNode as TPaths);
      }
    }
  }

  async onFeature(path: string, feature: TResolvedFeature) {
    for (const step of feature.vsteps!) {
      await this.doStep(step).catch((e) => console.error(e));
    }
  }
  async onNode(path: string, node: TPaths) {
    await this.investigateRecursively(node);
  }

  async close() {
    for (const s of this.steppers) {
      if (s.close) {
        console.info('closing', s.constructor.name);
        await s.close();
      }
    }
  }

  async doStep(vstep: TVStep) {
    for (const action of vstep.actions) {
      console.log(action.name);
      const res = await action.step.action(action.named);
      console.info(res);
    }
  }
}
