import { TFeatureStep, TResolvedFeature, TWorld, TStepAction, TEndFeature, StepperMethodArgs, TBeforeStep, TAfterStep, IStepperCycles, ExecMode, TAfterStepResult } from '../lib/defs.js';
import { TExecutorResult, TStepResult, TFeatureResult, TActionResult, TStepActionResult, STAY, STAY_FAILURE, CHECK_NO, CHECK_YES, CHECK_YIELD, STEP_DELAY, TNotOKActionResult, CONTINUE_AFTER_ERROR, TStepArgs, MAYBE_CHECK_YES, MAYBE_CHECK_NO, TSeqPath, FEATURE_START, Timer } from '../schema/protocol.js';
import { LifecycleEvent } from '../schema/protocol.js';
import { AStepper, IHasCycles } from '../lib/astepper.js';
import { actionNotOK, sleep, findStepper, setStepperWorldsAndDomains, } from '../lib/util/index.js';
import { SCENARIO_START } from '../schema/protocol.js';
import { FeatureVariables } from '../lib/feature-variables.js';
import { populateActionArgs } from '../lib/populateActionArgs.js';
import { registerDomains } from '../lib/domain-types.js';
import { basename } from 'path';

function calculateShouldClose({ thisFeatureOK, isLast, stayOnFailure, continueAfterError }) {
	if (thisFeatureOK) {
		return true;
	}
	if (isLast && stayOnFailure) {
		return false;
	}
	if (!thisFeatureOK && !isLast && continueAfterError) {
		return true;
	}
	if (!thisFeatureOK) {
		return true;
	}
	return true;
}
const MAX_EXECUTE_SEQPATH = 50;

export class Executor {
	private static createExecutionFailure(featureResults: TFeatureResult[]): TExecutorResult['failure'] | undefined {
		const firstFailedFeature = featureResults.find(fr => !fr.ok);
		if (!firstFailedFeature) {
			return undefined;
		}

		const failedStep = firstFailedFeature.stepResults.find(sr =>
			!sr.ok && sr.intent?.mode !== 'speculative'
		);
		if (!failedStep) {
			return undefined;
		}

		const errorMessage = failedStep.stepActionResult && 'message' in failedStep.stepActionResult
			? failedStep.stepActionResult.message
			: 'Step execution failed';

		return {
			stage: 'Execute',
			error: {
				message: errorMessage,
				details: {
					step: failedStep.in,
					path: failedStep.path,
					seqPath: failedStep.seqPath
				}
			}
		};
	}

