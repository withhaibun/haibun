/**
 * The Executor: it executes resolved features, each step through dispatchStep, and moves the actuality machine at each
 * level's start and end. The execution starts before the first feature and ends after the last; a feature starts before
 * its first step and ends after its failure cycle; a scenario starts at its heading and ends where the next scenario,
 * the next feature heading or the feature's last step ends it.
 */
import { basename } from "path";
import { RUN_AUTHORITY, runAuthorizedWith } from "../../capability-context.js";
import type { TWorld } from "../domains/world.js";
import { hasCycles, type AStepper, type TResolvedFeature, type TEndFeature, type TEndExecution } from "../../steps/domains/stepper.js";
import { STAY, STEP_DELAY, CONTINUE_AFTER_ERROR, FEATURE_START, SCENARIO_START, STATUS, ResolvedFeaturesArtifact } from "../../domains/protocol.js";
import type { TExecutorResult, TFeatureResult, TStepResult, THaibunEvent } from "../../domains/protocol.js";
import { sleep, setStepperWorldsAndDomains, constructorName } from "../../util/index.js";
import { dispatchStep } from "./step-dispatch.js";
import { openRunRegistry, type StepRegistry } from "../../steps/pipelines/step-registry.js";
import { featureAsData } from "../../features.js";
import { FeatureVariables } from "./feature-variables.js";
import { FACT_LABEL, type TDomainDefinition } from "../../resources.js";
import { registerDomains, registerStepperNames } from "../../domains/domains.js";
import { doStepperCycle, doStepperCycleSync } from "../../steps/pipelines/stepper-cycles.js";
import { calculateShouldClose, declaredStepTextHash, executionFailure, staysAfterExecution } from "../derivations/execution-end.js";
import { executionEvent, featureEvent, scenarioEvent } from "../derivations/lifecycle-events.js";
import { moveActuality } from "./move-actuality.js";

/**
 * Releases the payloads of a finished feature's passing steps. A reader reads a passing step's products, artifact and
 * protocol while its feature executes. The caller that receives the feature's result reads them too. A reader doesn't
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
	step.protocol = undefined;
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

/** A feature's name: the per-feature key of a kireji split, or else its file's basename without its extensions. */
const featureNameOf = (feature: TResolvedFeature): string => feature.name || basename(feature.path).replace(/\..*$/, "");

/** How a level ends: completed where it passed, failed where it didn't. */
const endOf = (ok: boolean) => ({ stage: "end", status: ok ? STATUS.completed : STATUS.failed }) as const;

export class Executor {
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
				timestamp: world.clock.now(),
				kind: "artifact",
				artifactType: "resolvedFeatures",
				resolvedFeatures: features.map(featureAsData),
				...(registeredOutcomes ? { registeredOutcomes } : {}),
				mimetype: "application/json",
			}),
		);

		await moveActuality(world, executionEvent({ stage: "start" }, world.clock.now(), [...new Set(features.map((feature) => feature.base))].join(", ")));
		await doStepperCycle(steppers, "startExecution", features);
		let okSoFar = true;
		const featureResults: TFeatureResult[] = [];
		let featureNum = 0;
		const continueAfterError = !!world.options[CONTINUE_AFTER_ERROR];

		for (const feature of features) {
			featureNum++;
			const isLast = featureNum === features.length;

			world.runtime.exhaustionError = undefined;
			const featureName = featureNameOf(feature);
			const newWorld = { ...world, tag: { ...world.tag, featureNum, featureName } };
			// The feature's variables are written by a store of the feature's world, so each names the step that set it under
			// the feature's execution.
			newWorld.shared = new FeatureVariables(newWorld, await world.shared.carried());

			await initFeatureRuntime(newWorld);

			const featureExecutor = new FeatureExecutor(steppers, stepRegistry, newWorld);

			await setStepperWorldsAndDomains(steppers, newWorld);
			await doStepperCycle(steppers, "startFeature", { resolvedFeature: feature, index: featureNum });
			stepRegistry.refresh(steppers, newWorld);
			world.eventLogger.info(`feature ${featureNum}/${features.length}: ${feature.path}${feature.name && feature.name !== featureName ? ` [${feature.name}]` : ""}`);

			const featureResult = await featureExecutor.doFeature(feature);
			// The next feature starts from the records this feature's store holds.
			world.shared = newWorld.shared;
			if (newWorld.runtime.exhaustionError) world.runtime.exhaustionError = newWorld.runtime.exhaustionError;
			const thisFeatureOK = featureResult.ok;
			if (!thisFeatureOK) {
				const failedStep = featureResult.steps.failed;
				await doStepperCycle(steppers, "onFailure", { featureResult, failedStep });
			}
			await moveActuality(world, featureEvent(featureNum, { path: feature.path, name: featureName }, endOf(thisFeatureOK), world.clock.now()));
			okSoFar = okSoFar && thisFeatureOK;
			// The feature that finished keeps its payloads for the caller that receives this result. The previous feature's
			// payloads don't have a reader, so releasePayloads clears its passing steps' payloads.
			const previous = featureResults[featureResults.length - 1];
			if (previous) releasePayloads(previous);
			featureResults.push(featureResult);

			const shouldClose = calculateShouldClose({ thisFeatureOK, isLast, continueAfterError, stay: world.options[STAY] });
			await doStepperCycle(steppers, "endFeature", <TEndFeature>{ featurePath: feature.path, shouldClose, isLast, okSoFar, continueAfterError, thisFeatureOK });
			if (!okSoFar && !continueAfterError && !isLast) break;
		}

		await moveActuality(world, executionEvent(endOf(okSoFar), world.clock.now()));
		const failure = okSoFar ? undefined : executionFailure(featureResults);
		const results: TExecutorResult = { ok: okSoFar, featureResults, actuality: world.runtime.actuality.state.get(), tag: world.tag, shared: world.shared, steppers, failure };

		// HAIBUN_STAY keeps the process serving requests after executeFeatures returns. Unsubscribing would stop routing
		// events to consumers while the server emits them, so the handler stays subscribed while actuality stays.
		const stays = staysAfterExecution(world.options[STAY], okSoFar);
		await doStepperCycle(steppers, "endExecution", <TEndExecution>{ ...results, stays });
		if (!stays) world.eventLogger.unsubscribe(onEventHandler);
		return results;
	}
}

