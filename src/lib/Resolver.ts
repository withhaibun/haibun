import { IStepper,  TFeature, TFound, ok, TResolvedFeature, TLogger } from './defs';
import { getActionable, getNamedMatches, describeSteppers } from './util';

export class Resolver {
  steppers: IStepper[];
  options: any;
  logger: any;
  constructor(steppers: IStepper[], options: any, logger: TLogger) {
    this.steppers = steppers;
    this.options = options;
    this.logger = logger;
  }
  async resolveSteps(paths: TFeature[]): Promise<TResolvedFeature[]> {
    const expanded: TResolvedFeature[] = [];

    const features = [];

    const addSteps = async (feature: TFeature): Promise<TResolvedFeature> => {
      const vsteps = feature.feature.split('\n').map((featureLine, seq) => {
        const actions = this.findSteps(featureLine);
        this.logger.debug('ixmany', featureLine, actions);
        if (actions.length > 1) {
          throw Error(`more than one step found for ${featureLine} ` + actions.map(a => a.name));
        } else if (actions.length < 1 && this.options.mode !== 'some') {
          throw Error(`no step found for ${featureLine} from ` + describeSteppers(this.steppers));
        }

        return { in: featureLine, seq, actions };
      });

      return { ...feature, vsteps };
    };
    for (const [path, featureOrNode] of Object.entries(paths)) {
        features.push({ path, feature: featureOrNode });

      for (const { path, feature } of features) {
        const steps = await addSteps(feature as TFeature);
        expanded.push(steps);
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
