import { z } from "zod";
import { DOMAIN_VERTEX_LABEL } from "../lib/resources.js";
import { TResolvedFeature, TWorld, TEndFeature } from "../lib/execution.js";
import { TExecutorResult, TFeatureResult, THaibunEvent, STAY, STAY_FAILURE, STEP_DELAY, CONTINUE_AFTER_ERROR, TSeqPath, FEATURE_START, Timer, STAY_ALWAYS, } from "../schema/protocol.js"; import { LifecycleEvent } from "../schema/protocol.js";
import { AStepper } from "../lib/astepper.js";
import { sleep, setStepperWorldsAndDomains, constructorName } from "../lib/util/index.js";
import { StepRegistry, dispatchStep } from "../lib/step-dispatch.js";
import { SCENARIO_START } from "../schema/protocol.js";
import { FeatureVariables } from "../lib/feature-variables.js";
import { registerDomains } from "../lib/domains.js";
import { doStepperCycle, doStepperCycleSync } from "../lib/stepper-cycles.js";
import { basename } from "path";

export function calculateShouldClose({ thisFeatureOK, isLast, stayOnFailure, continueAfterError, stayAlways, }: { thisFeatureOK: boolean; isLast: boolean; stayOnFailure: boolean; continueAfterError: boolean; stayAlways: boolean; }) {
	const effectivelyLast = isLast || (!thisFeatureOK && !continueAfterError);
	if (!effectivelyLast) return true;
	if (stayAlways) return false;
	if (!thisFeatureOK && stayOnFailure) return false;
	return true;
}

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

export class Executor {
	private static createExecutionFailure(featureResults: TFeatureResult[]): TExecutorResult["failure"] | undefined {
		const firstFailedFeature = featureResults.find((fr) => !fr.ok);
		if (!firstFailedFeature) return undefined;

		const failedStep = firstFailedFeature.stepResults.find((sr) => !sr.ok && sr.intent?.mode !== "speculative");
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

	static async executeFeatures(steppers: AStepper[], world: TWorld, features: TResolvedFeature[]): Promise<TExecutorResult> {
		initExecutionRuntime(world);
		world.runtime.steppers = steppers;
		const stepRegistry = new StepRegistry(steppers, world);
		world.runtime.stepRegistry = stepRegistry;

		const onEventHandler = (event: THaibunEvent) => {
			doStepperCycleSync(steppers, "onEvent", event);
		};
		world.eventLogger.subscribe(onEventHandler);

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

			const shouldClose = calculateShouldClose({
				thisFeatureOK: featureResult.ok,
				isLast,
				continueAfterError,
				stayOnFailure,
				stayAlways,
			});
			await doStepperCycle(steppers, "endFeature", <TEndFeature>{
				featurePath: feature.path,
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
		world.eventLogger.unsubscribe(onEventHandler);
		return results;
	}
}

export class FeatureExecutor {
	constructor(
		private steppers: AStepper[],
		private registry: StepRegistry,
		private world: TWorld,
		private startOffset = Timer.since(),
	) { }

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
					world.shared = new FeatureVariables(world, await baseVars.all());
					scopedVars = new FeatureVariables(world, await world.shared.all());
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
						featureName: feature.name,
						status: "running",
					}),
				);
			}

			if (step.action.actionName === SCENARIO_START) {
				if (currentScenario) {
					await doStepperCycle(this.steppers, "endScenario", undefined);
					scopedVars = new FeatureVariables(world, await world.shared.all());
				}
				currentScenario = currentScenario + 1;
				world.eventLogger.emit(
					LifecycleEvent.parse({
						id: `feat-${world.tag.featureNum}.scen-${currentScenario + 1}`,
						timestamp: Date.now(),
						kind: "lifecycle",
						type: "scenario",
						stage: "start",
						scenarioName: step.in.replace(/^Scenario:\s*/i, ""),
						status: "running",
					}),
				);
				await doStepperCycle(this.steppers, "startScenario", { scopedVars });
			}

			const augmentedStep = {
				...step,
				seqPath: [world.tag.featureNum, currentScenario + 1, ...step.seqPath],
			};

			const result = await dispatchStep({ registry: this.registry, world, steppers: this.steppers }, augmentedStep);
			ok = ok && result.ok;
			if (!ok) break;

			if (world.options[STEP_DELAY]) {
				await sleep(world.options[STEP_DELAY] as number);
			}
			if (!currentScenario) {
				scopedVars = new FeatureVariables(world, await world.shared.all());
				baseVars = new FeatureVariables(world, await world.shared.all());
			}
		}

		if (currentScenario) {
			await doStepperCycle(this.steppers, "endScenario", undefined);
		}

		return { path: feature.path, ok, stepResults: world.runtime.stepResults };
	}
}

export const addStepperConcerns = (world: TWorld, steppers: AStepper[]) => {
	const allDomains: import("../lib/resources.js").TDomainDefinition[] = [];
	for (const stepper of steppers) {
		const hasCycles = stepper as unknown as { cycles?: { getConcerns?: () => import("../lib/execution.js").IStepperConcerns } };
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
	// Register vertex-label domain from all registered vertex types
	const vertexLabels = Object.values(world.domains)
		.filter((d) => d.topology?.vertexLabel)
		.map((d) => d.topology?.vertexLabel as string);
	if (vertexLabels.length > 0) {
		registerDomains(world, [
			[{ selectors: [DOMAIN_VERTEX_LABEL], schema: z.enum(vertexLabels as [string, ...string[]]), description: "Vertex type" }],
		]);
	}
};

// SeqPath conventions:
// - Normal feature execution uses [feature, scenario, step, ...].
// - Feature-scoped synthetic work uses [feature, 0, ordinal].
// - Speculative/debug branches extend a real step path with negative suffixes.
// - Top-level ad hoc transport calls use [0, ordinal].
export function syntheticSeqPathDirection(speculative = false): 1 | -1 {
	return speculative ? -1 : 1;
}

export function featureSyntheticSeqPath(featureNum: number, ordinal: number, branch = 0): TSeqPath {
	return [featureNum, branch, ordinal];
}

export function syntheticBranchSeqPath(parentSeqPath: TSeqPath, dir: 1 | -1 = 1): TSeqPath {
	return [...parentSeqPath, dir === -1 ? -1 : 1];
}

export function advanceSyntheticSeqPath(seqPath: TSeqPath, dir: 1 | -1 = 1): TSeqPath {
	return [...seqPath.slice(0, -1), seqPath[seqPath.length - 1] + dir];
}

export function incSeqPath(withSeqPath: { seqPath: TSeqPath }[], seqPath: TSeqPath, dir = 1): TSeqPath {
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