	static async action(steppers: AStepper[], featureStep: TFeatureStep, found: TStepAction, args: TStepArgs, world: TWorld) {
		const stepper = findStepper<AStepper>(steppers, found.stepperName);
		const action = stepper.steps[found.actionName].action;

		// Track step usage for observation pattern
		const usageKey = `${found.stepperName}.${found.actionName}`;
		// Ensure observations map exists (it should be initialized in executeFeatures)
		if (!world.runtime.observations) {
			world.runtime.observations = new Map();
		}
		const stepUsage = world.runtime.observations.get('stepUsage') || new Map<string, number>();
		stepUsage.set(usageKey, (stepUsage.get(usageKey) || 0) + 1);
		world.runtime.observations.set('stepUsage', stepUsage);



		try {
			return await action(args, featureStep);
		} catch (caught) {
			if (featureStep.intent?.mode !== 'speculative') {
				world.eventLogger.log(featureStep, 'error', caught.stack || caught.message);
			}
			return actionNotOK(`in ${featureStep.in}: ${caught.message}`);
		}
	}
	static async executeFeatures(steppers: AStepper[], world: TWorld, features: TResolvedFeature[]): Promise<TExecutorResult> {

		if (!world.runtime.observations) {
			world.runtime.observations = new Map();
		}
		await addStepperConcerns(world, steppers);

		world.eventLogger.setStepperCallback((event) => {
			doStepperCycleSync(steppers, 'onEvent', event);
		});

		// Emit resolved features artifact once at the start
		try {
			const { ResolvedFeaturesArtifact } = await import('../schema/protocol.js');
			const resolvedFeaturesEvent = ResolvedFeaturesArtifact.parse({
				id: `artifact.resolvedFeatures`,
				timestamp: Date.now(),
				kind: 'artifact',
				artifactType: 'resolvedFeatures',
				resolvedFeatures: features,
				mimetype: 'application/json',
			});
			world.eventLogger.emit(resolvedFeaturesEvent);
		} catch (e) {
			// Silently continue if artifact emission fails
		}

		await doStepperCycle(steppers, 'startExecution', features);
		let okSoFar = true;
		const stayOnFailure = world.options[STAY] === STAY_FAILURE;
		const featureResults: TFeatureResult[] = [];
		let featureNum = 0;
		const continueAfterError = !!(world.options[CONTINUE_AFTER_ERROR]);

		// Create a synthetic featureStep for logging outside of step context
		const syntheticStep: TFeatureStep = { source: { path: '' }, in: '', seqPath: [0], action: { actionName: 'runner', stepperName: 'Executor', step: { action: async () => ({ ok: true }) } } };

		for (const feature of features) {
			featureNum++;
			const isLast = featureNum === features.length;

			world.runtime.exhaustionError = undefined;
			const featureName = basename(feature.path).replace(/\..*$/, '');
			const newWorld = { ...world, tag: { ...world.tag, featureNum: featureNum, featureName } };

			const featureExecutor = new FeatureExecutor(steppers, newWorld);

			// Reset observations for the new feature
			if (newWorld.runtime) {
				newWorld.runtime.observations = new Map();

			}

			await setStepperWorldsAndDomains(steppers, newWorld);
			await doStepperCycle(steppers, 'startFeature', { resolvedFeature: feature, index: featureNum });
			world.eventLogger.log(syntheticStep, 'info', `feature ${featureNum}/${features.length}: ${feature.path}`);

			const featureResult = await featureExecutor.doFeature(feature);
			if (newWorld.runtime && newWorld.runtime.exhaustionError) {
				world.runtime.exhaustionError = newWorld.runtime.exhaustionError;
			}
			const thisFeatureOK = featureResult.ok;
			if (!thisFeatureOK) {
				const failedStep = featureResult.stepResults.find((s) => !s.ok);
				await doStepperCycle(steppers, 'onFailure', { featureResult, failedStep });
			}
			okSoFar = okSoFar && thisFeatureOK;
			featureResults.push(featureResult);
			const shouldCloseFactors = { thisFeatureOK: featureResult.ok, okSoFar, isLast, continueAfterError, stayOnFailure }
			const shouldClose = calculateShouldClose(shouldCloseFactors);
			await doStepperCycle(steppers, 'endFeature', <TEndFeature>{ world: newWorld, shouldClose, isLast, okSoFar, continueAfterError, stayOnFailure, thisFeatureOK: featureResult.ok });
			if (!okSoFar) {
				if (!continueAfterError && !isLast) {
					break;
				}
			}
		}

		const results = { ok: okSoFar, featureResults: featureResults, tag: world.tag, shared: world.shared, steppers, failure: undefined };
		if (!okSoFar) {
			const failure = this.createExecutionFailure(featureResults);
			if (failure) {
				results.failure = failure;
			}
		}
		await doStepperCycle(steppers, 'endExecution', results);
		return results;
	}
}

export class FeatureExecutor {
	constructor(private steppers: AStepper[], private world: TWorld, private startOffset = Timer.since()) {
	}

