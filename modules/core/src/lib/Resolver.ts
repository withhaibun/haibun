import { IStepper, TFeature, TFound, TResolvedFeature, OK, TWorld, TNamed } from './defs';
import { namedInterpolation, getMatch } from './namedVars';
import { getActionable, describeSteppers, isLowerCase } from './util';

export class Resolver {
  steppers: IStepper[];
  world: TWorld;
  mode: string;
  constructor(steppers: IStepper[], mode: string, world: TWorld) {
    this.steppers = steppers;
    this.mode = mode;
    this.world = world;
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
      } else if (actions.length < 1 && this.mode !== 'some') {
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

    for (const { steps } of this.steppers) {
      for (const name in steps) {
        const step = steps[name];
        const addIfMatch = (m: TFound | undefined) => m && found.push(m);
        if (step.gwta) {
          let { str, vars } = namedInterpolation(step.gwta);
          const f = str.charAt(0);
          const s = isLowerCase(f) ? ['[', f, f.toUpperCase(), ']', str.substring(1)].join('') : str;
          const r = new RegExp(`^(Given|When|Then|And)?( the )?( I('m)? (am )?)? ?${s}`);
          addIfMatch(getMatch(actionable, r, name, step, vars));
        } else if (step.match) {
          addIfMatch(getMatch(actionable, step.match, name, step));
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


