import { TFeatureStep, TResolvedFeature, TExecutorResult, TStepResult, TFeatureResult, TActionResult, TWorld, TStepActionResult, TStepAction, STAY, STAY_FAILURE, CHECK_NO, CHECK_YES, CHECK_YIELD, STEP_DELAY, TNotOKActionResult, CONTINUE_AFTER_ERROR, TEndFeature, StepperMethodArgs, TBeforeStep, TAfterStep, IStepperCycles, ExecMode, TStepArgs, TAfterStepResult, MAYBE_CHECK_YES, MAYBE_CHECK_NO, TSeqPath } from '../lib/defs.js';
import { TAnyFixme } from '../lib/fixme.js';
import { AStepper } from '../lib/astepper.js';
import { EExecutionMessageType, TMessageContext } from '../lib/interfaces/logger.js';
import { topicArtifactLogger } from '../lib/Logger.js';
import { actionNotOK, sleep, findStepper, constructorName, setStepperWorldsAndDomains, formatCurrentSeqPath } from '../lib/util/index.js';
import { SCENARIO_START } from '../lib/defs.js';
import { Timer } from '../lib/Timer.js';
import { FeatureVariables } from '../lib/feature-variables.js';
import { populateActionArgs } from '../lib/populateActionArgs.js';
import { registerDomains } from '../lib/domain-types.js';

