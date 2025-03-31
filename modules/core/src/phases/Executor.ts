import { TFeatureStep, TResolvedFeature, TExecutorResult, TStepResult, TFeatureResult, TActionResult, TWorld, TStepActionResult, AStepper, TStepAction, TAnyFixme, STAY, STAY_FAILURE, CHECK_NO, CHECK_YES, STEP_DELAY, TNotOKActionResult, } from '../lib/defs.js';
import { TExecutorMessageContext, TMessageContext } from '../lib/interfaces/logger.js';
import { getNamedToVars } from '../lib/namedVars.js';
import { actionNotOK, sleep, findStepper, constructorName, doStepperCycleMethods, } from '../lib/util/index.js';

export const CONTINUE_AFTER_ERROR = 'CONTINUE_AFTER_ERROR';

export class Executor {
	// find the stepper and action, call it and return its result
	static async action(steppers: AStepper[], featureStep: TFeatureStep, found: TStepAction, world: TWorld) {
		const namedWithVars = getNamedToVars(found, world, featureStep);
		const stepper = findStepper<AStepper>(steppers, found.stepperName);
		const action = stepper.steps[found.actionName].action;
		return await action(namedWithVars, featureStep).catch((caught: TAnyFixme) => {
			world.logger.error(caught.stack);
			return actionNotOK(`in ${featureStep.in}: ${caught.message}`, {
				topics: { caught: (caught?.stack || caught).toString() },
			});
		});
	}
	static async executeFeatures(
		steppers: AStepper[],
		world: TWorld,
		features: TResolvedFeature[],
	): Promise<TExecutorResult> {
		let ok = true;
		const stayOnFailure = world.options[STAY] === STAY_FAILURE;
		const featureResults: TFeatureResult[] = [];
		let featureNum = 0;
		const continueAfterError = !!(world.options[CONTINUE_AFTER_ERROR]);

		for (const feature of features) {
			featureNum++;
			const isLast = featureNum === features.length;

			const newWorld = { ...world, tag: { ...world.tag, ...{ featureNum: 0 + featureNum } } };

			const featureExecutor = new FeatureExecutor(steppers);
			await featureExecutor.setup(newWorld);
			await featureExecutor.startFeature();

			const featureResult = await featureExecutor.doFeature(feature);

			ok = ok && featureResult.ok;
			featureResults.push(featureResult);
			const shouldEndFeatureClose = ok || (!stayOnFailure || !isLast || !continueAfterError);
			await featureExecutor.endFeature(); // this must be before endedFeature
			if (shouldEndFeatureClose) {
				await featureExecutor.endedFeature();
			}
			if (!ok && !continueAfterError && !isLast) {
				world.logger.debug(`stopping without ${CONTINUE_AFTER_ERROR}`);
				break;
			} else {
				if (!ok && continueAfterError && !isLast) {
					world.logger.debug(`continuing because ${CONTINUE_AFTER_ERROR}`);
				}
			}
		}
		return { ok, featureResults: featureResults, tag: world.tag, shared: world.shared, steppers };
	}
}

export class FeatureExecutor {
	world?: TWorld;
	startOffset = 0;

	constructor(private steppers: AStepper[]) { }
	async setup(world: TWorld) {
		this.world = world;
		this.startOffset = world.timer.since();
		const errorBail = (phase: string, error: TAnyFixme, extra?: TAnyFixme) => {
			throw Error(error);
		};
	}
	async doFeature(feature: TResolvedFeature): Promise<TFeatureResult> {
		const world = this.world;
		world.logger.log(`███ feature ${world.tag.featureNum}: ${feature.path}`);
		let ok = true;
		const stepResults: TStepResult[] = [];

		for (const step of feature.featureSteps) {
			world.logger.log(step.in);
			const result = await FeatureExecutor.doFeatureStep(this.steppers, step, world);

			if (world.options[STEP_DELAY]) {
				await sleep(world.options[STEP_DELAY] as number);
			}
			ok = ok && result.ok;
			if (!result.ok) {
				await this.onFailure(result, step);
			}
			const indicator = result.ok ? CHECK_YES : CHECK_NO + ' ' + (<TNotOKActionResult>result.actionResult).message;
			world.logger.log(indicator, <TExecutorMessageContext>{ topic: { stage: 'Executor', result, step } });
			stepResults.push(result);
			if (!ok) {
				break;
			}
		}
		const featureResult: TFeatureResult = { path: feature.path, ok, stepResults };

		return featureResult;
	}

	static async doFeatureStep(steppers: AStepper[], featureStep: TFeatureStep, world: TWorld): Promise<TStepResult> {
		let ok = true;

		// FIXME feature should really be attached to the featureStep
		const action = featureStep.action;
		const start = world.timer.since();
		const res: Partial<TActionResult> = await Executor.action(steppers, featureStep, action, world);

		const end = world.timer.since();
		// FIXME
		const actionResult: TStepActionResult = { ...res, name: action.actionName, start, end } as TStepActionResult;
		ok = ok && res.ok;

		return { ok, in: featureStep.in, sourcePath: featureStep.sourceFeature.path, actionResult, seq: featureStep.seq };
	}
	async onFailure(result: TStepResult, step: TFeatureStep) {
		for (const stepper of this.steppers) {
			if (stepper?.cycles?.onFailure) {
				const res = await stepper?.cycles?.onFailure(result, step);
				this.world.logger.error(`onFailure from ${result.in} for ${constructorName(stepper)}`, <TMessageContext>res);
			}
		}
	}

	async startFeature() {
		await doStepperCycleMethods(this.steppers, 'startFeature');
	}
	async endFeature() {
		await doStepperCycleMethods(this.steppers, 'endFeature');
	}
	async endedFeature() {
		await doStepperCycleMethods(this.steppers, 'endedFeature');
	}
}
