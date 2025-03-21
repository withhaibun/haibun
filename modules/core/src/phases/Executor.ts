import {
	TFeatureStep,
	TResolvedFeature,
	TExecutorResult,
	TStepResult,
	TFeatureResult,
	TActionResult,
	TWorld,
	TStepActionResult,
	AStepper,
	CStepper,
	TStepAction,
	TAnyFixme,
	STAY,
	STAY_FAILURE,
	CHECK_NO,
	CHECK_YES,
	STEP_DELAY,
	TNotOKActionResult,
} from '../lib/defs.js';
import { TExecutorMessageContext, TMessageContext } from '../lib/interfaces/logger.js';
import { getNamedToVars } from '../lib/namedVars.js';
import {
	actionNotOK,
	setStepperWorlds,
	sleep,
	createSteppers,
	findStepper,
	constructorName,
	doStepperCycleMethods,
} from '../lib/util/index.js';
import { TRunnerCallbacks } from '../runner.js';

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
	static async execute(
		csteppers: CStepper[],
		world: TWorld,
		features: TResolvedFeature[],
		callbacks?: TRunnerCallbacks
	): Promise<TExecutorResult> {
		let ok = true;
		const stayOnFailure = world.options[STAY] === STAY_FAILURE;
		const featureResults: TFeatureResult[] = [];
		let featureNum = 0;

		for (const feature of features) {
			featureNum++;

			const newWorld = { ...world, tag: { ...world.tag, ...{ featureNum: 0 + featureNum } } };

			const featureExecutor = new FeatureExecutor(csteppers, callbacks);
			await featureExecutor.setup(newWorld);
			await featureExecutor.startFeature();

			const featureResult = await featureExecutor.doFeature(feature);

			ok = ok && featureResult.ok;
			featureResults.push(featureResult);
			const shouldEndFeatureClose = ok || !stayOnFailure;
			await featureExecutor.endFeature(); // this should be before endedFeature
			if (shouldEndFeatureClose) {
				await featureExecutor.endedFeature();
			}
			await featureExecutor.doEndFeatureCallback(featureResult);
		}
		return { ok, featureResults: featureResults, tag: world.tag, shared: world.shared };
	}
}

export class FeatureExecutor {
	world?: TWorld;
	steppers?: AStepper[];
	startOffset = 0;

	constructor(private csteppers: CStepper[], private callbacks?: TRunnerCallbacks) {}
	async setup(world: TWorld) {
		this.world = world;
		this.startOffset = world.timer.since();
		const errorBail = (phase: string, error: TAnyFixme, extra?: TAnyFixme) => {
			throw Error(error);
		};
		const steppers = await createSteppers(this.csteppers);
		await setStepperWorlds(steppers, world).catch((error: TAnyFixme) => errorBail('Apply Options', error, world.moduleOptions));
		this.steppers = steppers;
	}
	async doFeature(feature: TResolvedFeature): Promise<TFeatureResult> {
		const world = this.world;
		world.logger.log(`███ feature ${world.tag.featureNum}: ${feature.path}`);
		let ok = true;
		const stepResults: TStepResult[] = [];

		for (const step of feature.featureSteps) {
			const ifScenario = step.in.match(/^\bScenario: .*$/);
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

		let traces;
		if (world.shared.get('_trace')) {
			traces = world.shared.get('_trace');
			world.shared.unset('_trace');
		}
		const end = world.timer.since();
		// FIXME
		const stepResult: TStepActionResult = { ...res, name: action.actionName, start, end, traces } as TStepActionResult;
		const actionResult = stepResult;
		ok = ok && res.ok;

		return { ok, in: featureStep.in, sourcePath: featureStep.source.path, actionResult, seq: featureStep.seq };
	}
	async onFailure(result: TStepResult, step: TFeatureStep) {
		for (const stepper of this.steppers) {
			if (stepper.onFailure) {
				const res = await stepper.onFailure(result, step);
				this.world.logger.error(`onFailure from ${result.in} for ${constructorName(stepper)}`, <TMessageContext>res);
			}
		}
	}

	async doEndFeatureCallback(featureResult: TFeatureResult) {
		if (this.callbacks.endFeature) {
			for (const callback of this.callbacks.endFeature) {
				try {
					await callback({ world: this.world, result: featureResult, steppers: this.steppers, startOffset: this.startOffset });
				} catch (error: TAnyFixme) {
					console.error('endFeatureCallback failing', callback.toString());
					throw Error(error);
				}
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
