import {
	TFeatureStep,
	TResolvedFeature,
	TWorld,
	TStepAction,
	TEndFeature,
	StepperMethodArgs,
	TBeforeStep,
	TAfterStep,
	IStepperCycles,
	ExecMode,
	TAfterStepResult,
} from "../lib/defs.js";
import {
	TExecutorResult,
	TStepResult,
	TFeatureResult,
	TActionResult,
	TStepActionResult,
	STAY,
	STAY_FAILURE,
	STEP_DELAY,
	TNotOKActionResult,
	CONTINUE_AFTER_ERROR,
	TStepArgs,
	TSeqPath,
	FEATURE_START,
	Timer,
	STAY_ALWAYS,
} from "../schema/protocol.js";
import { LifecycleEvent } from "../schema/protocol.js";
import { AStepper, IHasCycles } from "../lib/astepper.js";
import {
	actionNotOK,
	actionOKWithProducts,
	sleep,
	setStepperWorldsAndDomains,
} from "../lib/util/index.js";
import { StepRegistry, stepMethodName } from "../lib/step-dispatch.js";
import { SCENARIO_START } from "../schema/protocol.js";
import { FeatureVariables } from "../lib/feature-variables.js";
import { populateActionArgs } from "../lib/populateActionArgs.js";
import { registerDomains } from "../lib/domain-types.js";
import { basename } from "path";

export function calculateShouldClose({
	thisFeatureOK,
	isLast,
	stayOnFailure,
	continueAfterError,
	stayAlways,
}: {
	thisFeatureOK: boolean;
	isLast: boolean;
	stayOnFailure: boolean;
	continueAfterError: boolean;
	stayAlways: boolean;
}) {
	const effectivelyLast = isLast || (!thisFeatureOK && !continueAfterError);
	if (!effectivelyLast) return true;
	if (stayAlways) return false;
	if (!thisFeatureOK && stayOnFailure) return false;
	return true;
}

const MAX_EXECUTE_SEQPATH = 50;

function initExecutionRuntime(world: TWorld): void {
	if (!world.runtime.observations) {
		world.runtime.observations = new Map();
	}
}

function initFeatureRuntime(world: TWorld): void {
	if (world.runtime) {
		world.runtime.observations = new Map();
	}
}

/**
 * Execute a single feature step through the step registry.
 * Single dispatch path for both feature-file execution and FlowRunner.
 * FEATURE_START and SCENARIO_START are pass-through (no registry lookup needed).
 */
export async function executeStep(
	registry: StepRegistry,
	steppers: AStepper[],
	featureStep: TFeatureStep,
	world: TWorld,
	execMode: ExecMode = ExecMode.WITH_CYCLES,
): Promise<TStepResult> {
	const { action } = featureStep;
	const start = Timer.since();

	const createFailedStepResult = (message: string): TStepResult =>
		stepResultFromActionResult(actionNotOK(message), action, start, Timer.since(), featureStep, false);

	if (world.runtime.exhaustionError) {
		return createFailedStepResult(`Execution halted: ${world.runtime.exhaustionError}`);
	}

	if (featureStep.seqPath.length > MAX_EXECUTE_SEQPATH) {
		const msg = `Execution depth limit exceeded (${featureStep.seqPath.length} > ${MAX_EXECUTE_SEQPATH}). Possible infinite recursion in step: ${featureStep.in}`;
		world.runtime.exhaustionError = msg;
		return createFailedStepResult(msg);
	}

	const args = await populateActionArgs(featureStep, world, steppers);
	const isFullCycles = execMode === ExecMode.WITH_CYCLES;

	let actionResult: TActionResult;
	let ok = true;

	if (isFullCycles) {
		const isLifecycle = action.actionName === FEATURE_START || action.actionName === SCENARIO_START;
		if (!isLifecycle) {
			world.eventLogger.stepStart(featureStep, action.stepperName, action.actionName, args, featureStep.action.stepValuesMap);
		}

		let doAction = true;
		while (doAction) {
			await doStepperCycle(steppers, "beforeStep", <TBeforeStep>{ featureStep });

			actionResult = await dispatchStep(registry, steppers, featureStep, action, args, world);

			if (!isLifecycle) {
				world.eventLogger.stepEnd(
					featureStep,
					action.stepperName,
					action.actionName,
					actionResult.ok,
					!actionResult.ok ? (actionResult as TNotOKActionResult).message : undefined,
					args,
					featureStep.action.stepValuesMap,
					"products" in actionResult ? (actionResult.products as Record<string, unknown>) : undefined,
				);
			}

			world.runtime.stepResults.push(
				stepResultFromActionResult(actionResult, action, start, Timer.since(), featureStep, ok && actionResult.ok),
			);

			const instructions: TAfterStepResult[] = await doStepperCycle(
				steppers,
				"afterStep",
				<TAfterStep>{ featureStep, actionResult },
				action.actionName,
			);
			doAction = instructions.some((i) => i?.rerunStep);
			const failed = instructions.some((i) => i?.failed);
			if (failed) {
				ok = false;
			} else if (instructions.some((i) => i?.nextStep)) {
				actionResult = { ...actionResult, ok: true };
			}
		}
	} else {
		actionResult = await dispatchStep(registry, steppers, featureStep, action, args, world);
	}

	ok = ok && actionResult.ok;
	return stepResultFromActionResult(actionResult, action, start, Timer.since(), featureStep, ok);
}

