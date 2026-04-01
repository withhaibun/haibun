import { TFeatureStep, TResolvedFeature, TWorld, TStepAction, TEndFeature, StepperMethodArgs, TBeforeStep, TAfterStep, IStepperCycles, TAfterStepResult } from "../lib/defs.js";
import { TExecutorResult, TStepResult, TFeatureResult, TActionResult, THaibunEvent, STAY, STAY_FAILURE, STEP_DELAY, CONTINUE_AFTER_ERROR, TSeqPath, FEATURE_START, Timer, STAY_ALWAYS } from "../schema/protocol.js";
import { LifecycleEvent } from "../schema/protocol.js";
import { AStepper, IHasCycles } from "../lib/astepper.js";
import { actionNotOK, sleep, setStepperWorldsAndDomains, constructorName } from "../lib/util/index.js";
import { StepRegistry, stepMethodName } from "../lib/step-dispatch.js";
import { SCENARIO_START } from "../schema/protocol.js";
import { FeatureVariables } from "../lib/feature-variables.js";
import { registerDomains } from "../lib/domain-types.js";
import { basename } from "path";

export function calculateShouldClose({ thisFeatureOK, isLast, stayOnFailure, continueAfterError, stayAlways, }: { thisFeatureOK: boolean; isLast: boolean; stayOnFailure: boolean; continueAfterError: boolean; stayAlways: boolean; }) {
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
 * Execute a step through the registry with beforeStep/afterStep cycles.
 * Used by both FeatureExecutor and FlowRunner.
 */
export async function executeStep(registry: StepRegistry, steppers: AStepper[], featureStep: TFeatureStep, world: TWorld): Promise<TStepResult> {
	const { action } = featureStep;
	const start = Timer.since();

	const pushAndReturn = (result: TStepResult): TStepResult => { world.runtime.stepResults.push(result); return result; };

	if (world.runtime.exhaustionError) {
		return pushAndReturn(stepResultFromActionResult(actionNotOK(`Execution halted: ${world.runtime.exhaustionError}`), action, start, Timer.since(), featureStep, false));
	}
	if (featureStep.seqPath.length > MAX_EXECUTE_SEQPATH) {
		const msg = `Execution depth limit exceeded (${featureStep.seqPath.length} > ${MAX_EXECUTE_SEQPATH}). Possible infinite recursion in step: ${featureStep.in}`;
		world.runtime.exhaustionError = msg;
		return pushAndReturn(stepResultFromActionResult(actionNotOK(msg), action, start, Timer.since(), featureStep, false));
	}

	const isLifecycle = action.actionName === FEATURE_START || action.actionName === SCENARIO_START;
	if (isLifecycle) {
		return stepResultFromActionResult({ ok: true }, action, start, Timer.since(), featureStep, true);
	}

	const method = stepMethodName(action.stepperName, action.actionName);
	const tool = registry.get(method);
	if (!tool) {
		return pushAndReturn(stepResultFromActionResult(actionNotOK(`Step not found in registry: ${method}`), action, start, Timer.since(), featureStep, false));
	}

	// Track step usage
	const usageKey = `${action.stepperName}.${action.actionName}`;
	let stepUsage = world.runtime.observations.get("stepUsage") as Map<string, number> | undefined;
	if (!stepUsage) { stepUsage = new Map(); world.runtime.observations.set("stepUsage", stepUsage); }
	stepUsage.set(usageKey, (stepUsage.get(usageKey) ?? 0) + 1);

	// Dispatch with beforeStep/afterStep cycle loop (debugger rerun)
	world.eventLogger.stepStart(featureStep, action.stepperName, action.actionName, {}, featureStep.action.stepValuesMap);
	let actionResult: TActionResult;
	let ok = true;
	let lastStepResult: TStepResult;
	let doAction = true;
	while (doAction) {
		await doStepperCycle(steppers, "beforeStep", <TBeforeStep>{ featureStep });
		actionResult = await tool.handler(featureStep, world);
		if (!actionResult.ok && actionResult.errorMessage && featureStep.intent?.mode !== "speculative") {
			world.eventLogger.log(featureStep, "error", actionResult.errorMessage);
		}
		lastStepResult = stepResultFromActionResult(actionResult, action, start, Timer.since(), featureStep, ok && actionResult.ok);
		world.runtime.stepResults.push(lastStepResult);
		const instructions: TAfterStepResult[] = await doStepperCycle(steppers, "afterStep", <TAfterStep>{ featureStep, actionResult }, action.actionName);
		doAction = instructions.some((i) => i?.rerunStep);
		if (instructions.some((i) => i?.failed)) {
			ok = false;
		} else if (instructions.some((i) => i?.nextStep)) {
			actionResult = { ...actionResult, ok: true };
		}
	}
	if (!actionResult || !lastStepResult) {
		throw new Error(`No action result recorded for ${action.stepperName}.${action.actionName}`);
	}
	ok = ok && actionResult.ok;
	world.eventLogger.stepEnd(featureStep, action.stepperName, action.actionName, ok, !ok ? actionResult.errorMessage : undefined, {}, featureStep.action.stepValuesMap, actionResult.products as Record<string, unknown> | undefined);
	lastStepResult.ok = ok;
	return lastStepResult;
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

		const errorMessage = failedStep.errorMessage || "Step execution failed";

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

	static async executeFeatures(steppers: AStepper[], world: TWorld, features: TResolvedFeature[],): Promise<TExecutorResult> {
		initExecutionRuntime(world);
		world.runtime.steppers = steppers;
		const stepRegistry = new StepRegistry(steppers, world);
		world.runtime.stepRegistry = stepRegistry;

		const onEventHandler = (event: THaibunEvent) => { doStepperCycleSync(steppers, "onEvent", event); };
		world.eventLogger.subscribe(onEventHandler);

		try {
			const { ResolvedFeaturesArtifact } = await import("../schema/protocol.js");
			const outcomeResults = await doStepperCycle(steppers, "getRegisteredOutcomes", undefined);
			const registeredOutcomes = outcomeResults.find(Boolean);
			const resolvedFeaturesEvent = ResolvedFeaturesArtifact.parse({ id: `artifact.resolvedFeatures`, timestamp: Date.now(), kind: "artifact", artifactType: "resolvedFeatures", resolvedFeatures: features, ...(registeredOutcomes ? { registeredOutcomes } : {}), mimetype: "application/json", });
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
			await doStepperCycle(steppers, "startFeature", { resolvedFeature: feature, index: featureNum });
			stepRegistry.refresh(steppers, newWorld);
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

			const shouldClose = calculateShouldClose({ thisFeatureOK: featureResult.ok, isLast, continueAfterError, stayOnFailure, stayAlways, });
			await doStepperCycle(steppers, "endFeature", <TEndFeature>{ featurePath: feature.path, shouldClose, isLast, okSoFar, continueAfterError, stayOnFailure, thisFeatureOK: featureResult.ok, });
			if (!okSoFar && !continueAfterError && !isLast) break;
		}

		const results: TExecutorResult = { ok: okSoFar, featureResults, tag: world.tag, shared: world.shared, steppers, failure: undefined, };
		if (!okSoFar) {
			const failure = this.createExecutionFailure(featureResults);
			if (failure) results.failure = failure;
		}

		world.eventLogger.emit(LifecycleEvent.parse({ id: `execution-end`, timestamp: Date.now(), kind: "lifecycle", type: "execution", stage: "end", status: okSoFar ? "completed" : "failed", }),);

		await doStepperCycle(steppers, "endExecution", results);
		world.eventLogger.unsubscribe(onEventHandler);
		return results;
	}
}

export class FeatureExecutor {
	constructor(private steppers: AStepper[], private registry: StepRegistry, private world: TWorld, private startOffset = Timer.since(),) { }

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
				world.eventLogger.emit(LifecycleEvent.parse({ id: `feat-${world.tag.featureNum}`, timestamp: Date.now(), kind: "lifecycle", type: "feature", stage: "start", featurePath: feature.path, status: "running", }),);
			}

			if (step.action.actionName === SCENARIO_START) {
				if (currentScenario) {
					await doStepperCycle(this.steppers, "endScenario", undefined);
					scopedVars = new FeatureVariables(world, world.shared.all());
				}
				currentScenario = currentScenario + 1;
				world.eventLogger.emit(LifecycleEvent.parse({ id: `feat-${world.tag.featureNum}.scen-${currentScenario + 1}`, timestamp: Date.now(), kind: "lifecycle", type: "scenario", stage: "start", scenarioName: step.in, status: "running", }),);
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

const doStepperCycle = async <K extends keyof IStepperCycles>(steppers: AStepper[], method: K, args: StepperMethodArgs[K], guidance = "",): Promise<Awaited<ReturnType<NonNullable<IStepperCycles[K]>>>[]> => {
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

const doStepperCycleSync = <K extends keyof IStepperCycles>(steppers: AStepper[], method: K, args: StepperMethodArgs[K],): void => {
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

export const addStepperConcerns = (world: TWorld, steppers: AStepper[]) => {
	const allDomains: import("../lib/defs.js").TDomainDefinition[] = [];
	for (const stepper of steppers) {
		const hasCycles = stepper as unknown as { cycles?: { getConcerns?: () => import("../lib/defs.js").IStepperConcerns } };
		if (!hasCycles.cycles?.getConcerns) continue;
		const concerns = hasCycles.cycles.getConcerns();
		if (concerns?.domains) {
			const name = constructorName(stepper);
			for (const domain of concerns.domains) {
				allDomains.push({ ...domain, stepperName: domain.stepperName ?? name });
			}
		}
	}
	registerDomains(world, [allDomains]);
};

function stepResultFromActionResult(actionResult: TActionResult, action: TStepAction, start: number, end: number, featureStep: TFeatureStep, ok: boolean): TStepResult {
	return { ...actionResult, ok, name: action.actionName, in: featureStep.in, path: featureStep.source.path, lineNumber: featureStep.source.lineNumber, seqPath: featureStep.seqPath, intent: featureStep.intent, start, end };
}

// SeqPath conventions:
// - Normal feature execution uses [feature, scenario, step, ...].
// - Feature-scoped synthetic work uses [feature, 0, ordinal].
// - Speculative/debug branches extend a real step path with negative suffixes.
// - Top-level ad hoc transport calls use [0, ordinal].
export function syntheticSeqPathDirection(speculative = false): 1 | -1 {
	return speculative ? -1 : 1;
}

export function featureSyntheticSeqPath(featureNum: number, ordinal: number, branch = 0,): TSeqPath {
	return [featureNum, branch, ordinal];
}

export function syntheticBranchSeqPath(parentSeqPath: TSeqPath, dir: 1 | -1 = 1,): TSeqPath {
	return [...parentSeqPath, dir === -1 ? -1 : 1];
}

export function advanceSyntheticSeqPath(seqPath: TSeqPath, dir: 1 | -1 = 1,): TSeqPath {
	return [...seqPath.slice(0, -1), seqPath[seqPath.length - 1] + dir];
}

export function incSeqPath(withSeqPath: { seqPath: TSeqPath }[], seqPath: TSeqPath, dir = 1,): TSeqPath {
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