export class FeatureExecutor {
	constructor(
		private steppers: AStepper[],
		private registry: StepRegistry,
		private world: TWorld,
	) {}

	/** Executes a feature's steps. The feature starts here and its caller ends it, after the feature's failure cycle. */
	async doFeature(feature: TResolvedFeature): Promise<TFeatureResult> {
		const world = this.world;
		const { featureNum } = world.tag;
		let ok = true;
		world.runtime.stepResults = [];
		world.runtime.steps = { count: 0 };
		world.runtime.seqPaths = new Map<string, number>();
		world.runtime.currentFeaturePath = feature.path;
		await moveActuality(world, featureEvent(featureNum, { path: feature.path, name: featureNameOf(feature) }, { stage: "start" }, world.clock.now()));

		// The scenario a step is in, by its ordinal among the feature's scenarios, or 0 before the first scenario. A feature
		// heading after a scenario starts a scenario too, from the variables the feature's steps before its first scenario
		// left, so each step's path and its scenario's events state one number, and a number doesn't repeat.
		let running: { ordinal: number; name: string } | undefined;
		let ordinal = 0;
		let baseVars = new FeatureVariables(world, {});
		/** Ends the running scenario: its event, then the cycle that closes what its steppers opened for it. */
		const endScenario = async (scenarioOk: boolean): Promise<void> => {
			if (running === undefined) throw new Error(`feature ${feature.path} ended a scenario that didn't start; a scenario heading starts one`);
			await moveActuality(world, scenarioEvent(featureNum, running.ordinal, running.name, endOf(scenarioOk), world.clock.now()));
			running = undefined;
			await doStepperCycle(this.steppers, "endScenario", undefined);
		};

		for (const step of feature.featureSteps) {
			const { actionName } = step.action;
			if (actionName === SCENARIO_START || (actionName === FEATURE_START && running)) {
				if (running) await endScenario(true);
				// The steps before the first scenario end where it starts: every scenario, and the next feature, starts from
				// what they left. Taken here once rather than after each of them, since a copy of the variables after every
				// step grows with the steps a long background has run.
				if (ordinal === 0) baseVars = new FeatureVariables(world, await world.shared.carried());
				else if (actionName === FEATURE_START) world.shared = new FeatureVariables(world, await baseVars.carried());
				ordinal = ordinal + 1;
				running = { ordinal, name: step.in.replace(/^\w+:\s*/, "") };
				await moveActuality(world, scenarioEvent(featureNum, running.ordinal, running.name, { stage: "start" }, world.clock.now()));
				await doStepperCycle(this.steppers, "startScenario", { scopedVars: new FeatureVariables(world, await world.shared.carried()) });
			}

			const augmentedStep = {
				...step,
				// The seqPath is [hostId, featureNum, scenarioNum, ...resolverStepSeq]. A multi-host deployment sets a hostId
				// for each instance, so observations from different instances don't collide. A cross-host join can union them
				// by seqPath.
				seqPath: [world.tag.hostId, featureNum, ordinal, ...step.seqPath],
			};

			const result = await dispatchStep({ registry: this.registry, world, steppers: this.steppers }, augmentedStep);
			ok = ok && result.ok;
			if (!ok) break;

			const stepDelay = world.options[STEP_DELAY];
			if (stepDelay) await sleep(stepDelay);
		}

		if (running) await endScenario(ok);

		return { path: feature.path, ok, steps: world.runtime.steps, declaredStepTextHash: declaredStepTextHash(feature.featureSteps), stepResults: world.runtime.stepResults };
	}
}

export const addStepperConcerns = (world: TWorld, steppers: AStepper[]) => {
	const allDomains: TDomainDefinition[] = [];
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
