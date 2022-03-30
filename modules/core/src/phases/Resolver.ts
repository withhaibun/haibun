import { TFound, TResolvedFeature, OK, TWorld, BASE_TYPES, TExpandedFeature, AStepper } from '../lib/defs';
import { namedInterpolation, getMatch } from '../lib/namedVars';
import { getActionable, describeSteppers, isLowerCase } from '../lib/util';

export class Resolver {
  steppers: AStepper[];
  world: TWorld;
  mode: string;
  constructor(steppers: AStepper[], mode: string, world: TWorld) {
    this.steppers = steppers;
    this.mode = mode;
    this.world = world;
  }
  async resolveSteps(features: TExpandedFeature[]): Promise<TResolvedFeature[]> {
    const expanded: TResolvedFeature[] = [];
    for (const feature of features) {

      try {
        const steps = await this.addSteps(feature);
        expanded.push(steps);
      } catch (e) {
        
        this.world.logger.error(e);
        throw e;
      }
    }
    return expanded;
  }

  async addSteps(feature: TExpandedFeature): Promise<TResolvedFeature> {
    const vsteps = feature.expanded.map((featureLine, seq) => {
      const actionable = getActionable(featureLine.line);
      const actions = this.findSteps(actionable);

      try {
        // FIXME
        // checkRequiredType(feature, featureLine.line, actions, this.world);
      } catch (e) {
        throw e;
      }

      if (actions.length > 1) {
        throw Error(`more than one step found for "${featureLine.line}" ${JSON.stringify(actions.map(a => a.actionName))}`);
      } else if (actions.length < 1 && this.mode !== 'some') {
        throw Error(`no step found for ${featureLine.line} in ${feature.path} from ${describeSteppers(this.steppers)}`);
      }

      return { source: featureLine.feature, in: featureLine.line, seq, actions };
    });

    return { ...feature, vsteps };
  }
  static getPrelude = (path: string, line: string, featureLine: string) => `In '${path}', step '${featureLine}' using '${line}':`;
  static getTypeValidationError = (prelude: string, fileType: string, name: string, typeValidationError: string) =>
    `${prelude} Type '${fileType}' doesn't validate for '${name}': ${typeValidationError}`;
  static getMoreThanOneInclusionError = (prelude: string, fileType: string, name: string) => `${prelude} more than one '${fileType}' inclusion for '${name}'`;
  static getNoFileTypeInclusionError = (prelude: string, fileType: string, name: string) => `${prelude} no '${fileType}' inclusion for '${name}'`;

  public findSteps(actionable: string): TFound[] {
    if (!actionable.length) {
      return [comment];
    }
    let found: TFound[] = [];

    const types = [...BASE_TYPES, ...this.world.domains.map((d) => d.name)];

    for (const stepper of this.steppers) {
      const stepperName = stepper.constructor.name;
      const { steps } = stepper;
      for (const actionName in steps) {
        const step = steps[actionName];
        const addIfMatch = (m: TFound | undefined) => m && found.push(m);

        if (step.gwta) {
          let { str, vars } = namedInterpolation(step.gwta, types);
          const f = str.charAt(0);
          const s = isLowerCase(f) ? ['[', f, f.toUpperCase(), ']', str.substring(1)].join('') : str;
          const r = new RegExp(`^(Given|When|Then|And)?( the )?( I('m)? (am )?)? ?${s}`);
          addIfMatch(getMatch(actionable, r, actionName, stepperName, step, vars));
        } else if (step.match) {
          addIfMatch(getMatch(actionable, step.match, actionName, stepperName, step));
        } else if (actionable.length > 0 && step.exact === actionable) {
          found.push({ actionName, stepperName, step });
        }
      }
    }
    return found;
  }
}

const comment = {
  stepperName: 'Haibun',
  actionName: 'comment',
  step: {
    match: /.*/,
    action: async () => {
      return OK;
    },
  },
};
