import { IStepper, TVStep, TResolvedFeature, TResult, TStepResult, TFeatureResult, TActionResult, TWorld } from '../lib/defs';
import { getNamedToVars } from '../lib/namedVars';
import { actionNotOK, sleep } from '../lib/util';

export class Executor {
  steppers: IStepper[];
  world: TWorld;

  constructor(steppers: IStepper[], world: TWorld) {
    this.steppers = steppers;
    this.world = world;
  }

  async execute(features: TResolvedFeature[]): Promise<TResult> {
    let ok = true;
    let featureResults: TFeatureResult[] = [];
    // FIXME
    this.world.shared.values._features = features;
    for (const feature of features) {
      this.world.logger.log(`feature: ${feature.path}`);
      const featureResult = await this.doFeature(feature);
      ok = ok && featureResult.ok;
      featureResults.push(featureResult);
    }
    return { ok, results: featureResults };
  }

  async doFeature(feature: TResolvedFeature): Promise<TFeatureResult> {
    let ok = true;
    let stepResults: TStepResult[] = [];
    let seq = 0;
    for (const step of feature.vsteps) {
      this.world.logger.log(`   ${step.in}\r`);
      const result = await Executor.doFeatureStep(step, this.world);

      if (this.world.options.step_delay) {
        await sleep(this.world.options.step_delay as number);
      }
      ok = ok && result.ok;

      this.world.logger.log(ok, { stage: 'Executor', seq, topics: { result } });
      stepResults.push(result);
      if (!ok) {
        break;
      }
      seq++;
    }
    const featureResult: TFeatureResult = { path: feature.path, ok, stepResults };
    return featureResult;
  }
  static async doFeatureStep(vstep: TVStep, world: TWorld): Promise<TStepResult> {
    let ok = true;
    let actionResults = [];

    // FIXME feature should really be attached ot the vstep
    for (const a of vstep.actions) {
      let res: TActionResult;
      try {
        const namedWithVars = getNamedToVars(a, world);
        res = await a.step.action(namedWithVars, vstep);
      } catch (caught: any) {
        
        world.logger.error(caught.stack);
        res = actionNotOK(`in ${vstep.in}: ${caught.message}`, { caught: caught.stack.toString() });
      }
      actionResults.push({ ...res, name: a.name });

      ok = ok && res.ok;
      if (!res.ok) {
        break;
      }
    }
    return { ok, in: vstep.in, actionResults, seq: vstep.seq };
  }

  async close() {
    for (const s of this.steppers) {
      if (s.close) {
        this.world.logger.info(`closing ${s.constructor.name}`);
        await s.close();
      }
    }
  }
}
