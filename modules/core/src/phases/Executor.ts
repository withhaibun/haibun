import { createHash } from "node:crypto";
import { RUN_AUTHORITY, runAuthorizedWith } from "../lib/capability-context.js";
import type { TWorld } from "../lib/world.js";
import { TResolvedFeature, TEndFeature, type TEndExecution, type TFeatureStep } from "../lib/astepper.js";
import {
	TExecutorResult,
	TFeatureResult,
	TStepResult,
	THaibunEvent,
	STAY,
	STAY_FAILURE,
	STEP_DELAY,
	CONTINUE_AFTER_ERROR,
	TSeqPath,
	FEATURE_START,
	Timer,
	STAY_ALWAYS,
} from "../schema/protocol.js";
import { LifecycleEvent, ResolvedFeaturesArtifact } from "../schema/protocol.js";
import { AStepper, hasCycles } from "../lib/astepper.js";
import { sleep, setStepperWorldsAndDomains, constructorName } from "../lib/util/index.js";
import { itemAt } from "../lib/util/item-at.js";
import { dispatchStep } from "../lib/step-dispatch.js";
import { openRunRegistry, type StepRegistry } from "../lib/step-registry.js";
import { featureAsData } from "../lib/features.js";
import { SCENARIO_START } from "../schema/protocol.js";
import { FeatureVariables } from "../lib/feature-variables.js";
import { FACT_LABEL } from "../lib/resources.js";
import { registerDomains, registerStepperNames } from "../lib/domains.js";
import { doStepperCycle, doStepperCycleSync } from "../lib/stepper-cycles.js";
import { basename } from "path";

/**
 * Releases the payloads of a finished feature's passing steps. A reader reads a passing step's products, artifact, traces
 * and protocol while its feature executes. The caller that receives the feature's result reads them too. A reader doesn't
 * read them after actuality starts another feature. Holding them would hold every graph slice, response body and rendered
 * document that actuality produces. Over many features the process then exhausts the heap and exits without reporting a
 * failure. releasePayload doesn't clear a failed step, because the onFailure cycle and the verdict read it.
 */
export function releasePayloads(featureResult: TFeatureResult): void {
	for (const step of featureResult.stepResults) releasePayload(step);
}

/** Clears a passing step's payload fields. */
function releasePayload(step: TStepResult): void {
	if (!step.ok) return;
	step.products = undefined;
	step.artifact = undefined;
	step.traces = undefined;
	step.protocol = undefined;
}

/** Returns whether actuality keeps serving after its features end. `HAIBUN_STAY` selects always or only after a failure. */
export function staysAfterExecution(stay: unknown, ok: boolean): boolean {
	return stay === STAY_ALWAYS || (stay === STAY_FAILURE && !ok);
}

/** Returns whether steppers close a feature's resources when the feature ends. They close them unless the feature is the last to execute and actuality stays. */
export function calculateShouldClose({ thisFeatureOK, isLast, continueAfterError, stay }: { thisFeatureOK: boolean; isLast: boolean; continueAfterError: boolean; stay: unknown }) {
	const effectivelyLast = isLast || (!thisFeatureOK && !continueAfterError);
	return !effectivelyLast || !staysAfterExecution(stay, thisFeatureOK);
}

/** Clears the facts between features, so a feature doesn't read another feature's facts. The variables remain. */
async function initFeatureRuntime(world: TWorld): Promise<void> {
	await world.shared.getStore().clear(FACT_LABEL);
}

/**
 * Calls attach() on every stepper that implements a transport. A transport is a stepper with `attach` and `detach`
 * methods. The Executor calls this after it opens actuality's registry, so every transport attaches before the first
 * feature executes. This function passes attach() only the registry, so a config that doesn't have a webserver attaches
 * its transports too. An agent config that has a `{remote}` entry and doesn't have a webserver is one such config.
 */
