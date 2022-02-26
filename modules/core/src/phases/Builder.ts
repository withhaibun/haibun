import { WorkspaceContext } from '../lib/contexts';
import { AStepper, OK, TBuildResult, TFinalize, TNotOkStepActionResult, TOKStepActionResult, TResolvedFeature, TWorld } from '../lib/defs';
import { getNamedToVars } from '../lib/namedVars';
import { applyResShouldContinue } from '../lib/util';
import { FeatureExecutor } from './Executor';

export default class Builder {
  world: any;
  workspace: WorkspaceContext;
  steppers: AStepper[];
  constructor(steppers: AStepper[], world: TWorld, workspace: WorkspaceContext = new WorkspaceContext(`builder`)) {
    this.steppers = steppers;
    this.world = world;
    this.workspace = workspace;
  }
  async build(features: TResolvedFeature[]) {
    const finalizers: { [path: string]: TFinalize[] } = {};
    this.world.shared.values._scored = [];
    for (const feature of features) {
      for (const vstep of feature.vsteps) {
        for (const action of vstep.actions) {
          if (action.step.build) {
            if (!this.workspace.get(feature.path)) {
              this.workspace.createPath(feature.path);
              finalizers[feature.path] = [];
            }
            const res = await FeatureExecutor.action(this.steppers, vstep, vstep.actions[0], this.world);

            const shouldContinue = applyResShouldContinue(this.world, res, action);
            if (!shouldContinue) {
              throw Error(`${action.actionName}: ${(<TNotOkStepActionResult>res).message}`);
            }
            if ((<TOKStepActionResult & TBuildResult>res).finalize) {
              finalizers[feature.path].push((<TOKStepActionResult & TBuildResult>res).finalize!);
            }
          }
        }
      }
    }
    for (const key of Object.keys(finalizers)) {
      for (const finalize of finalizers[key]) {
        finalize(this.workspace.get(key));
      }
    }

    return OK;
  }
}
