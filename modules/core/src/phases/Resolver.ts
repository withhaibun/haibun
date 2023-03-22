import { TFound, TResolvedFeature, OK, TWorld, BASE_TYPES, TExpandedFeature, AStepper, TStep, TVStep, TFeature } from '../lib/defs.js';
import { namedInterpolation, getMatch } from '../lib/namedVars.js';
import { asExpandedFeatures } from '../lib/test/lib.js';
import { getActionable, describeSteppers, isLowerCase, dePolite } from '../lib/util/index.js';
import Builder, { BUILT, EVENT_AFTER } from './Builder.js';

export class Resolver {
  steppers: AStepper[];
  world: TWorld;
  mode: string;
  types: string[];
  builder: Builder;
  constructor(steppers: AStepper[], world: TWorld, builder?: Builder) {
    this.steppers = steppers;
    this.world = world;
    this.builder = builder;
    this.types = [...BASE_TYPES, ...this.world.domains.map((d) => d.name)];
  }
  async resolveStepsFromFeatures(features: TExpandedFeature[]): Promise<TResolvedFeature[]> {
    const expanded: TResolvedFeature[] = [];
    for (const feature of features) {
      try {
        const vsteps = await this.findVSteps(feature);
        const e = { ...feature, ...{ vsteps } }
        await this.builder?.buildStep(e, this);
        this.world.shared.values[BUILT] && await this.applyActionEvents(this.world.shared.values[BUILT].values, EVENT_AFTER, e);
        expanded.push(e);
      } catch (e) {
        this.world.logger.error(e);
        throw e;
      }
    }
    return expanded;
  }

  private async applyActionEvents(values, event: string, expanded: TResolvedFeature) {
    for (const [k, a] of Object.entries(values)) {
      const { action: actionable, vstep: sourceVStep } = <{ action: string, vstep: TVStep }>a;
      const [e, domain] = k.split(':');
      if (e !== event) {
        continue;
      }

      const expandedFeature = asExpandedFeatures([{ path: sourceVStep.source.path, content: actionable }]);
      const vstep = this.findVSteps(expandedFeature[0]);
      const found = this.findActionableSteps(actionable)[0];
      const { source } = sourceVStep;

      const { actionName, stepperName, step } = found;
      const { named, vars } = sourceVStep.actions[0];
      const action: TFound = { actionName, stepperName, step, named, vars };
      const nv = { ...vstep, source, in: actionable, seq: expanded.vsteps.length + 1, ...{ actions: [action] } };

      expanded.vsteps.push(nv);
    }
  }

  private async findVSteps(feature: TExpandedFeature): Promise<TVStep[]> {
    // const vsteps = await feature.expanded.map(async (featureLine, seq) => {
    const vsteps: TVStep[] = [];
    let seq = 0;
    for (const featureLine of feature.expanded) {
      seq++;

      const actionable = getActionable(featureLine.line);

      const actions = this.findActionableSteps(actionable);

      /*
      try {
        // FIXME
        checkRequiredType(feature, featureLine.line, actions, this.world);
      } catch (e) {
        throw e;
      }
      */

      if (actions.length > 1) {
        throw Error(`more than one step found for "${featureLine.line}": ${JSON.stringify(actions.map((a) => a.actionName))}`);
      } else if (actions.length < 1) {
        throw Error(`no step found for ${featureLine.line} in ${feature.path} from ${describeSteppers(this.steppers)}`);
      }
      const wtw = { source: featureLine.feature, in: featureLine.line, seq, actions }
      vsteps.push(wtw);
    }

    return vsteps;
  }
  public findActionableSteps(actionable: string): TFound[] {
    if (!actionable.length) {
      return [comment];
    }
    const found: TFound[] = [];

    for (const stepper of this.steppers) {
      const stepperName = stepper.constructor.name;
      const { steps } = stepper;
      for (const actionName in steps) {
        const step = steps[actionName];
        const stepFound = this.choose(step, actionable, actionName, stepperName);

        if (stepFound) {
          found.push(stepFound);
        }
      }
    }
    return found;
  }

  private choose(step: TStep, actionable: string, actionName: string, stepperName: string) {
    const curt = dePolite(actionable);
    if (step.gwta) {
      const { str, vars } = namedInterpolation(step.gwta, this.types);
      const f = str.charAt(0);
      const s = isLowerCase(f) ? ['[', f, f.toUpperCase(), ']', str.substring(1)].join('') : str;
      const r = new RegExp(`^${s}`);
      //const r = new RegExp(`^(Given|When|Then|And)?( the )?( I('m)? (am )?)? ?${s}`);
      return getMatch(curt, r, actionName, stepperName, step, vars);
    } else if (step.match) {
      return getMatch(actionable, step.match, actionName, stepperName, step);
    } else if (step.exact === curt) {
      return { actionName, stepperName, step };
    }
  }
  static getPrelude = (path: string, line: string, featureLine: string) => `In '${path}', step '${featureLine}' using '${line}':`;
  static getTypeValidationError = (prelude: string, fileType: string, name: string, typeValidationError: string) =>
    `${prelude} Type '${fileType}' doesn't validate for '${name}': ${typeValidationError}`;
  static getMoreThanOneInclusionError = (prelude: string, fileType: string, name: string) => `${prelude} more than one '${fileType}' inclusion for '${name}'`;
  static getNoFileTypeInclusionError = (prelude: string, fileType: string, name: string) => `${prelude} no '${fileType}' inclusion for '${name}'`;

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