/**
 * Look up the step in the registry and call its handler.
 * Falls back to actionOK for FEATURE_START/SCENARIO_START (lifecycle markers, not real steps).
 * Converts StepHandlerResult → TActionResult.
 */
async function dispatchStep(
	registry: StepRegistry,
	steppers: AStepper[],
	featureStep: TFeatureStep,
	action: TStepAction,
	args: TStepArgs,
	world: TWorld,
): Promise<TActionResult> {
	if (action.actionName === FEATURE_START || action.actionName === SCENARIO_START) {
		return { ok: true };
	}

	const method = stepMethodName(action.stepperName, action.actionName);
	const tool = registry.get(method);

	if (!tool) {
		return actionNotOK(`Step not found in registry: ${method}`);
	}

	// Track step usage for observation pattern
	if (!world.runtime.observations) world.runtime.observations = new Map();
	const usageKey = `${action.stepperName}.${action.actionName}`;
	const stepUsage = (world.runtime.observations.get("stepUsage") as Map<string, number>) || new Map<string, number>();
	stepUsage.set(usageKey, (stepUsage.get(usageKey) || 0) + 1);
	world.runtime.observations.set("stepUsage", stepUsage);

	try {
		const hr = await tool.handler(args as Record<string, unknown>, featureStep.seqPath);
		if (hr.ok) {
			return actionOKWithProducts(hr.products);
		}
		return actionNotOK((hr as { ok: false; error: string }).error);
	} catch (caught) {
		const err = caught instanceof Error ? caught : new Error(String(caught));
		if (featureStep.intent?.mode !== "speculative") {
			world.eventLogger.log(featureStep, "error", err.stack || err.message);
		}
		return actionNotOK(`in ${featureStep.in}: ${err.message}`);
	}
}

export class Executor {
	private static createExecutionFailure(
		featureResults: TFeatureResult[],
	): TExecutorResult["failure"] | undefined {
		const firstFailedFeature = featureResults.find((fr) => !fr.ok);
		if (!firstFailedFeature) return undefined;

		const failedStep = firstFailedFeature.stepResults.find(
			(sr) => !sr.ok && sr.intent?.mode !== "speculative",
		);
		if (!failedStep) return undefined;

		const errorMessage =
			failedStep.stepActionResult && "message" in failedStep.stepActionResult
				? failedStep.stepActionResult.message
				: "Step execution failed";

		return {
			stage: "Execute",
			error: {
				message: errorMessage,
				details: {
					step: failedStep.in,
					path: failedStep.path,
					seqPath: failedStep.seqPath,
				},
			},
		};
	}