	async doFeature(feature: TResolvedFeature): Promise<TFeatureResult> {
		const world = this.world;
		let ok = true;
		world.runtime.stepResults = [];

		let currentScenario: number = 0;

		let scopedVars: FeatureVariables = new FeatureVariables(world, {});
		let baseVars: FeatureVariables = new FeatureVariables(world, {});

		for (const step of feature.featureSteps) {
			if (step.action.actionName === FEATURE_START) {
				if (currentScenario) {
					await doStepperCycle(this.steppers, 'endScenario', undefined);
					world.shared = new FeatureVariables(world, baseVars.all());
					scopedVars = new FeatureVariables(world, world.shared.all());
					currentScenario = 0;
				}
				// Set current feature path for dynamic statement execution (debugger, quantifiers, etc.)
				world.runtime.currentFeaturePath = feature.path;
				world.eventLogger.emit(LifecycleEvent.parse({
					id: `feat-${world.tag.featureNum}`,
					timestamp: Date.now(),
					kind: 'lifecycle',
					completeness: 'full',
					type: 'feature',
					stage: 'start',
					featurePath: feature.path,
					status: 'running',
				}));
			}

			if (step.action.actionName === SCENARIO_START) {
				if (currentScenario) {
					await doStepperCycle(this.steppers, 'endScenario', undefined);
					scopedVars = new FeatureVariables(world, world.shared.all());
				}
				currentScenario = currentScenario + 1;
				world.eventLogger.emit(LifecycleEvent.parse({
					id: `feat-${world.tag.featureNum}.scen-${currentScenario + 1}`,
					timestamp: Date.now(),
					kind: 'lifecycle',
					completeness: 'full',
					type: 'scenario',
					stage: 'start',
					scenarioName: step.in,
					status: 'running',
				}));
				await doStepperCycle(this.steppers, 'startScenario', { scopedVars });
			}

			const augmentedStep = { ...step, seqPath: [world.tag.featureNum, currentScenario + 1, ...step.seqPath] };

			const result = await FeatureExecutor.doFeatureStep(this.steppers, augmentedStep, world);
			ok = ok && result.ok;
			if (!ok) {
				break;
			}

			if (world.options[STEP_DELAY]) {
				await sleep(world.options[STEP_DELAY] as number);
			}
			if (!currentScenario) {
				scopedVars = new FeatureVariables(world, world.shared.all());
				baseVars = new FeatureVariables(world, world.shared.all());
			}
		}
		if (currentScenario) {
			await doStepperCycle(this.steppers, 'endScenario', undefined);
		}
		const featureResult: TFeatureResult = { path: feature.path, ok, stepResults: world.runtime.stepResults };

		return featureResult;
	}

	static async doFeatureStep(steppers: AStepper[], featureStep: TFeatureStep, world: TWorld, execMode: ExecMode = ExecMode.WITH_CYCLES): Promise<TStepResult> {
		const { action } = featureStep;
		const currentTime = Timer.since();

		const createFailedStepResult = (message: string): TStepResult => {
			return stepResultFromActionResult(
				actionNotOK(message),
				action,
				currentTime,
				Timer.since(),
				featureStep,
				false
			);
		};

		if (world.runtime.exhaustionError) {
			return createFailedStepResult(`Execution halted: ${world.runtime.exhaustionError}`);
		}

		if (featureStep.seqPath.length > MAX_EXECUTE_SEQPATH) {
			const errorMessage = `Execution depth limit exceeded (${featureStep.seqPath.length} > ${MAX_EXECUTE_SEQPATH}). Possible infinite recursion in step: ${featureStep.in}`;
			world.runtime.exhaustionError = errorMessage;
			return createFailedStepResult(errorMessage);
		}

		let ok = true;

		const start = Timer.since();
		const args = await populateActionArgs(featureStep, world, steppers);

		const isFullCycles = execMode === ExecMode.WITH_CYCLES;
		const isSubStep = featureStep.isSubStep || false;

		let actionResult: TActionResult;
		if (isFullCycles) {
			if (action.actionName !== FEATURE_START && action.actionName !== SCENARIO_START) {
				world.eventLogger.stepStart(featureStep, action.stepperName, action.actionName, args, featureStep.action.stepValuesMap);
			}
			let doAction = true;
			while (doAction) {
				await doStepperCycle(steppers, 'beforeStep', <TBeforeStep>({ featureStep }));
				actionResult = await Executor.action(steppers, featureStep, action, args, world);

				if (action.actionName !== FEATURE_START && action.actionName !== SCENARIO_START) {
					const errorMessage = !actionResult.ok ? (actionResult as TNotOKActionResult).message : undefined;
					world.eventLogger.stepEnd(featureStep, action.stepperName, action.actionName, actionResult.ok, errorMessage, args, featureStep.action.stepValuesMap, actionResult.topics);
				}

				world.runtime.stepResults.push(stepResultFromActionResult(actionResult, action, start, Timer.since(), featureStep, ok && actionResult.ok));
				const instructions: TAfterStepResult[] = await doStepperCycle(steppers, 'afterStep', <TAfterStep>({ featureStep, actionResult }), action.actionName);
				doAction = instructions.some(i => i?.rerunStep);
				const failed = instructions.some(i => i?.failed);
				if (failed) {
					ok = false;
				} else {
					const doNext = instructions.some(i => i?.nextStep);
					if (doNext) {
						actionResult = { ...actionResult, ok: true };
					}
				}
			}
		} else {
			actionResult = await Executor.action(steppers, featureStep, action, args, world);
		}

		ok = ok && actionResult.ok;
		const stepResult = stepResultFromActionResult(actionResult, action, start, Timer.since(), featureStep, ok);

		return stepResult;
	}
}

