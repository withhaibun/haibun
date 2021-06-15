import { IStepper, TFeature, TFound, ok, TResolvedFeature, TLogger, TStep } from './defs';
import { getActionable, getNamedMatches, describeSteppers, isLowerCase } from './util';

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
          throw Error(`more than one step found for ${featureLine} ` + JSON.stringify(actions));
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

    const doMatch = (r: RegExp, name: string, step: TStep) => {
      if (r.test(actionable)) {
        const named = getNamedMatches(r, actionable);
        found.push({ name, step, named });
      }
    };
    for (const { steps } of this.steppers) {
      for (const name in steps) {
        const step = steps[name];

        if (step.gwta) {
          const f = step.gwta.charAt(0);
          const s = isLowerCase(f) ? ['[', f, f.toUpperCase(), ']', step.gwta.substring(1)].join('') : step.gwta;
          const r = new RegExp(`^(Given|When|Then|And)?( the )?( I('m)? (am )?)?${s}`);
          doMatch(r, name, step);
        } else if (step.match) {
          doMatch(step.match, name, step);
        } else if (actionable.length > 0 && step.exact === actionable) {
          found.push({ name, step });
        }
      }
    }
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
