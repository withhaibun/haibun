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
	TEndFeatureCallback,
	CStepper,
	TStepAction,
	TAnyFixme,
	STAY,
	STAY_FAILURE,
} from '../lib/defs.js';
import { TExecutorMessageContext, TMessageContext } from '../lib/interfaces/logger.js';
import { getNamedToVars } from '../lib/namedVars.js';
import { actionNotOK, setStepperWorlds, sleep, createSteppers, findStepper, constructorName } from '../lib/util/index.js';

export class Executor {
	// find the stepper and action, call it and return its result
	static async action(steppers: AStepper[], vstep: TFeatureStep, found: TStepAction, world: TWorld) {
		const namedWithVars = getNamedToVars(found, world, vstep);
		const stepper = findStepper<AStepper>(steppers, found.stepperName);
		const action = stepper.steps[found.actionName].action;
		return await action(namedWithVars, vstep).catch((caught: TAnyFixme) => {
			world.logger.error(caught.stack);
			return actionNotOK(`in ${vstep.in}: ${caught.message}`, { topics: { caught: (caught?.stack || caught).toString() } });
		});
	}
	static async execute(
		csteppers: CStepper[],
		world: TWorld,
		features: TResolvedFeature[],
		endFeatureCallbacks?: TEndFeatureCallback[]
	): Promise<TExecutorResult> {
		let ok = true;
		const stayOnFailure = world.options[STAY] === STAY_FAILURE;
		const featureResults: TFeatureResult[] = [];
		let featureNum = 0;

		for (const feature of features) {
			featureNum++;

			const newWorld = { ...world, tag: { ...world.tag, ...{ featureNum: 0 + featureNum } } };

			const featureExecutor = new FeatureExecutor(csteppers, endFeatureCallbacks);
			await featureExecutor.setup(newWorld);

			const featureResult = await featureExecutor.doFeature(feature);

			ok = ok && featureResult.ok;
			featureResults.push(featureResult);
			const shouldClose = ok || !stayOnFailure;
			await featureExecutor.endFeature(); // this should be before close
			if (shouldClose) {
				await featureExecutor.close();
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

	constructor(private csteppers: CStepper[], private endFeatureCallbacks?: TEndFeatureCallback[]) {
		this.csteppers = csteppers;
		this.endFeatureCallbacks = endFeatureCallbacks;
	}
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

		for (const step of feature.vsteps) {
			world.logger.log(step.in);
			const result = await FeatureExecutor.doFeatureStep(this.steppers, step, world);

			if (world.options.step_delay) {
				await sleep(world.options.step_delay as number);
			}
			ok = ok && result.ok;
			if (!result.ok) {
				await this.onFailure(result, step);
			}
			const indicator = result.ok ? '✅' : '❌';
			world.logger.log(indicator, <TExecutorMessageContext>{ topic: { stage: 'Executor', result, step } });
			stepResults.push(result);
			if (!ok) {
				break;
			}
		}
		const featureResult: TFeatureResult = { path: feature.path, ok, stepResults };

		return featureResult;
	}

	static async doFeatureStep(steppers: AStepper[], vstep: TFeatureStep, world: TWorld): Promise<TStepResult> {
		let ok = true;

		// FIXME feature should really be attached to the vstep
		const action = vstep.action;
		const start = world.timer.since();
		const res: Partial<TActionResult> = await Executor.action(steppers, vstep, action, world);

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

		return { ok, in: vstep.in, sourcePath: vstep.source.path, actionResult, seq: vstep.seq };
	}
	async onFailure(result: TStepResult, step: TFeatureStep) {
		for (const stepper of this.steppers) {
			if (stepper.onFailure) {
				const res = await stepper.onFailure(result, step);
				this.world.logger.error(`onFailure from ${result.in} for ${constructorName(stepper)}`, <TMessageContext>res);
			}
		}
	}

	async endFeature() {
		for (const stepper of this.steppers) {
			if (stepper.endFeature) {
				this.world.logger.debug(`endFeature ${constructorName(stepper)}`);
				await stepper.endFeature().catch((error: TAnyFixme) => {
					console.error('endFeature', error);
					throw error;
				});
				this.world.logger.debug(`endedFeature ${constructorName(stepper)}`);
			}
		}
	}
	async doEndFeatureCallback(featureResult: TFeatureResult) {
		if (this.endFeatureCallbacks) {
			for (const callback of this.endFeatureCallbacks) {
				try {
					await callback({ world: this.world, result: featureResult, steppers: this.steppers, startOffset: this.startOffset });
				} catch (error: TAnyFixme) {
					throw Error(error);
				}
			}
		}
	}
	async close() {
		for (const stepper of this.steppers) {
			if (stepper.close) {
				this.world.logger.debug(`closing ${constructorName(stepper)}`);
				await stepper.close();
			}
		}
	}
}
