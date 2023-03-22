import { WorkspaceContext } from '../lib/contexts.js';
import { AStepper, TBuildResult, TFinalize, TNotOkStepActionResult, TOKStepActionResult, TResolvedFeature, TVStep, TWorld } from '../lib/defs.js';
import { getNamedToVars } from '../lib/namedVars.js';
import { applyResShouldContinue, findStepper } from '../lib/util/index.js';
import { Resolver } from './Resolver.js';

export const BUILT = '_built';
export const EVENT_AFTER = '_after';

export default class Builder {
  world: TWorld;
  workspace: WorkspaceContext;
  steppers: AStepper[];
  finalizers: { [path: string]: TFinalize[] } = {};
  constructor(steppers: AStepper[], world: TWorld, workspace: WorkspaceContext = new WorkspaceContext(`builder`)) {
    this.steppers = steppers;
    this.world = world;
    this.workspace = workspace;
  }
  /*
  async build(features: TResolvedFeature[]) {
    this.world.shared.values._scored = [];
    for (const feature of features) {
      await this.buildSteps(feature);
    }
    for (const key of Object.keys(this.finalizers)) {
      for (const finalize of this.finalizers[key]) {
        finalize(this.workspace.get(key));
      }
    }

    return OK;
  }

  public async buildSteps(feature: TResolvedFeature) {
    for (const vstep of feature.vsteps) {
      await this.buildStep(vstep, feature);
    }
  }
  */

  public async buildStep(feature: TResolvedFeature, resolver: Resolver) {
    const vstep = feature.vsteps[0];
    for (const action of vstep.actions) {
      if (!action.step.build) {
        continue;
      }
      if (!this.workspace.get(feature.path)) {
        this.workspace.createPath(feature.path);
        this.finalizers[feature.path] = [];
      }
      const found = vstep.actions[0];

      const namedWithVars = getNamedToVars(found, this.world, vstep);
      const stepper = findStepper<AStepper>(this.steppers, found.stepperName);

      const res = await stepper.steps[found.actionName].build(namedWithVars, vstep, this.workspace, resolver, this.steppers);
      const shouldContinue = applyResShouldContinue(this.world, res, action);

      if (!shouldContinue || !res.ok) {
        throw Error(`${action.actionName}: ${(<TNotOkStepActionResult>res).message}`);
      }

      if (res.finalize) {
        this.finalizers[feature.path].push((<TOKStepActionResult & TBuildResult>res).finalize);
      }
      if (res.workspace) {
        this.world.shared.values[BUILT] = { ...this.world.shared.values[BUILT], ...this.workspace };
      }
    }
  }
  public async finalize() {
    for (const key of Object.keys(this.finalizers)) {
      for (const finalize of this.finalizers[key]) {
        await finalize(this.workspace.get(key));
      }
    }
  }
}