const doStepperCycle = async <K extends keyof IStepperCycles>(steppers: AStepper[], method: K, args: StepperMethodArgs[K], guidance = ''): Promise<Awaited<ReturnType<NonNullable<IStepperCycles[K]>>>[]> => {
	const results: Awaited<ReturnType<NonNullable<IStepperCycles[K]>>>[] = [];
	const hasCycles = (steppers as unknown[] as (AStepper & IHasCycles)[]).filter(c => c.cycles && c.cycles[method])
		.sort((a, b) => {
			const key = method as keyof typeof a.cyclesWhen;
			const aVal = a.cyclesWhen?.[key];
			const bVal = b.cyclesWhen?.[key];
			return (aVal ?? 0) - (bVal ?? 0);
		});
	for (const cycling of hasCycles) {
		const cycle = cycling.cycles[method]!;
		const paramsForApply = args === undefined ? [] : [args];
		const result = await (cycle as (...a: unknown[]) => Promise<unknown>).apply(cycling, paramsForApply);
		results.push(result as Awaited<ReturnType<NonNullable<IStepperCycles[K]>>>);
	}
	return results;
};

const doStepperCycleSync = <K extends keyof IStepperCycles>(steppers: AStepper[], method: K, args: StepperMethodArgs[K]): void => {
	const hasCycles = (steppers as unknown[] as (AStepper & IHasCycles)[]).filter(c => c.cycles && c.cycles[method]);
	for (const cycling of hasCycles) {
		const cycle = cycling.cycles[method]!;
		const paramsForApply = args === undefined ? [] : [args];
		(cycle as (...a: unknown[]) => void).apply(cycling, paramsForApply);
	}
};

const addStepperConcerns = async (world, steppers: AStepper[]) => {
	const results = await doStepperCycle(steppers, 'getConcerns', undefined);
	// Extract and register domains from concerns
	const domains = results.filter(r => r?.domains).flatMap(r => r.domains);
	registerDomains(world, [domains]);
	// Sources are registered separately (looked up by name when needed)
}

function stepResultFromActionResult(actionResult: TActionResult, action: TStepAction, start: number, end: number, featureStep: TFeatureStep, ok: boolean) {
	const stepActionResult: TStepActionResult = { ...actionResult, name: action.actionName, start, end } as TStepActionResult;
	const seqPath = featureStep.seqPath;
	const stepResult: TStepResult = { in: featureStep.in, path: featureStep.source.path, lineNumber: featureStep.source.lineNumber, ok, stepActionResult, seqPath, intent: featureStep.intent };
	return stepResult;
}


export function incSeqPath(withSeqPath: { seqPath: TSeqPath }[], seqPath: TSeqPath, dir = 1): TSeqPath {
	const prefix = seqPath.slice(0, -1);
	let last = dir === -1 ? -1 : seqPath[seqPath.length - 1];
	let candidate = [...prefix, last];
	let found = true;
	while (found) {
		found = withSeqPath.some(r => JSON.stringify(r.seqPath) === JSON.stringify(candidate));
		if (found) {
			last += dir;
			candidate = [...prefix, last];
		}
	}
	return candidate;
}
