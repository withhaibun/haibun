import { TVStep, TResolvedFeature, TResult, TStepResult, TFeatureResult, TActionResult, TWorld, TActionResultTopics, TStepActionResult, AStepper, TTag } from '../lib/defs';
import { getNamedToVars } from '../lib/namedVars';
import { actionNotOK, applyResShouldContinue, getRunTag, sleep } from '../lib/util';

export class FeaturesExecutor {
  steppers: AStepper[];
  world: TWorld;

  constructor(steppers: AStepper[], world: TWorld) {
    this.steppers = steppers;
    this.world = world;
  }

  async execute(features: TResolvedFeature[]): Promise<TResult> {
    let ok = true;
    const stay = (this.world.options.STAY === 'always');
    let featureResults: TFeatureResult[] = [];
    // FIXME
    this.world.shared.values._features = features;
    this.world.shared.values._scored = [];
    let featureNum = 1;
    for (const feature of features) {
      const newWorld = { ...this.world, tag: { ...this.world.tag, ...{ featureNum } } }
      const featureExecutor = new FeatureExecutor(this.steppers, newWorld);
      const featureResult = await featureExecutor.doFeature(feature);
      ok = ok && featureResult.ok;

      if (!stay) {
        await featureExecutor.endFeature();
      }
      featureResults.push(featureResult);
      featureNum++;
      if (!stay) {
        await featureExecutor.close();
      }
    }
    return { ok, results: featureResults, tag: this.world.tag };
  }
}

export class FeatureExecutor {
  steppers: AStepper[];
  world: TWorld;

  constructor(steppers: AStepper[], world: TWorld) {
    this.steppers = steppers;
    this.world = world;
  }
  async doFeature(feature: TResolvedFeature): Promise<TFeatureResult> {
      this.world.logger.log(`*** feature ${this.world.tag.featureNum}: ${feature.path}`);
    let ok = true;
    let stepResults: TStepResult[] = [];
    let seq = 0;

    for (const step of feature.vsteps) {
      this.world.logger.log(`   ${step.in}\r`);
      const result = await FeatureExecutor.doFeatureStep(step, this.world);

      if (this.world.options.step_delay) {
        await sleep(this.world.options.step_delay as number);
      }
      ok = ok && result.ok;
      if (!result.ok) {
        await this.onFailure(result);
      }
      const topics: TActionResultTopics = result.actionResults.reduce<TActionResultTopics>((all, a) => ({ ...all, ...a.topics }), {});
      this.world.logger.log(ok, { topic: { stage: 'Executor', seq, result } });
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
      const start = world.timer.since();
      let res: Partial<TActionResult>;
      try {
        const namedWithVars = getNamedToVars(a, world);
        res = await a.step.action(namedWithVars, vstep);
      } catch (caught: any) {
        world.logger.error(caught.stack);
        res = actionNotOK(`in ${vstep.in}: ${caught.message}`, { topics: { caught: caught.stack.toString() } });
      }
      let traces;
      if (world.shared.get('_trace')) {
        traces = world.shared.get('_trace');
        world.shared.unset('_trace');
      }
      const end = world.timer.since();
      // FIXME
      const stepResult: TStepActionResult = { ...res, name: a.name, start, end, traces } as TStepActionResult;
      actionResults.push(stepResult);
      const shouldContinue = applyResShouldContinue(world, res, a);
      ok = ok && shouldContinue;
      if (!shouldContinue) {
        break;
      }
    }
    return { ok, in: vstep.in, actionResults, seq: vstep.seq };
  }

  async onFailure(result: TStepResult) {
    for (const s of this.steppers) {
      if (s.onFailure) {
        this.world.logger.debug(`onFailure ${s.constructor.name}`);
        await s.onFailure(result);
      }
    }
  }

  async endFeature() {
    for (const s of this.steppers) {
      if (s.endFeature) {
        this.world.logger.debug(`endFeature ${s.constructor.name}`);
        await s.endFeature();
      }
    }
  }
  async close() {
    for (const s of this.steppers) {
      if (s.close) {
        this.world.logger.debug(`closing ${s.constructor.name}`);
        await s.close();
      }
    }
  }
}
