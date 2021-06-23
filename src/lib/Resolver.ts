import { IStepper, TFeature, TFound, TResolvedFeature, TLogger, TStep, OK } from './defs';
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
  async resolveSteps(features: TFeature[]): Promise<TResolvedFeature[]> {
    const expanded: TResolvedFeature[] = [];
    for (const feature of features) {
      const steps = await this.addSteps(feature);
      expanded.push(steps);
    }
    return expanded;
  }

  async addSteps(feature: TFeature): Promise<TResolvedFeature> {
    const vsteps = feature.feature.split('\n').map((featureLine, seq) => {
      const actionable = getActionable(featureLine);
      const actions = this.findSteps(actionable);
      if (actions.length > 1) {
        throw Error(`more than one step found for ${featureLine} ` + JSON.stringify(actions));
      } else if (actions.length < 1 && this.options.mode !== 'some') {
        throw Error(`no step found for ${featureLine} from ` + describeSteppers(this.steppers));
      }

      return { in: featureLine, seq, actions };
    });

    return { ...feature, vsteps };
  }

  public findSteps(actionable: string): TFound[] {
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
          const r = new RegExp(`^(Given|When|Then|And)?( the )?( I('m)? (am )?)? ?${s}`);
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
      return OK;
    },
  },
};
