import { z } from "zod";
import { DOMAIN_DOMAIN_KEY } from "../lib/domains.js";
import type { TWorld } from "../lib/world.js";
import { TResolvedFeature, TEndFeature } from "../lib/astepper.js";
import {
	TExecutorResult,
	TFeatureResult,
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
import { LifecycleEvent } from "../schema/protocol.js";
import { AStepper } from "../lib/astepper.js";
import { sleep, setStepperWorldsAndDomains, constructorName } from "../lib/util/index.js";
import { dispatchStep } from "../lib/step-dispatch.js";
import { StepRegistry } from "../lib/step-registry.js";
import { SCENARIO_START } from "../schema/protocol.js";
import { FeatureVariables } from "../lib/feature-variables.js";
import { registerDomains, refreshHypermediaTypeDomain } from "../lib/domains.js";
import { doStepperCycle, doStepperCycleSync } from "../lib/stepper-cycles.js";
import { basename } from "path";

/**
 * What a run keeps of a feature it has moved on from. A passing step's products, artifacts and traces are read while
 * that feature is the one running, and by a caller that has just received its result; once the run has moved to
 * another feature, nothing reads them again, and holding them holds every graph slice, response body and rendered
 * document the run has produced. That is what made a nineteen-feature run exhaust the heap and be killed rather than
 * fail. A failed step keeps everything, since the verdict is made of it.
 */
export function releasePayloads(featureResult: TFeatureResult): void {
	for (const step of featureResult.stepResults) {
		if (!step.ok) continue;
		step.products = undefined;
		step.artifact = undefined;
		step.traces = undefined;
		step.protocol = undefined;
	}
}

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

function initExecutionRuntime(_world: TWorld): void {
	// Working-memory observations live in the quad store under the observation/* named
	// graphs; the store is created with the world, so nothing to initialize here.
}

async function initFeatureRuntime(world: TWorld): Promise<void> {
	// Clear transient graphs between features so cross-feature state doesn't leak:
	//   - observation/* — runtime metrics and counters
	//   - facts        — step-product assertions (auto-asserted by dispatchStep)
	// Variables (SHARED_GRAPH) survive intentionally — features can carry named
	// state forward through the feature-variables layer.
	const store = world.shared.getStore();
	const allQuads = await store.all();
	const transientGraphs = new Set(allQuads.filter((q) => q.namedGraph.startsWith("observation/") || q.namedGraph === "facts").map((q) => q.namedGraph));
	for (const graph of transientGraphs) await store.clear(graph);
}

/**
 * Duck-typed attach() on every stepper that implements a transport
 * (has `attach` and `detach` methods). Called from two places:
 *
 *   - Executor, right after it creates world.runtime.stepRegistry,
 *     so any stepper transport is live before the first feature runs.
 *     This covers pure-client configs (e.g. agent with `{remote}`
 *     entry, no webserver).
 *
 *   - WebServerStepper's `enable rpc` / `refresh steppers` steps,
 *     which create their own registry and re-attach transports into
 *     it. Delegating here keeps both call sites consistent.
 *
 * Core's Executor invocation passes no webserver; transports that need
 * one (e.g. SSE adding routes) no-op when it is absent. Remote-proxy
 * transports don't use it.
 */
// biome-ignore lint/suspicious/noExplicitAny: duck-typed webserver shape varies by caller.
export function attachTransportsToRegistry(steppers: AStepper[], registry: StepRegistry, webserver?: any): void {
	for (const s of steppers) {
		// biome-ignore lint/suspicious/noExplicitAny: duck-typed IStepTransport check
		const candidate = s as unknown as { attach?: (registry: StepRegistry, webserver: any) => void; detach?: () => void };
		if (typeof candidate.attach !== "function" || typeof candidate.detach !== "function") continue;
		candidate.attach(registry, webserver);
	}
}

export class Executor {
	static createExecutionFailure(featureResults: TFeatureResult[]): TExecutorResult["failure"] | undefined {
		const firstFailedFeature = featureResults.find((fr) => !fr.ok);
		if (!firstFailedFeature) return undefined;

		// The verdict names an accountable feature step. A synthetic dispatch (a negative seqPath segment: a model's
		// tool call, an RPC) can fail and be recovered from inside its parent step; naming it here reported a recovered
		// tool call as the run's failure while the step that actually failed the feature went unmentioned.
		const nonSpeculative = firstFailedFeature.stepResults.filter((sr) => !sr.ok && sr.intent?.mode !== "speculative");
		const failedStep = nonSpeculative.find((sr) => !sr.seqPath?.some((n) => n < 0)) ?? nonSpeculative[0];
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
		// Any stepper that implements IStepTransport (duck-typed: has `attach`
		// and `detach` methods) injects its tools into the registry now,
		// covering RemoteStepperProxy entries from `{remote}` config lines and
		// subprocess transports. WebServerStepper's enable-rpc step re-attaches
		// into a fresh registry when it builds one; registry.set is keyed by
		// method name so duplicate injections are idempotent.
		attachTransportsToRegistry(steppers, stepRegistry);

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
			// `feature.name` is the per-Feature key from a kireji split or the basename for raw .feature files.
			const featureName = feature.name || basename(feature.path).replace(/\..*$/, "");
			const newWorld = {
				...world,
				tag: { ...world.tag, featureNum, featureName },
			};

			await initFeatureRuntime(newWorld);

			const featureExecutor = new FeatureExecutor(steppers, stepRegistry, newWorld);

			await setStepperWorldsAndDomains(steppers, newWorld);
			await doStepperCycle(steppers, "startFeature", { resolvedFeature: feature, index: featureNum });
			stepRegistry.refresh(steppers, newWorld);
			world.eventLogger.info(
				`feature ${featureNum}/${features.length}: ${feature.path}${feature.name && feature.name !== basename(feature.path).replace(/\..*$/, "") ? ` [${feature.name}]` : ""}`,
			);

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
			// The feature just finished keeps what it produced for whoever receives this result; the one before it has
			// no reader left, so the run stops holding what that one produced.
			const previous = featureResults[featureResults.length - 1];
			if (previous) releasePayloads(previous);
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
		// Stay mode keeps the process serving requests after execute() returns; unsubscribing here would stop
		// routing events to live consumers while the server is still emitting them. Keep it while staying.
		const willStay = stayAlways || (stayOnFailure && !okSoFar);
		if (!willStay) world.eventLogger.unsubscribe(onEventHandler);
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
		world.runtime.seqPaths = new Map<string, number>();

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
				// Root on [hostId, featureNum, scenarioNum, ...resolverStepSeq] so
				// observations from different haibun instances can never collide
				// and a multi-host cross-host join can union by seqPath safely.
				seqPath: [world.tag.hostId, world.tag.featureNum, currentScenario + 1, ...step.seqPath],
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
		const hasCycles = stepper as unknown as { cycles?: { getConcerns?: () => import("../lib/astepper.js").IStepperConcerns } };
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
	// Register the persisted-type enum over all registered persisted types.
	refreshHypermediaTypeDomain(world);
	// Register domain-key domain as an enum over every domain currently in the
	// registry. Renders as a dropdown in form-based step callers (shu step-caller).
	const domainKeys = Object.keys(world.domains).sort();
	if (domainKeys.length > 0) {
		registerDomains(world, [
			[
				{
					selectors: [DOMAIN_DOMAIN_KEY],
					schema: z.enum(domainKeys as [string, ...string[]]),
					description: "A registered domain identifier — referenced by goal-resolution and meta-introspection steps.",
				},
			],
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

export function featureSyntheticSeqPath(featureNum: number, ordinal: number, branch = 0, hostId = 0): TSeqPath {
	return [hostId, featureNum, branch, ordinal];
}

export function syntheticBranchSeqPath(parentSeqPath: TSeqPath, dir: 1 | -1 = 1): TSeqPath {
	return [...parentSeqPath, dir === -1 ? -1 : 1];
}

export function advanceSyntheticSeqPath(seqPath: TSeqPath, dir: 1 | -1 = 1): TSeqPath {
	return [...seqPath.slice(0, -1), seqPath[seqPath.length - 1] + dir];
}

/**
 * The next path under a parent step, in the direction the parent's steps are numbered in.
 *
 * A path is allocated from a count held per parent rather than searched for among the results a feature has produced.
 * Searching costs the feature so far on every step, and the feature so far grows: a run that services requests for
 * weeks allocates every path by reading every result it has ever produced. The count answers in constant time and
 * holds only the parents allocated under.
 *
 * The count only advances, so a path this hands out is never handed out again, and an allocation nothing goes on to
 * use leaves a gap in the numbering. Nothing reads the numbering for anything but order and identity, both of which a
 * gap preserves.
 */
export function nextSeqPath(world: TWorld, parent: TSeqPath, dir = 1): TSeqPath {
	const held = (world.runtime.seqPaths ??= new Map<string, number>());
	const key = `${parent.join(".")}|${dir}`;
	const taken = held.get(key);
	const index = taken === undefined ? dir : taken + dir;
	held.set(key, index);
	return [...parent, index];
}