export const endExecutonContext: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: { end: true } };

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
	private static createExecutionFailure(featureResults: TFeatureResult[], world: TWorld): TExecutorResult['failure'] | undefined {
		const firstFailedFeature = featureResults.find(fr => !fr.ok);
		if (!firstFailedFeature) {
			return undefined;
		}

		const failedStep = firstFailedFeature.stepResults.find(sr => !sr.ok);
		if (!failedStep) {
			return undefined;
		}

		const errorMessage = failedStep.stepActionResult && 'message' in failedStep.stepActionResult
			? failedStep.stepActionResult.message
			: 'Step execution failed';

		const stackTrace = [
			`Failed step: ${failedStep.in}`,
			`Path: ${failedStep.path}`,
			`SeqPath: ${failedStep.seqPath.join(',')}`,
		];

		if (world.runtime.depthLimitExceeded) {
			stackTrace.push('Depth limit exceeded');
		}
		return {
			stage: 'Execute',
			error: {
				message: errorMessage,
				details: {
					stack: stackTrace,
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
		return await Promise.resolve(action(args, featureStep)).catch((caught: TAnyFixme) => {
			world.logger.error(caught.stack);
			const messageContext = {
				incident: EExecutionMessageType.ACTION,
				incidentDetails: { caught: (caught?.stack || caught).toString() },
			}
			return actionNotOK(`in ${featureStep.in}: ${caught.message}`, { messageContext });
		});
	}
	static async executeFeatures(steppers: AStepper[], world: TWorld, features: TResolvedFeature[]): Promise<TExecutorResult> {
		await addStepperDomains(world, steppers);
		await doStepperCycle(steppers, 'startExecution', features);
		let okSoFar = true;
		const stayOnFailure = world.options[STAY] === STAY_FAILURE;
		const featureResults: TFeatureResult[] = [];
		let featureNum = 0;
		const continueAfterError = !!(world.options[CONTINUE_AFTER_ERROR]);

		for (const feature of features) {
			featureNum++;
			const isLast = featureNum === features.length;

			world.logger.log(`███ feature ${featureNum}/${features.length}: ${feature.path}`);
			world.runtime.depthLimitExceeded = undefined;
			const newWorld = { ...world, tag: { ...world.tag, ...{ featureNum: 0 + featureNum } } };

			const featureExecutor = new FeatureExecutor(steppers, newWorld);
			await setStepperWorldsAndDomains(steppers, newWorld);
			await doStepperCycle(steppers, 'startFeature', { resolvedFeature: feature, index: featureNum });

			const featureResult = await featureExecutor.doFeature(feature);
			const thisFeatureOK = featureResult.ok;
			if (!thisFeatureOK) {
				const failedStep = featureResult.stepResults.find((s) => !s.ok);
				await doStepperCycle(steppers, 'onFailure', { featureResult, failedStep });
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
			await doStepperCycle(steppers, 'endFeature', <TEndFeature>{ world: newWorld, shouldClose, isLast, okSoFar, continueAfterError, stayOnFailure, thisFeatureOK: featureResult.ok });
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
		await doStepperCycle(steppers, 'endExecution', undefined);

		// If execution failed, capture the failure details from the first failed step
		if (!okSoFar) {
			const failure = this.createExecutionFailure(featureResults, world);
			if (failure) {
				return {
					ok: false,
					featureResults,
					tag: world.tag,
					shared: world.shared,
					steppers,
					failure
				};
			}
		}

		return { ok: okSoFar, featureResults: featureResults, tag: world.tag, shared: world.shared, steppers };
	}
}

export class FeatureExecutor {
	constructor(private steppers: AStepper[], private world: TWorld, private logit = topicArtifactLogger(world), private startOffset = Timer.since()) {
	}

	private static formatStepLogMessage(featureStep: TFeatureStep, actionResult: TActionResult, isSubStep: boolean): string {
		const seqPathStr = formatCurrentSeqPath(featureStep.seqPath);

		if (isSubStep) {
			// Substeps use yield icon with maybe status
			const maybeStatus = actionResult.ok ? MAYBE_CHECK_YES : MAYBE_CHECK_NO;
			return `${CHECK_YIELD} ${seqPathStr} ${maybeStatus} ${featureStep.in}`;
		}

		// Top-level steps use YES/NO icons
		if (actionResult.ok) {
			return `${CHECK_YES} ${seqPathStr} ${featureStep.in}`;
		}

		const errorMsg = (<TNotOKActionResult>actionResult).message;
		return `${CHECK_NO} ${seqPathStr} ${featureStep.in}\n   Error: ${errorMsg}`;
	}

	async doFeature(feature: TResolvedFeature): Promise<TFeatureResult> {
		const world = this.world;
		let ok = true;
		world.runtime.stepResults = [];

		let currentScenario: number = 0;

		this.logit(`start feature ${currentScenario}`, { incident: EExecutionMessageType.FEATURE_START, incidentDetails: { startTime: Timer.START_TIME, feature } }, 'debug');

		let featureVars: FeatureVariables = new FeatureVariables(world, {});

		for (const step of feature.featureSteps) {
			if (step.action.actionName === SCENARIO_START) {
				if (currentScenario) {
					this.logit(`end scenario ${currentScenario}`, { incident: EExecutionMessageType.SCENARIO_END, incidentDetails: { currentScenario } }, 'debug');
					await doStepperCycle(this.steppers, 'endScenario', undefined);
				}
				currentScenario = currentScenario + 1;
				this.logit(`start scenario ${currentScenario}`, { incident: EExecutionMessageType.SCENARIO_START, incidentDetails: { currentScenario } }, 'debug');
				await doStepperCycle(this.steppers, 'startScenario', { featureVars });
			}

			// Prepend feature number and scenario number to seqPath
			// Use 1-based scenario numbering in seqPath (currentScenario 0 becomes 1, etc.)
			const augmentedStep = {
				...step,
				seqPath: [world.tag.featureNum, currentScenario + 1, ...step.seqPath]
			};

			const result = await FeatureExecutor.doFeatureStep(this.steppers, augmentedStep, world);
			ok = ok && result.ok;
			if (!ok || result.stepActionResult.messageContext === endExecutonContext) {
				break;
			}

			if (world.options[STEP_DELAY]) {
				await sleep(world.options[STEP_DELAY] as number);
			}
			// Stash feature variables
			if (!currentScenario) {
				featureVars = new FeatureVariables(world, world.shared.all());
			}
		}
		if (currentScenario) {
			this.logit(`end scenario ${currentScenario}`, { incident: EExecutionMessageType.SCENARIO_END, incidentDetails: { currentScenario } }, 'debug');
			await doStepperCycle(this.steppers, 'endScenario', undefined);
		}
		this.logit(`end feature ${currentScenario}`, {
			incident: EExecutionMessageType.FEATURE_END, incidentDetails: {
				totalTime: Timer.since() - this.startOffset,
			}
		}, 'debug');
		const featureResult: TFeatureResult = { path: feature.path, ok, stepResults: world.runtime.stepResults };

		return featureResult;
	}

	static async doFeatureStep(steppers: AStepper[], featureStep: TFeatureStep, world: TWorld, execMode: ExecMode = ExecMode.WITH_CYCLES): Promise<TStepResult> {
		const { action } = featureStep;
		const currentTime = Timer.since();

		// Helper to create a failed step result
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

		// Check depth limit flag first - if already exceeded, immediately return failure to stop recursion
		if (world.runtime.depthLimitExceeded) {
			return createFailedStepResult('Execution halted due to depth limit exceeded');
		}

		// Check for excessive recursion depth
		if (featureStep.seqPath.length > MAX_EXECUTE_SEQPATH) {
			const errorMessage = `Execution depth limit exceeded (${featureStep.seqPath.length} > ${MAX_EXECUTE_SEQPATH}). Possible infinite recursion in step: ${featureStep.in}`;
			console.error('\n' + errorMessage);
			console.error('SeqPath:', formatCurrentSeqPath(featureStep.seqPath));
			console.error('This indicates a bug in the test definition or framework.');

			// Set flag to stop all further execution
			world.runtime.depthLimitExceeded = true;

			return createFailedStepResult(errorMessage);
		}

		let ok = true;

		const start = Timer.since();
		const args = await populateActionArgs(featureStep, world, steppers);

		const isFullCycles = execMode === ExecMode.WITH_CYCLES;
		const isPrompt = execMode === ExecMode.PROMPT;
		const isSubStep = featureStep.isSubStep || false;

		// Check if the action function is async
		const stepper = findStepper<AStepper>(steppers, action.stepperName);
		const actionFn = stepper.steps[action.actionName].action;
		const isAsync = actionFn.constructor.name === 'AsyncFunction';

		let actionResult: TActionResult;
		if (isFullCycles) {
			if (isAsync) {
				// Use same log level for start as we'll use for completion
				const startMessage = `⏳ ${formatCurrentSeqPath(featureStep.seqPath)} ${featureStep.in}`;
				const startContext = { incident: EExecutionMessageType.STEP_START, tag: world.tag, incidentDetails: { featureStep, args } };
				if (isSubStep) {
					world.logger.trace(startMessage, startContext);
				} else {
					world.logger.log(startMessage, startContext);
				}
			}
			let doAction = true;
			while (doAction) {
				await doStepperCycle(steppers, 'beforeStep', <TBeforeStep>({ featureStep }));
				actionResult = await Executor.action(steppers, featureStep, action, args, world);
				const baseContext = {
					artifacts: actionResult.artifact ? [actionResult.artifact] : undefined,
					tag: world.tag,
					incidentDetails: { actionResult, featureStep }
				};
				const messageContext: TMessageContext = { ...baseContext, incident: EExecutionMessageType.STEP_END };

				// Format the log message
				const logMessage = FeatureExecutor.formatStepLogMessage(featureStep, actionResult, isSubStep);

				// Use trace level for sub-steps, log level for top-level steps
				if (isSubStep) {
					world.logger.trace(logMessage, messageContext);
				} else {
					world.logger.log(logMessage, messageContext);
				}
				// Push result BEFORE afterStep so parent appears before afterEvery child steps
				world.runtime.stepResults.push(stepResultFromActionResult(actionResult, action, start, Timer.since(), featureStep, ok && actionResult.ok));
				const instructions: TAfterStepResult[] = await doStepperCycle(steppers, 'afterStep', <TAfterStep>({ featureStep, actionResult }), action.actionName);
				doAction = instructions.some(i => i?.rerunStep);
				const failed = instructions.some(i => i?.failed);
				if (failed) {
					ok = false;
				} else {
					const doNext = instructions.some(i => i?.nextStep);
					if (doNext) {
						// wrap the previous actionResult in a new passing actionResult messageContext
						actionResult = { ...actionResult, ok: true, messageContext: { ...messageContext, incident: EExecutionMessageType.DEBUG, incidentDetails: { nextStep: true } } };
					}
				}
			}
		} else {
			actionResult = await Executor.action(steppers, featureStep, action, args, world);
			const baseContext = {
				artifacts: actionResult.artifact ? [actionResult.artifact] : undefined,
				tag: world.tag,
				incidentDetails: { actionResult, featureStep }
			};
			const messageContext: TMessageContext = { ...baseContext, incident: EExecutionMessageType.ACTION, incidentDetails: { ...baseContext.incidentDetails, execMode } };

			// Format the log message using the same formatter
			const logMessage = FeatureExecutor.formatStepLogMessage(featureStep, actionResult, isSubStep);

			// Only log if we have a message (null means skip logging)
			if (logMessage) {
				if (isPrompt) {
					world.logger.log(logMessage, messageContext);
				} else {
					// Use trace for substeps, log for others
					if (isSubStep) {
						world.logger.trace(logMessage, messageContext);
					} else {
						world.logger.log(logMessage, messageContext);
					}
				}
			}
		}

		ok = ok && actionResult.ok;
		const stepResult = stepResultFromActionResult(actionResult, action, start, Timer.since(), featureStep, ok);

		return stepResult;
	}
}

const doStepperCycle = async <K extends keyof IStepperCycles>(steppers: AStepper[], method: K, args: StepperMethodArgs[K], guidance = ''): Promise<Awaited<ReturnType<NonNullable<IStepperCycles[K]>>>[]> => {
	const results: Awaited<ReturnType<NonNullable<IStepperCycles[K]>>>[] = [];
	for (const stepper of steppers) {
		if (stepper?.cycles && stepper.cycles[method]) {
			stepper.getWorld().logger.debug(`🔁 ${method} ${constructorName(stepper)} ${guidance}`);
			const cycle = stepper.cycles[method]!;
			const paramsForApply = args === undefined ? [] : [args];
			// The cast here is to help TypeScript understand '.apply' and 'await' with a specifically typed function
			const result = await (cycle as (...a: unknown[]) => Promise<unknown>).apply(stepper, paramsForApply);
			results.push(result as Awaited<ReturnType<NonNullable<IStepperCycles[K]>>>);
		}
	}
	return results;
};

// Register domains from stepper cycles after setWorld
const addStepperDomains = async (world, steppers: AStepper[]) => {
	const results = await doStepperCycle(steppers, 'getDomains', undefined);
	registerDomains(world, results);
}
function stepResultFromActionResult(actionResult: TActionResult, action: TStepAction, start: number, end: number, featureStep: TFeatureStep, ok: boolean) {
	const stepActionResult: TStepActionResult = { ...actionResult, name: action.actionName, start, end } as TStepActionResult;
	const seqPath = featureStep.seqPath;
	const stepResult: TStepResult = { in: featureStep.in, path: featureStep.path, ok, stepActionResult, seqPath };
	return stepResult;
}


export function incSeqPath(withSeqPath: { seqPath: TSeqPath }[], seqPath: TSeqPath, dir = 1): TSeqPath {
	// add a path to seqpath, then check world.runtime.stepResults to find the next available index accodring to dir
	const prefix = seqPath.slice(0, -1);
	// negative seqPath "starts" at -1 and counts down
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
