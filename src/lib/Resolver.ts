import { IStepper, TPaths, TFeature, TFound, ok, TResolvedFeature } from './defs';
import { getActionable, getNamedMatches } from './util';

export class Resolver {
  steppers: IStepper[];
  options: any;
  constructor(steppers: IStepper[], options: any) {
    this.steppers = steppers;
    this.options = options;
  }
  async resolveSteps(paths: TPaths): Promise<TResolvedFeature[]> {
    const expanded: TResolvedFeature[] = [];

    const features = [];
    const nodes = [];

    const addSteps = async (feature: TFeature): Promise<TResolvedFeature> => {
      const vsteps = feature.feature.split('\n').map((featureLine, seq) => {
        const actions = this.findSteps(featureLine);
        if (actions.length > 1) {
          throw Error(`more than one step found for ${featureLine}`);
        } else if (actions.length < 1 && this.options.mode !== 'some') {
          throw Error(`no step found for ${featureLine}`);
        }

        return { in: featureLine, seq, actions };
      });

      return { ...feature, vsteps };
    };
    for (const [path, featureOrNode] of Object.entries(paths)) {
      if (featureOrNode.feature) {
        features.push({ path, feature: featureOrNode });
      } else {
        nodes.push({ path, node: featureOrNode });
      }

      for (const { path, feature } of features) {
        const steps = await addSteps(feature as TFeature);
        expanded.push(steps);
      }
      for (const { path, node } of nodes) {
        await this.resolveSteps(node as TPaths);
      }
    }
    return expanded;
  }

  public findSteps(featureLine: string): TFound[] {
    const actionable = getActionable(featureLine);
    if (!actionable.length) {
      return [comment];
    }
    let found: TFound[] = [];
    this.steppers.forEach(({ steps }) => {
      
      Object.keys(steps).map((name) => {
        const step = steps[name];

        if (step.exact === actionable) {
          found.push({ name, step });
        } else if (step.match instanceof RegExp) {
          const r = new RegExp(step.match);
          if (r.test(actionable)) {
            const named = getNamedMatches(actionable, step);
            found.push({ name, step, named });
          }
        }
      });
    }, []);
    return found;
  }
}

const comment = {
  name: 'comment',
  step: {
    match: /.*/,
    action: async () => {
      return ok;
    },
  },
};
