import { OK, TFinalize, TResolvedFeature, TWorkspace, TWorld } from '../lib/defs';
import { getNamedToVars } from '../lib/namedVars';

export default class Builder {
  world: any;
  workspace: TWorkspace;
  constructor(world: TWorld, workspace: TWorkspace = {}) {
    this.world = world;
    this.workspace = workspace;
  }
  async build(features: TResolvedFeature[]) {
    const finalizers: { [path: string]: TFinalize[] } = {};
    for (const feature of features) {
      for (const vstep of feature.vsteps) {
        for (const action of vstep.actions) {
          if (action.step.build) {
            if (!this.workspace[feature.path]) {
              this.workspace[feature.path] = {};
              finalizers[feature.path] = [];
            }
            const namedWithVars = getNamedToVars(action, this.world);
            const res = await action.step.build(namedWithVars!, vstep, this.workspace[feature.path]);
            if (res.finalize) {
              finalizers[feature.path].push(res.finalize);
            }
          }
        }
      }
    }
    for (const key of Object.keys(finalizers)) {
      for (const finalize of finalizers[key]) {
        finalize(this.workspace[key]);
      }
    }
    return OK;
  }
}
