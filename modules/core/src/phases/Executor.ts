import { TVStep, TResolvedFeature, TResult, TStepResult, TFeatureResult, TActionResult, TWorld, TStepActionResult, AStepper, TEndFeatureCallback, CStepper, TFound } from '../lib/defs.js';
import { getNamedToVars } from '../lib/namedVars.js';
import { actionNotOK, applyResShouldContinue, setWorldStepperOptions, sleep, createSteppers, findStepper } from '../lib/util/index.js';

export class Executor {
  // find the stepper and action, call it and return its result
  static async action(steppers: AStepper[], vstep: TVStep, a: TFound, world: TWorld): Promise<Partial<TActionResult>> {
    try {
      const namedWithVars = getNamedToVars(a, world, vstep);
      const stepper = findStepper<AStepper>(steppers, a.stepperName);
      return await stepper.steps[a.actionName].action(namedWithVars, vstep);
    } catch (caught: any) {
      world.logger.error(caught.stack);
      return actionNotOK(`in ${vstep.in}: ${caught.message}`, { topics: { caught: caught.stack.toString() } });
    }
  }
  static async execute(csteppers: CStepper[], world: TWorld, features: TResolvedFeature[], endFeatureCallback?: TEndFeatureCallback): Promise<TResult> {
    let ok = true;
    const stay = (world.options.stay === 'always');
    let featureResults: TFeatureResult[] = [];
    // FIXME scoring hack
    // world.shared.values._features = features;
    world.shared.values._scored = [];
    let featureNum = 0;


    for (const feature of features) {
      featureNum++;

      const newWorld = { ...world, tag: { ...world.tag, ...{ featureNum: 0 + featureNum } } }

      const featureExecutor = new FeatureExecutor(csteppers, endFeatureCallback);
      await featureExecutor.setup(newWorld);

      const featureResult = await featureExecutor.doFeature(feature);
      ok = ok && featureResult.ok;

      if (!stay) {
        await featureExecutor.endFeature(featureResult);
      }
      featureResults.push(featureResult);
      if (!stay) {
        await featureExecutor.close();
      }
    }
    return { ok, results: featureResults, tag: world.tag, shared: world.shared };
  }
}

export class FeatureExecutor {
  csteppers: CStepper[];
  endFeatureCallback?: TEndFeatureCallback;
  world?: TWorld;
  steppers?: AStepper[];
  startOffset: number = 0;

  constructor(csteppers: CStepper[], endFeatureCallback?: TEndFeatureCallback) {
    this.csteppers = csteppers;
    this.endFeatureCallback = endFeatureCallback;
  }
  async setup(world: TWorld) {
    this.world = world;
    this.startOffset = world.timer.since();
    const errorBail = (phase: string, error: any, extra?: any) => {
      console.error('error', phase, error, extra);
      throw Error(error);
    }
    const steppers = await createSteppers(this.csteppers);
    await setWorldStepperOptions(steppers, world).catch((error: any) => errorBail('Apply Options', error, world.extraOptions));
    this.steppers = steppers;
  }
  async doFeature(feature: TResolvedFeature): Promise<TFeatureResult> {
    const world = this.world!;
    world.logger.log(`*** feature ${world.tag.featureNum}: ${feature.path}`);
    let ok = true;
    let stepResults: TStepResult[] = [];
    let seq = 0;

    for (const step of feature.vsteps) {
      world.logger.log(`   ${step.in}\r`);
      const result = await FeatureExecutor.doFeatureStep(this.steppers!, step, world);

      if (world.options.step_delay) {
        await sleep(world.options.step_delay as number);
      }
      ok = ok && result.ok;
      if (!result.ok) {
        await this.onFailure(result);
      }
      world.logger.log(ok, { topic: { stage: 'Executor', seq, result } });
      stepResults.push(result);
      if (!ok) {
        break;
      }
      seq++;
    }
    const featureResult: TFeatureResult = { path: feature.path, ok, stepResults };

    return featureResult;
  }

  static async doFeatureStep(steppers: AStepper[], vstep: TVStep, world: TWorld): Promise<TStepResult> {
    let ok = true;
    let actionResults = [];

    // FIXME feature should really be attached ot the vstep
    for (const a of vstep.actions) {
      const start = world.timer.since();
      const res: Partial<TActionResult> = await Executor.action(steppers, vstep, a, world);

      let traces;
      if (world.shared.get('_trace')) {
        traces = world.shared.get('_trace');
        world.shared.unset('_trace');
      }
      const end = world.timer.since();
      // FIXME
      const stepResult: TStepActionResult = { ...res, name: a.actionName, start, end, traces } as TStepActionResult;
      actionResults.push(stepResult);
      const shouldContinue = applyResShouldContinue(world, res, a);
      ok = ok && shouldContinue;
      if (!shouldContinue) {
        break;
      }
    }
    return { ok, in: vstep.in, sourcePath: vstep.source.path, actionResults, seq: vstep.seq };
  }
  async onFailure(result: TStepResult) {
    for (const s of this.steppers!) {
      if (s.onFailure) {
        this.world!.logger.debug(`onFailure ${s.constructor.name}`);
        await s.onFailure(result);
      }
    }
  }

  async endFeature(featureResult: TFeatureResult) {
    for (const s of this.steppers!) {
      if (s.endFeature) {
        this.world!.logger.debug(`endFeature ${s.constructor.name}`);
        await s.endFeature();
      }
    }

    if (this.endFeatureCallback) {
      try {
        await this.endFeatureCallback({ world: this.world!, result: featureResult, steppers: this.steppers!, startOffset: this.startOffset })
      } catch (error: any) {
        throw Error(error);
      }
    }
  }
  async close() {
    for (const s of this.steppers!) {
      if (s.close) {
        this.world!.logger.debug(`closing ${s.constructor.name}`);
        await s.close();
      }
    }
  }
}
