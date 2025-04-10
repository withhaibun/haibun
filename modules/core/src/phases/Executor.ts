import { TFeatureStep, TResolvedFeature, TExecutorResult, TStepResult, TFeatureResult, TActionResult, TWorld, TStepActionResult, AStepper, TStepAction, TAnyFixme, STAY, STAY_FAILURE, CHECK_NO, CHECK_YES, STEP_DELAY, TNotOKActionResult, CONTINUE_AFTER_ERROR, IStepperCycles, TEndFeature } from '../lib/defs.js';
import { EExecutionMessageType } from '../lib/interfaces/logger.js';
import { topicArtifactLogger } from '../lib/Logger.js';
import { getNamedToVars } from '../lib/namedVars.js';
import { actionNotOK, sleep, findStepper, constructorName, setStepperWorlds } from '../lib/util/index.js';
import { SCENARIO_START } from '../steps/vars.js';

function calculateShouldClose({ thisFeatureOK, isLast, stayOnFailure }) {
	if (thisFeatureOK) {
		return true;
	}
	if (isLast && stayOnFailure) {
		return false;
	}
	return true;
}
export class Executor {
	static async action(steppers: AStepper[], featureStep: TFeatureStep, found: TStepAction, world: TWorld) {
		const namedWithVars = getNamedToVars(found, world, featureStep);
		const stepper = findStepper<AStepper>(steppers, found.stepperName);
		const action = stepper.steps[found.actionName].action;
		return await action(namedWithVars, featureStep).catch((caught: TAnyFixme) => {
			world.logger.error(caught.stack);
			return actionNotOK(`in ${featureStep.in}: ${caught.message}`, {
				incident: EExecutionMessageType.ACTION,
				incidentDetails: { caught: (caught?.stack || caught).toString() },
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
			const thisFeatureOK = featureResult.ok;
			if (!thisFeatureOK) {
				const failedStep = featureResult.stepResults.find((s) => !s.ok);
				await doStepperMethod(steppers, 'onFailure', featureResult, failedStep);
			}
			okSoFar = okSoFar && thisFeatureOK;
			featureResults.push(featureResult);
			const shouldCloseFactors = { thisFeatureOK: featureResult.ok, okSoFar, isLast, continueAfterError, stayOnFailure }
			const shouldClose = calculateShouldClose(shouldCloseFactors);
			if (shouldClose) {
				world.logger.debug(`shouldClose ${JSON.stringify(shouldCloseFactors)}`);
			} else {
				world.logger.debug(`no shouldClose because ${JSON.stringify(shouldCloseFactors)}`);
			}
			await doStepperMethod(steppers, 'endFeature', <TEndFeature>{ world: newWorld, shouldClose, isLast, okSoFar, continueAfterError, stayOnFailure, thisFeatureOK: featureResult.ok });
			if (!okSoFar) {
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
	constructor(private steppers: AStepper[], private world: TWorld, private logit = topicArtifactLogger(world), private startOffset = world.timer.since()) {
	}

	async doFeature(feature: TResolvedFeature): Promise<TFeatureResult> {
		const world = this.world;
		let ok = true;
		const stepResults: TStepResult[] = [];

		let currentScenario: number = 0;

		for (const step of feature.featureSteps) {
			if (step.action.actionName === SCENARIO_START) {
				if (currentScenario) {
					this.logit(`end scenario ${currentScenario}`, { incident: EExecutionMessageType.SCENARIO_END, incidentDetails: { currentScenario } }, 'debug');
				}
				currentScenario = currentScenario + 1;
				this.logit(`start scenario ${currentScenario}`, { incident: EExecutionMessageType.SCENARIO_START, incidentDetails: { currentScenario } }, 'debug');
			}

			world.logger.log(step.in, { incident: EExecutionMessageType.STEP_START, tag: world.tag });
			const result = await FeatureExecutor.doFeatureStep(this.steppers, step, world);

			if (world.options[STEP_DELAY]) {
				await sleep(world.options[STEP_DELAY] as number);
			}
			ok = ok && result.ok;
			const indicator = result.ok ? CHECK_YES : CHECK_NO + ' ' + (<TNotOKActionResult>result.actionResult).message;
			world.logger.log(indicator, { incident: EExecutionMessageType.STEP_END, tag: world.tag, incidentDetails: { result, step } });
			stepResults.push(result);
			if (!ok) {
				break;
			}
		}
		if (currentScenario) {
			this.logit(`end scenario ${currentScenario}`, { incident: EExecutionMessageType.SCENARIO_END, incidentDetails: { currentScenario } }, 'debug');
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
			stepper.getWorld().logger.debug(`🔁 ${method} ${constructorName(stepper)}`);
			await (stepper.cycles[method] as (...args: TAnyFixme[]) => Promise<TAnyFixme>)(...args).catch((error: TAnyFixme) => {
				console.error(`${method} failed`, error);
				throw error;
			});
		}
	}
};