function attachTransportsToRegistry(steppers: AStepper[], registry: StepRegistry): void {
	for (const s of steppers) if ("attach" in s && typeof s.attach === "function" && "detach" in s && typeof s.detach === "function") s.attach(registry);
}

export class Executor {
	static createExecutionFailure(featureResults: TFeatureResult[]): TExecutorResult["failure"] | undefined {
		const firstFailedFeature = featureResults.find((fr) => !fr.ok);
		if (!firstFailedFeature) return undefined;

		// The verdict names the feature step that failed the feature. foldStep stores the first failed feature step in
		// `steps.failed` in place of an earlier failed synthetic dispatch or speculative step. A synthetic dispatch has a
		// negative seqPath segment. A model's tool call and an RPC dispatch are synthetic dispatches. The parent step can
		// recover from a failed synthetic dispatch, so naming the dispatch would report a recovered tool call as actuality's
		// failure.
		const failedStep = firstFailedFeature.steps.failed;
		if (!failedStep) return undefined;

		const errorMessage = failedStep.errorMessage || "Step execution failed";

		return { stage: "Execute", error: { message: errorMessage, details: { step: failedStep.in, path: failedStep.path, seqPath: failedStep.seqPath } } };
	}

	/** Executes the features under RUN_AUTHORITY. Every line, cycle and finalizer executes as the instance and holds its authority.
	 *  An outside caller reaches a step only through a transport. The transport passes the caller's invoked action and held
	 *  actions to dispatchStep. */
	static executeFeatures(steppers: AStepper[], world: TWorld, features: TResolvedFeature[]): Promise<TExecutorResult> {
		return runAuthorizedWith(RUN_AUTHORITY, () => Executor.runFeatures(steppers, world, features));
	}