	static async executeFeatures(
		steppers: AStepper[],
		world: TWorld,
		features: TResolvedFeature[],
	): Promise<TExecutorResult> {
		initExecutionRuntime(world);
		const stepRegistry = new StepRegistry(steppers, world);

		world.eventLogger.subscribe((event) => {
			doStepperCycleSync(steppers, "onEvent", event);
		});

		try {
			const { ResolvedFeaturesArtifact } = await import("../schema/protocol.js");
			const outcomeResults = await doStepperCycle(steppers, "getRegisteredOutcomes", undefined);
			const registeredOutcomes = outcomeResults.find(Boolean);
			const resolvedFeaturesEvent = ResolvedFeaturesArtifact.parse({
				id: `artifact.resolvedFeatures`,
				timestamp: Date.now(),
				kind: "artifact",
				artifactType: "resolvedFeatures",
				resolvedFeatures: features,
				...(registeredOutcomes ? { registeredOutcomes } : {}),
				mimetype: "application/json",
			});
			world.eventLogger.emit(resolvedFeaturesEvent);
		} catch {
			// Silently continue if artifact emission fails
		}

		await doStepperCycle(steppers, "startExecution", features);
		let okSoFar = true;
		const stayOnFailure = world.options[STAY] === STAY_FAILURE;
		const stayAlways = world.options[STAY] === STAY_ALWAYS;
		const featureResults: TFeatureResult[] = [];
		let featureNum = 0;
		const continueAfterError = !!world.options[CONTINUE_AFTER_ERROR];

		for (const feature of features) {
			featureNum++;
			const isLast = featureNum === features.length;

			world.runtime.exhaustionError = undefined;
			const featureName = basename(feature.path).replace(/\..*$/, "");
			const newWorld = {
				...world,
				tag: { ...world.tag, featureNum, featureName },
			};

			initFeatureRuntime(newWorld);

			const featureExecutor = new FeatureExecutor(steppers, stepRegistry, newWorld);

			await setStepperWorldsAndDomains(steppers, newWorld);
			await doStepperCycle(steppers, "startFeature", {
				resolvedFeature: feature,
				index: featureNum,
			});
			world.eventLogger.info(`feature ${featureNum}/${features.length}: ${feature.path}`);

			const featureResult = await featureExecutor.doFeature(feature);
			if (newWorld.runtime?.exhaustionError) {
				world.runtime.exhaustionError = newWorld.runtime.exhaustionError;
			}
			const thisFeatureOK = featureResult.ok;
			if (!thisFeatureOK) {
				const failedStep = featureResult.stepResults.find((s) => !s.ok);
				await doStepperCycle(steppers, "onFailure", { featureResult, failedStep });
			}
			okSoFar = okSoFar && thisFeatureOK;
			featureResults.push(featureResult);

			const shouldClose = calculateShouldClose({
				thisFeatureOK: featureResult.ok,
				isLast,
				continueAfterError,
				stayOnFailure,
				stayAlways,
			});
			await doStepperCycle(steppers, "endFeature", <TEndFeature>{
				world: newWorld,
				shouldClose,
				isLast,
				okSoFar,
				continueAfterError,
				stayOnFailure,
				thisFeatureOK: featureResult.ok,
			});
			if (!okSoFar && !continueAfterError && !isLast) break;
		}

		const results: TExecutorResult = {
			ok: okSoFar,
			featureResults,
			tag: world.tag,
			shared: world.shared,
			steppers,
			failure: undefined,
		};
		if (!okSoFar) {
			const failure = this.createExecutionFailure(featureResults);
			if (failure) results.failure = failure;
		}

		world.eventLogger.emit(
			LifecycleEvent.parse({
				id: `execution-end`,
				timestamp: Date.now(),
				kind: "lifecycle",
				type: "execution",
				stage: "end",
				status: okSoFar ? "completed" : "failed",
			}),
		);

		await doStepperCycle(steppers, "endExecution", results);
		return results;
	}
}

export class FeatureExecutor {
	constructor(
		private steppers: AStepper[],
		private registry: StepRegistry,
		private world: TWorld,
		private startOffset = Timer.since(),
	) {}

	async doFeature(feature: TResolvedFeature): Promise<TFeatureResult> {
		const world = this.world;
		let ok = true;
		world.runtime.stepResults = [];

		let currentScenario = 0;
		let scopedVars = new FeatureVariables(world, {});
		let baseVars = new FeatureVariables(world, {});

		for (const step of feature.featureSteps) {
			if (step.action.actionName === FEATURE_START) {
				if (currentScenario) {
					await doStepperCycle(this.steppers, "endScenario", undefined);
					world.shared = new FeatureVariables(world, baseVars.all());
					scopedVars = new FeatureVariables(world, world.shared.all());
					currentScenario = 0;
				}
				world.runtime.currentFeaturePath = feature.path;
				world.eventLogger.emit(
					LifecycleEvent.parse({
						id: `feat-${world.tag.featureNum}`,
						timestamp: Date.now(),
						kind: "lifecycle",
						type: "feature",
						stage: "start",
						featurePath: feature.path,
						status: "running",
					}),
				);
			}

			if (step.action.actionName === SCENARIO_START) {
				if (currentScenario) {
					await doStepperCycle(this.steppers, "endScenario", undefined);
					scopedVars = new FeatureVariables(world, world.shared.all());
				}
				currentScenario = currentScenario + 1;
				world.eventLogger.emit(
					LifecycleEvent.parse({
						id: `feat-${world.tag.featureNum}.scen-${currentScenario + 1}`,
						timestamp: Date.now(),
						kind: "lifecycle",
						type: "scenario",
						stage: "start",
						scenarioName: step.in,
						status: "running",
					}),
				);
				await doStepperCycle(this.steppers, "startScenario", { scopedVars });
			}

			const augmentedStep = {
				...step,
				seqPath: [world.tag.featureNum, currentScenario + 1, ...step.seqPath],
			};

			const result = await executeStep(this.registry, this.steppers, augmentedStep, world);
			ok = ok && result.ok;
			if (!ok) break;

			if (world.options[STEP_DELAY]) {
				await sleep(world.options[STEP_DELAY] as number);
			}
			if (!currentScenario) {
				scopedVars = new FeatureVariables(world, world.shared.all());
				baseVars = new FeatureVariables(world, world.shared.all());
			}
		}

		if (currentScenario) {
			await doStepperCycle(this.steppers, "endScenario", undefined);
		}

		return { path: feature.path, ok, stepResults: world.runtime.stepResults };
	}
}

