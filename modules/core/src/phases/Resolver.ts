import { IStepper, TFeature, TFound, TResolvedFeature, OK, TWorld, BASE_TYPES, TFileTypeDomain, TModuleDomain } from '../lib/defs';
import { findFeatures } from '../lib/features';
import { namedInterpolation, getMatch, getNamedWithVars } from '../lib/namedVars';
import { getActionable, describeSteppers, isLowerCase } from '../lib/util';

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
      try {
        const steps = await this.addSteps(feature);
        expanded.push(steps);
      } catch (e) {
        throw e;
      }
    }
    return expanded;
  }

  async addSteps(feature: TFeature): Promise<TResolvedFeature> {
    const vsteps = feature.feature.split('\n').map((featureLine, seq) => {
      const actionable = getActionable(featureLine);
      const actions = this.findSteps(actionable);

      try {
        this.checkRequiredType(actions);
      } catch (e) {
        throw e;
      }

      if (actions.length > 1) {
        throw Error(`more than one step found for ${featureLine} ${JSON.stringify(actions)}`);
      } else if (actions.length < 1 && this.mode !== 'some') {
        throw Error(`no step found for ${featureLine} from ${describeSteppers(this.steppers)}`);
      }

      return { in: featureLine, seq, actions };
    });

    return { ...feature, vsteps };
  }

  // if there is a filetype for the domain type, get it from the match and make sure it exists
  checkRequiredType(actions: TFound[]) {
    for (const action of actions) {
      if (action.step.gwta && action.vars) {
        const domainTypes = action.vars.find((v) => !BASE_TYPES.includes(v.type));
        if (domainTypes) {
          const namedWithVars = getNamedWithVars(action, this.world.shared);
          const fd = this.world.domains.find((d) => d.name == domainTypes.type);
          if (fd) {
            const { fileType, backgrounds } = fd as TModuleDomain & TFileTypeDomain;
            if (fileType) {
              const { name } = namedWithVars!;
              const included = findFeatures(name, backgrounds, fileType);
              if (included.length < 1) {
                throw Error(`no ${fileType} inclusion for ${name}`);
              } else if (included.length > 1) {
                throw Error(`more than one ${fileType} inclusion for ${name}`);
              }
            }
          } else {
            throw Error(`no domain definition for ${domainTypes}`);
          }
        }
      }
    }
  }

  public findSteps(actionable: string): TFound[] {
    if (!actionable.length) {
      return [comment];
    }
    let found: TFound[] = [];

    const types = [...BASE_TYPES, ...this.world.domains.map((d) => d.name)];

    for (const { steps } of this.steppers) {
      for (const name in steps) {
        const step = steps[name];
        const addIfMatch = (m: TFound | undefined) => m && found.push(m);
        if (step.gwta) {
          let { str, vars } = namedInterpolation(step.gwta, types);
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