	private static async runFeatures(steppers: AStepper[], world: TWorld, features: TResolvedFeature[]): Promise<TExecutorResult> {
		world.runtime.steppers = steppers;
		const stepRegistry = openRunRegistry(world, steppers);
		// Every transport attaches to actuality's one registry. A remote proxy injects the remote host's steps into the
		// registry. The MCP stepper reads the registry each time it lists or dispatches a step.
		attachTransportsToRegistry(steppers, stepRegistry);

		const onEventHandler = (event: THaibunEvent) => {
			doStepperCycleSync(steppers, "onEvent", event);
		};
		world.eventLogger.subscribe(onEventHandler);

		const outcomeResults = await doStepperCycle(steppers, "getRegisteredOutcomes", undefined);
		const registeredOutcomes = outcomeResults.find(Boolean);
		world.eventLogger.emit(
			ResolvedFeaturesArtifact.parse({
				id: `artifact.resolvedFeatures`,
				timestamp: Date.now(),
				kind: "artifact",
				artifactType: "resolvedFeatures",
				resolvedFeatures: features.map(featureAsData),
				...(registeredOutcomes ? { registeredOutcomes } : {}),
				mimetype: "application/json",
			}),
		);

		await doStepperCycle(steppers, "startExecution", features);
		let okSoFar = true;
		const featureResults: TFeatureResult[] = [];
		let featureNum = 0;
		const continueAfterError = !!world.options[CONTINUE_AFTER_ERROR];

		for (const feature of features) {
			featureNum++;
			const isLast = featureNum === features.length;

			world.runtime.exhaustionError = undefined;
			// `feature.name` holds the per-Feature key of a kireji split. A feature that doesn't have a name takes its file's
			// basename without its extensions.
			const featureName = feature.name || basename(feature.path).replace(/\..*$/, "");
			const newWorld = { ...world, tag: { ...world.tag, featureNum, featureName } };
			// The feature's variables are written by a store of the feature's world, so each names the step that set it under
			// the feature's execution.
			newWorld.shared = new FeatureVariables(newWorld, await world.shared.carried());

			await initFeatureRuntime(newWorld);

			const featureExecutor = new FeatureExecutor(steppers, stepRegistry, newWorld);

			await setStepperWorldsAndDomains(steppers, newWorld);
			await doStepperCycle(steppers, "startFeature", { resolvedFeature: feature, index: featureNum });
			stepRegistry.refresh(steppers, newWorld);
			world.eventLogger.info(
				`feature ${featureNum}/${features.length}: ${feature.path}${feature.name && feature.name !== basename(feature.path).replace(/\..*$/, "") ? ` [${feature.name}]` : ""}`,
			);

			const featureResult = await featureExecutor.doFeature(feature);
			// The next feature starts from the records this feature's store holds.
			world.shared = newWorld.shared;
			if (newWorld.runtime?.exhaustionError) {
				world.runtime.exhaustionError = newWorld.runtime.exhaustionError;
			}
			const thisFeatureOK = featureResult.ok;
			if (!thisFeatureOK) {
				const failedStep = featureResult.steps.failed;
				await doStepperCycle(steppers, "onFailure", { featureResult, failedStep });
			}
			okSoFar = okSoFar && thisFeatureOK;
			// The feature that finished keeps its payloads for the caller that receives this result. The previous feature's
			// payloads don't have a reader, so releasePayloads clears its passing steps' payloads.
			const previous = featureResults[featureResults.length - 1];
			if (previous) releasePayloads(previous);
			featureResults.push(featureResult);

			const shouldClose = calculateShouldClose({ thisFeatureOK: featureResult.ok, isLast, continueAfterError, stay: world.options[STAY] });
			await doStepperCycle(steppers, "endFeature", <TEndFeature>{ featurePath: feature.path, shouldClose, isLast, okSoFar, continueAfterError, thisFeatureOK: featureResult.ok });
			if (!okSoFar && !continueAfterError && !isLast) break;
		}

		const results: TExecutorResult = { ok: okSoFar, featureResults, tag: world.tag, shared: world.shared, steppers, failure: undefined };
		if (!okSoFar) {
			const failure = this.createExecutionFailure(featureResults);
			if (failure) results.failure = failure;
		}

		world.eventLogger.emit(
			LifecycleEvent.parse({ id: `execution-end`, timestamp: Date.now(), kind: "lifecycle", type: "execution", stage: "end", status: okSoFar ? "completed" : "failed" }),
		);

		// HAIBUN_STAY keeps the process serving requests after executeFeatures returns. Unsubscribing would stop routing
		// events to consumers while the server emits them, so the handler stays subscribed while actuality stays.
		const stays = staysAfterExecution(world.options[STAY], okSoFar);
		await doStepperCycle(steppers, "endExecution", <TEndExecution>{ ...results, stays });
		if (!stays) world.eventLogger.unsubscribe(onEventHandler);
		return results;
	}
}