const doStepperCycle = async <K extends keyof IStepperCycles>(
	steppers: AStepper[],
	method: K,
	args: StepperMethodArgs[K],
	guidance = "",
): Promise<Awaited<ReturnType<NonNullable<IStepperCycles[K]>>>[]> => {
	const results: Awaited<ReturnType<NonNullable<IStepperCycles[K]>>>[] = [];
	const hasCycles = (steppers as unknown[] as (AStepper & IHasCycles)[])
		.filter((c) => c.cycles && c.cycles[method])
		.sort((a, b) => {
			const key = method as keyof typeof a.cyclesWhen;
			const aVal = a.cyclesWhen?.[key];
			const bVal = b.cyclesWhen?.[key];
			return (aVal ?? 0) - (bVal ?? 0);
		});
	for (const cycling of hasCycles) {
		const cycle = cycling.cycles[method];
		if (cycle) {
			const paramsForApply = args === undefined ? [] : [args];
			const result = await (cycle as (...a: unknown[]) => Promise<unknown>).apply(cycling, paramsForApply);
			results.push(result as Awaited<ReturnType<NonNullable<IStepperCycles[K]>>>);
		}
	}
	return results;
};

const doStepperCycleSync = <K extends keyof IStepperCycles>(
	steppers: AStepper[],
	method: K,
	args: StepperMethodArgs[K],
): void => {
	const hasCycles = (steppers as unknown[] as (AStepper & IHasCycles)[]).filter(
		(c) => c.cycles && c.cycles[method],
	);
	for (const cycling of hasCycles) {
		const cycle = cycling.cycles[method];
		if (cycle) {
			const paramsForApply = args === undefined ? [] : [args];
			(cycle as (...a: unknown[]) => void).apply(cycling, paramsForApply);
		}
	}
};

export const addStepperConcerns = async (world: TWorld, steppers: AStepper[]) => {
	const results = await doStepperCycle(steppers, "getConcerns", undefined);
	const domains = results.filter((r) => r?.domains).flatMap((r) => r.domains);
	registerDomains(world, [domains]);
};

function stepResultFromActionResult(
	actionResult: TActionResult,
	action: TStepAction,
	start: number,
	end: number,
	featureStep: TFeatureStep,
	ok: boolean,
) {
	const stepActionResult: TStepActionResult = {
		...actionResult,
		name: action.actionName,
		start,
		end,
	} as TStepActionResult;
	const stepResult: TStepResult = {
		in: featureStep.in,
		path: featureStep.source.path,
		lineNumber: featureStep.source.lineNumber,
		ok,
		stepActionResult,
		seqPath: featureStep.seqPath,
		intent: featureStep.intent,
	};
	return stepResult;
}

export function incSeqPath(
	withSeqPath: { seqPath: TSeqPath }[],
	seqPath: TSeqPath,
	dir = 1,
): TSeqPath {
	const prefix = seqPath.slice(0, -1);
	let last = dir === -1 ? -1 : seqPath[seqPath.length - 1];
	let candidate = [...prefix, last];
	let found = true;
	while (found) {
		found = withSeqPath.some((r) => JSON.stringify(r.seqPath) === JSON.stringify(candidate));
		if (found) {
			last += dir;
			candidate = [...prefix, last];
		}
	}
	return candidate;
}
