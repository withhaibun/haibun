import { TFeatureStep, TResolvedFeature, TExecutorResult, TStepResult, TFeatureResult, TActionResult, TWorld, TStepActionResult, AStepper, TStepAction, TAnyFixme, STAY, STAY_FAILURE, CHECK_NO, CHECK_YES, STEP_DELAY, TNotOKActionResult, CONTINUE_AFTER_ERROR, IStepperCycles } from '../lib/defs.js';
import { TExecutorMessageContext } from '../lib/interfaces/logger.js';
import { getNamedToVars } from '../lib/namedVars.js';
import { actionNotOK, sleep, findStepper, constructorName, setStepperWorlds } from '../lib/util/index.js';

function calculateShouldClose(isLast: boolean, okSoFar: boolean, thisFeatureOK: boolean, continueAfterError: boolean, stayOnFailure: boolean) {
	return (!thisFeatureOK && isLast && stayOnFailure);
}
export class Executor {
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
	static async executeFeatures(steppers: AStepper[], world: TWorld, features: TResolvedFeature[]): Promise<TExecutorResult> {
		await doStepperMethod(steppers, 'startExecution');
		let okSoFar = true;
		const stayOnFailure = world.options[STAY] === STAY_FAILURE;
		const featureResults: TFeatureResult[] = [];
		let featureNum = 0;
		const continueAfterError = !!(world.options[CONTINUE_AFTER_ERROR]);

		for (const feature of features) {
			featureNum++;
			const isLast = featureNum === features.length;

			world.logger.log(`███ feature ${featureNum}/${features.length}: ${feature.path}`);
			const newWorld = { ...world, tag: { ...world.tag, ...{ featureNum: 0 + featureNum } } };

			const featureExecutor = new FeatureExecutor(steppers, newWorld);
			await setStepperWorlds(steppers, newWorld);
			await doStepperMethod(steppers, 'startFeature');

			const featureResult = await featureExecutor.doFeature(feature);

			okSoFar = okSoFar && featureResult.ok;
			featureResults.push(featureResult);
			const shouldClose = calculateShouldClose(isLast, okSoFar, featureResult.ok, continueAfterError, stayOnFailure);
			const shouldCloseFactors = { thisFeatureOK: featureResult.ok, okSoFar, isLast, continueAfterError, stayOnFailure }
			if (shouldClose) {
				world.logger.debug(`shouldClose ${JSON.stringify(shouldCloseFactors)}`);
			} else {
				world.logger.debug(`no shouldClose because ${JSON.stringify(shouldCloseFactors)}`);
			}
			await doStepperMethod(steppers, 'endFeature', { shouldClose, isLast, okSoFar, continueAfterError, stayOnFailure, thisFeatureOK: featureResult.ok });
			if (!okSoFar) {
				const failedStep = featureResult.stepResults.find((s) => !s.ok);
				await doStepperMethod(steppers, 'onFailure', featureResult, failedStep);
				if (!continueAfterError && !isLast) {
					world.logger.debug(`stopping without ${CONTINUE_AFTER_ERROR}`);
					break;
				} else {
					if (continueAfterError && !isLast) {
						world.logger.debug(`continuing because ${CONTINUE_AFTER_ERROR}`);
					}
				}
			}
		}
		await doStepperMethod(steppers, 'endExecution');
		return { ok: okSoFar, featureResults: featureResults, tag: world.tag, shared: world.shared, steppers };
	}
}

export class FeatureExecutor {
	startOffset = 0;

	constructor(private steppers: AStepper[], private world: TWorld) {
		this.startOffset = world.timer.since();
	}
	async doFeature(feature: TResolvedFeature): Promise<TFeatureResult> {
		const world = this.world;
		let ok = true;
		const stepResults: TStepResult[] = [];

		for (const step of feature.featureSteps) {
			world.logger.log(step.in);
			const result = await FeatureExecutor.doFeatureStep(this.steppers, step, world);

			if (world.options[STEP_DELAY]) {
				await sleep(world.options[STEP_DELAY] as number);
			}
			ok = ok && result.ok;
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

		return { ok, in: featureStep.in, path: featureStep.path, actionResult, seq: featureStep.seq };
	}
}

const doStepperMethod = async <K extends keyof IStepperCycles>(steppers: AStepper[], method: K, ...args: TAnyFixme[]) => {
	for (const stepper of steppers) {
		if (stepper?.cycles && stepper.cycles[method]) {
			stepper.getWorld().logger.log(`🔁 ${method} ${constructorName(stepper)}`);
			await (stepper.cycles[method] as (...args: TAnyFixme[]) => Promise<TAnyFixme>)(...args).catch((error: TAnyFixme) => {
				console.error(`${method} failed`, error);
				throw error;
			});
		}
	}
};