/** Joins a feature's declared step lines with newlines in declaration order and returns their SHA-256 hex digest. */
function hashDeclaredStepText(featureSteps: readonly TFeatureStep[]): string {
	return createHash("sha256")
		.update(featureSteps.map((step) => step.in).join("\n"))
		.digest("hex");
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
		world.runtime.steps = { count: 0 };
		world.runtime.seqPaths = new Map<string, number>();

		let currentScenario = 0;
		let scopedVars = new FeatureVariables(world, {});
		let baseVars = new FeatureVariables(world, {});

		for (const step of feature.featureSteps) {
			if (step.action.actionName === FEATURE_START) {
				if (currentScenario) {
					await doStepperCycle(this.steppers, "endScenario", undefined);
					world.shared = new FeatureVariables(world, await baseVars.carried());
					scopedVars = new FeatureVariables(world, await world.shared.carried());
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
					scopedVars = new FeatureVariables(world, await world.shared.carried());
				} else {
					// The background ends where the first scenario starts: every scenario, and the next feature, starts from
					// what it left. Taken here once rather than after each background step, since a copy of the variables
					// after every step grows with the steps a long background has run.
					scopedVars = new FeatureVariables(world, await world.shared.carried());
					baseVars = new FeatureVariables(world, await world.shared.carried());
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
				// The seqPath is [hostId, featureNum, scenarioNum, ...resolverStepSeq]. A multi-host deployment sets a hostId
				// for each instance, so observations from different instances don't collide. A cross-host join can union them
				// by seqPath.
				seqPath: [world.tag.hostId, world.tag.featureNum, currentScenario + 1, ...step.seqPath],
			};

			const result = await dispatchStep({ registry: this.registry, world, steppers: this.steppers }, augmentedStep);
			ok = ok && result.ok;
			if (!ok) break;

			if (world.options[STEP_DELAY]) {
				await sleep(world.options[STEP_DELAY] as number);
			}
		}

		if (currentScenario) {
			await doStepperCycle(this.steppers, "endScenario", undefined);
		}

		const declaredStepTextHash = hashDeclaredStepText(feature.featureSteps);
		return { path: feature.path, ok, steps: world.runtime.steps ?? { count: 0 }, declaredStepTextHash, stepResults: world.runtime.stepResults };
	}
}

export const addStepperConcerns = (world: TWorld, steppers: AStepper[]) => {
	const allDomains: import("../lib/resources.js").TDomainDefinition[] = [];
	for (const stepper of steppers) {
		if (!hasCycles(stepper) || !stepper.cycles.getConcerns) continue;
		const concerns = stepper.cycles.getConcerns();
		if (concerns?.domains) {
			const name = constructorName(stepper);
			for (const domain of concerns.domains) {
				allDomains.push({ ...domain, stepperName: domain.stepperName ?? name });
			}
		}
	}
	registerStepperNames(
		world,
		steppers.map((stepper) => constructorName(stepper)),
	);
	registerDomains(world, [allDomains]);
};

// SeqPath conventions:
// - Feature execution uses [hostId, feature, scenario, step, ...].
// - Feature-scoped synthetic work uses [hostId, feature, 0, ordinal].
// - A speculative or debug branch extends its parent step's path with a negative segment.
// - An ad hoc transport call uses [hostId, SYNTHETIC_FEATURE_NUM, adHocSeq] (host-id.ts).
export function syntheticSeqPathDirection(speculative = false): 1 | -1 {
	return speculative ? -1 : 1;
}

export function featureSyntheticSeqPath(featureNum: number, ordinal: number, branch = 0, hostId = 0): TSeqPath {
	return [hostId, featureNum, branch, ordinal];
}

export function syntheticBranchSeqPath(parentSeqPath: TSeqPath, dir: 1 | -1 = 1): TSeqPath {
	return [...parentSeqPath, dir === -1 ? -1 : 1];
}

export function advanceSyntheticSeqPath(seqPath: TSeqPath, dir: 1 | -1 = 1): TSeqPath {
	return [...seqPath.slice(0, -1), itemAt(seqPath, seqPath.length - 1) + dir];
}

/**
 * Returns the next path under a parent step in the given direction.
 *
 * nextSeqPath allocates the path from a count held per parent and direction. A search of a feature's results would read
 * every result on every step. Actuality can service requests for weeks, so the number of results grows for weeks.
 * nextSeqPath returns in constant time. world.runtime.seqPaths holds one entry for each parent and direction.
 *
 * The count only advances, so a path is never allocated twice. An allocation that a step doesn't use leaves a gap in the
 * numbering. Readers read the numbering only for order and identity. A gap preserves both.
 */
export function nextSeqPath(world: TWorld, parent: TSeqPath, dir = 1): TSeqPath {
	const held = (world.runtime.seqPaths ??= new Map<string, number>());
	const key = `${parent.join(".")}|${dir}`;
	const taken = held.get(key);
	const index = taken === undefined ? dir : taken + dir;
	held.set(key, index);
	return [...parent, index];
}
