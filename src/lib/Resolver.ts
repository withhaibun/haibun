import { IStepper, TPaths, TFeature, TFound, ok, TResolvedPaths, TResolvedFeature } from './defs';
import { getNamedMatches } from './util';

export class Resolver {
  steppers: IStepper[];
  options: any;
  constructor(steppers: IStepper[], options: any) {
    this.steppers = steppers;
    this.options = options;
  }
  async resolveSteps(paths: TPaths): Promise<TResolvedPaths> {
    const expanded: TResolvedPaths = {};

    const features = [];
    const nodes = [];

    const addSteps = async (feature: TFeature): Promise<TResolvedFeature> => {
      const vsteps = feature.feature.split('\n').map((featureLine, seq) => {
        const actions = findSteps(featureLine, this.steppers);
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
        expanded[path] = await addSteps(feature as TFeature);
      }
      for (const { path, node } of nodes) {
        expanded[path] = await this.resolveSteps(node as TPaths);
      }
    }
    return expanded;
  }
}

const comment = {
  name: 'comment',
  step: {
    match: /.*/,
    action: async () => {
      console.log('comment');
      return ok;
    },
  },
};

export function findSteps(featureLine: string, steppers: IStepper[]): TFound[] {
  const actual = getActionable(featureLine);
  if (!actual.length) {
    return [comment];
  }
  let found: TFound[] = [];
  steppers.forEach(({ steps }) => {
    Object.keys(steps).map((name) => {
      const step = steps[name];
      if (step.match === featureLine) {
        found.push({ name, step });
      } else if (step.match instanceof RegExp) {
        const named = getNamedMatches(featureLine, step);
        if (named && Object.keys(named).length > 0) {
          found.push({ name, step, named });
        }
      }
    });
  }, []);
  return found;
}

function getActionable(value: string) {
  return value.replace(/#.*/, '').trim();
}
