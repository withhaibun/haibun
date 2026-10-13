import { AStepper, IHasCycles, TStepperSteps, TFeatureStep, IStepperCycles, TStepperStep, CycleWhen } from "../lib/astepper.js";
import type { TFeatures, TStepInput } from "../lib/execution.js";
import { runSteppers, type TWorld } from "../lib/world.js";
import { TStepArgs, TRegisteredOutcomeEntry, OK } from "../schema/protocol.js";
import { formatSeqPath } from "../lib/seq-path.js";
import { actionOK, actionNotOK, actionOKWithProducts, getActionable, errorDetail } from "../lib/util/index.js";
import { itemAt } from "../lib/util/item-at.js";
import { DOMAIN_STATEMENT, DOMAIN_STATEMENT_LINES, DOMAIN_TITLE, DOMAIN_WAYPOINT_ARGUMENT } from "../lib/domains.js";
import { Resolver } from "../phases/Resolver.js";
import { FlowRunner } from "../lib/core/flow-runner.js";
import { ControlEvent, LifecycleEvent, STATUS } from "../schema/protocol.js";
import { buildDomainChain } from "../lib/domain-chain.js";
import { GOAL_FINDING, resolveGoal } from "../lib/goal-resolver.js";
import { readFacts } from "../lib/records/pipelines/facts.js";
import { runRegistry, stepMethodName } from "../lib/step-registry.js";
import { WAYPOINT_KIND, type TWaypointEntry, type TWaypointKind } from "../lib/affordances.js";
import { namedInterpolation } from "../lib/namedVars.js";
import { callerHolds } from "../lib/capability-context.js";
import { z } from "zod";
import { Access, LinkRelations, PersistedVertexSchema, type TDomainDefinition } from "../lib/resources.js";
import { refDomainKey, type TIndividualRef } from "../lib/domains.js";
import { ACTIVITIES_ACTIONS } from "./activities-actions.js";
import { readEvery, recordOf } from "../lib/records/pipelines/record-reads.js";

// The steps this stepper always has. The stepper adds a step for each waypoint a feature declares and for each saved waypoint.
type TActivitiesFixedSteps = {
	saveWaypoint: TStepperStep;
	registerSavedWaypoints: TStepperStep;
	runSavedWaypoint: TStepperStep;
	activity: TStepperStep;
	waypointWithProof: TStepperStep;
	waypointLabel: TStepperStep;
	ensure: TStepperStep;
};

type TActivitiesStepperSteps = TStepperSteps & TActivitiesFixedSteps;

/** The source path a saved waypoint holds where the step that saves it doesn't have a source path. The statement that runs a
 *  saved waypoint also has this source path. */
const SAVED_WAYPOINT_SOURCE = "a saved waypoint";

export const SAVED_WAYPOINT_LABEL = "SavedWaypoint";
const SAVED_WAYPOINT_DOMAIN = "saved-waypoint";
const SavedWaypointSchema = PersistedVertexSchema.extend({
	/** The waypoint's outcome. The outcome is the waypoint's name. */
	id: z.string(),
	lines: z.array(z.string()),
	source: z.string(),
	generatedAtTime: z.string(),
});
type TSavedWaypoint = z.infer<typeof SavedWaypointSchema>;
/** A saved waypoint's record. It holds the outcome, the lines of the activity in order, and the source path. The outcome is the
 *  waypoint's name. `register the saved waypoints` reads these records after a restart. The type is a schema.org HowTo
 *  whose steps are the lines. */
export const savedWaypointDomainDefinition: TDomainDefinition = {
	selectors: [SAVED_WAYPOINT_DOMAIN],
	schema: SavedWaypointSchema,
	description: "A saved waypoint's outcome and the lines its activity runs. `register the saved waypoints` registers the waypoint again after a restart.",
	topology: {
		persistedAs: SAVED_WAYPOINT_LABEL,
		accessLevel: Access.private,
		type: "schema:HowTo",
		id: "id",
		properties: { id: LinkRelations.IDENTIFIER.rel, lines: LinkRelations.STEP.rel, source: LinkRelations.SOURCE_PATH.rel },
		displayLabel: "id",
		sortColumns: { generatedAtTime: "TIMESTAMPTZ" },
	},
};

/**
 * Builds virtual steps from `waypoint` statements and saved waypoints. Each step implements P ∨ (¬P ∧ [A]P). Either the
 * proof P holds, or the activity A runs and then P holds.
 */
export class ActivitiesStepper extends AStepper implements IHasCycles {
	description = "Define and reuse activities with waypoints and proofs";

	private held?: FlowRunner;
	private get runner(): FlowRunner {
		return this.madeWithWorld(this.held, "flow runner");
	}
	private backgroundOutcomePatterns: Set<string> = new Set();
	private featureOutcomePatterns: Set<string> = new Set();
	private outcomeToFeaturePath: Map<string, string> = new Map();
	private featureSteps: Map<string, Record<string, TStepperStep>> = new Map();
	private currentFeaturePath: string = "";
	private lastFeaturePath: string = "";
	private lastResolutionPath: string = "";
	private ensuredInstances: Map<string, { proof: string[]; valid: boolean }> = new Map();
	private ensureAttempts: Map<string, number> = new Map();
	private registeredOutcomeMetadata: Map<
		string,
		{ proofStatements: string[]; proofPath: string; isBackground: boolean; activityBlockSteps?: TStepInput[]; lineNumber?: number; resolvesDomain?: string }
	> = new Map();
	private backgroundSteps: Record<string, TStepperStep> = {};
	private inActivityBlock = false;

	cycles: IStepperCycles = {
		getConcerns: () => ({ domains: [savedWaypointDomainDefinition] }),
		startExecution: () => {
			this.sendGraphLinkMessages();
		},
		startFeature: (startFeature) => {
			if (this.lastFeaturePath && this.lastFeaturePath !== startFeature.resolvedFeature.path) {
				const previousSteps = this.featureSteps.get(this.lastFeaturePath);
				if (previousSteps) {
					for (const outcome of Object.keys(previousSteps)) {
						delete this.steps[outcome];
					}
				}
			}

			const currentSteps = this.featureSteps.get(startFeature.resolvedFeature.path);
			if (currentSteps) {
				for (const [outcome, step] of Object.entries(currentSteps)) {
					this.steps[outcome] = step;
				}
			}
			for (const [outcome, step] of Object.entries(this.backgroundSteps)) {
				this.steps[outcome] = step;
			}

			this.currentFeaturePath = startFeature.resolvedFeature.path;
			this.inActivityBlock = false;
		},
		endFeature: () => {
			this.lastFeaturePath = this.currentFeaturePath;
			this.ensuredInstances.clear();
			return Promise.resolve();
		},
		getRegisteredOutcomes: () => {
			return this.getRegisteredOutcomes();
		},
	};
	cyclesWhen = { startExecution: CycleWhen.FIRST, startFeature: CycleWhen.FIRST };

	/**
	 * The resolver calls this before each feature resolves. It removes the previous feature's waypoint steps, so a feature's
	 * lines don't resolve to another feature's outcomes. It adds the current feature's waypoint steps and the background
	 * waypoint steps.
	 */
	startFeatureResolution(path: string): void {
		this.inActivityBlock = false;
		if (this.lastResolutionPath && this.lastResolutionPath !== path) {
			const previousSteps = this.featureSteps.get(this.lastResolutionPath);
			if (previousSteps) {
				for (const outcome of Object.keys(previousSteps)) {
					delete this.steps[outcome];
				}
			}
		}

		const currentSteps = this.featureSteps.get(path);
		if (currentSteps) {
			for (const [outcome, step] of Object.entries(currentSteps)) {
				this.steps[outcome] = step;
			}
		}

		for (const [outcome, step] of Object.entries(this.backgroundSteps)) {
			this.steps[outcome] = step;
		}

		this.lastResolutionPath = path;
	}

	clearAllBackgroundSteps(): void {
		this.backgroundSteps = {};
		this.backgroundOutcomePatterns.clear();
	}

	readonly baseSteps = {
		saveWaypoint: {
			description:
				"Registers a waypoint whose activity is these lines. Actuality offers the waypoint as a step after this step runs. The step refuses a line that doesn't resolve to one step and an outcome that is already registered, before it registers a waypoint. Saving an outcome again with the same lines returns the existing record.",
			gwta: `save waypoint {outcome: ${DOMAIN_TITLE}} doing {statements: ${DOMAIN_STATEMENT_LINES}}`,
			capability: ACTIVITIES_ACTIONS.saveWaypoint,
			productsDomain: SAVED_WAYPOINT_DOMAIN,
			action: async ({ outcome, statements }: { outcome: string; statements: string[] }, featureStep: TFeatureStep) =>
				actionOKWithProducts(await this.saveWaypoint(outcome, statements, featureStep.source?.path ?? SAVED_WAYPOINT_SOURCE)),
		},
		registerSavedWaypoints: {
			description: "Registers each saved waypoint from its record, so actuality offers a waypoint saved before a restart again.",
			gwta: "register the saved waypoints",
			action: async () => {
				const saved = await readEvery(this.getWorld().shared.getStore(), { label: SAVED_WAYPOINT_LABEL });
				this.registerSavedWaypoints(saved.map((record) => SavedWaypointSchema.parse(record)));
				return OK;
			},
		},
		runSavedWaypoint: {
			description:
				"Runs a saved waypoint by its outcome, as calling its step does. A line written before the waypoint was saved uses this step in place of the waypoint's step. A line resolved on a host where the waypoint isn't registered uses this step in the same way.",
			gwta: `run the saved waypoint {waypoint: ${refDomainKey(SAVED_WAYPOINT_DOMAIN)}}`,
			capability: ACTIVITIES_ACTIONS.runSavedWaypoint,
			action: async ({ waypoint }: { waypoint: TIndividualRef }, featureStep: TFeatureStep) => {
				// Every saved waypoint's step requires ACTIVITIES_ACTIONS.runSavedWaypoint, and other outcomes' steps don't.
				if (this.steps[waypoint.id]?.capability !== ACTIVITIES_ACTIONS.runSavedWaypoint) return actionNotOK(`"${waypoint.id}" isn't a waypoint saved here`);
				const ran = await this.runner.runStatements([{ in: waypoint.id, source: { path: SAVED_WAYPOINT_SOURCE } }], { parentStep: featureStep });
				return ran.ok ? OK : actionNotOK(ran.errorMessage);
			},
		},
		activity: {
			gwta: `Activity: {activity: ${DOMAIN_TITLE}}`,
			action: () => OK,
			resolveFeatureLine: (line: string, path: string, _stepper: AStepper, _backgrounds: TFeatures, allLines?: string[], lineIndex?: number, actualSourcePath?: string) => {
				this.lastResolutionPath = path;

				if (line.match(/^Activity:/i)) {
					this.inActivityBlock = true;
					return true;
				}

				if (this.inActivityBlock) {
					if (line.match(/^(Feature|Scenario|Background|Activity):/i)) {
						this.inActivityBlock = false;
						return false;
					}

					if (line.match(/^waypoint\s+/i)) {
						// resolveWaypointCommon registers the outcome under path and sets the step's source path to actualSourcePath.
						this.resolveWaypointCommon(line, path, allLines, lineIndex, line.includes(" with "), actualSourcePath);

						let hasMoreWaypoints = false;
						if (allLines && lineIndex !== undefined) {
							for (let i = lineIndex + 1; i < allLines.length; i++) {
								const nextLine = (allLines[i] || "").trim();
								if (nextLine.match(/^(Feature|Scenario|Background|Activity):/i)) {
									break;
								}
								if (nextLine.match(/^waypoint\s+/i)) {
									hasMoreWaypoints = true;
									break;
								}
							}
						}

						if (!hasMoreWaypoints) {
							this.inActivityBlock = false;
						}

						return true;
					}

					return true;
				}

				return false;
			},
		},

		waypointWithProof: {
			gwta: `waypoint {outcome: ${DOMAIN_TITLE}} with {proof:${DOMAIN_STATEMENT}}`,
			precludes: ["ActivitiesStepper.waypointLabel"],
			action: async ({ proof }: { proof: TFeatureStep[] }, featureStep: TFeatureStep) => {
				try {
					const result = await this.runner.runSteps(proof, { intent: { mode: "authoritative" }, parentStep: featureStep });
					if (!result.ok) {
						return actionNotOK(`waypoint: failed to execute proof steps: ${result.errorMessage}`);
					}
					return actionOK();
				} catch (err) {
					const msg = errorDetail(err);
					return actionNotOK(`waypoint: failed to execute proof steps: ${msg}`);
				}
			},
		},

		waypointLabel: { gwta: `waypoint {outcome: ${DOMAIN_TITLE}}`, action: async () => actionOK() },

		ensure: {
			description:
				"Runs a waypoint's proof, and on a failure runs the waypoint's activity and then the proof again. The step passes where a proof passes. The step checks working memory for a fact of a declarative waypoint's goal domain in place of a proof.",
			gwta: `ensure {outcome:${DOMAIN_STATEMENT}}`,
			unique: true,
			action: async ({ outcome }: { outcome: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const outcomeKey = outcome.map((step) => step.in).join(" ");

				const attemptKey = outcomeKey;
				const prevAttempts = this.ensureAttempts.get(attemptKey) ?? 0;
				const MAX_ENSURE_ATTEMPTS = 10;
				this.ensureAttempts.set(attemptKey, prevAttempts + 1);
				if (prevAttempts + 1 > MAX_ENSURE_ATTEMPTS) {
					if (this.getWorld().runtime) {
						this.getWorld().runtime.exhaustionError = "ensure max attempts exceeded";
					}
					return actionNotOK(`ensure: max attempts exceeded for waypoint "${outcomeKey}"`);
				}

				// Emits the ensure start event for monitors.
				this.getWorld().eventLogger.emit(
					LifecycleEvent.parse({
						id: formatSeqPath(featureStep.seqPath) + ".ensure",
						timestamp: Date.now(),
						kind: "lifecycle",
						type: "ensure",
						stage: "start",
						in: outcomeKey,
						lineNumber: featureStep.source?.lineNumber,
						featurePath: featureStep.source?.path,
						status: STATUS.running,
					}),
				);

				const pattern = outcome[0]?.action?.actionName || outcomeKey;

				const registeredWaypoint = this.steps[pattern];
				if (!registeredWaypoint) {
					this.emitEnsureEnd(featureStep, outcomeKey, false, `"${outcomeKey}" is not a registered waypoint`);
					return actionNotOK(`ensure: "${outcomeKey}" is not a registered waypoint. ensure can only be used with waypoints.`);
				}

				const metadata = this.registeredOutcomeMetadata.get(pattern);
				if (!metadata) {
					this.emitEnsureEnd(featureStep, outcomeKey, false, "the waypoint doesn't have metadata");
					return actionNotOK(`ensure: waypoint "${outcomeKey}" doesn't have metadata.`);
				}

				if (metadata.resolvesDomain) {
					// P ∨ (¬P ∧ [A]P) for a declarative goal:
					//   1. Ensure skips the activity where the goal is satisfied.
					//   2. Ensure runs the imperative activity where the goal isn't satisfied. Its lines supply the parameter
					//      values that the goal resolver doesn't compute. Step dispatch asserts each activity step's product as
					//      a fact of the step's productsDomain.
					//   3. Ensure checks the goal again.
					const initial = await this.checkDeclarativeGoal(metadata.resolvesDomain);
					if (initial.refused) {
						// The resolver refuses where callerHolds() returns undefined. Ensure continues to the imperative proof
						// below and fails where the waypoint doesn't declare a proof.
					} else if (initial.satisfied) {
						this.emitEnsureEnd(featureStep, outcomeKey, true);
						this.ensureAttempts.delete(attemptKey);
						return actionOK();
					} else if (metadata.activityBlockSteps && metadata.activityBlockSteps.length > 0) {
						try {
							const activityResult = await this.runner.runStatements(metadata.activityBlockSteps, {
								intent: { mode: "authoritative", usage: featureStep.intent?.usage },
								parentStep: featureStep,
							});
							if (!activityResult.ok) {
								this.emitEnsureEnd(featureStep, outcomeKey, false, activityResult.errorMessage);
								return actionNotOK(`ensure: waypoint "${outcomeKey}" activity failed: ${activityResult.errorMessage}`);
							}
						} catch (err) {
							const msg = errorDetail(err);
							this.emitEnsureEnd(featureStep, outcomeKey, false, msg);
							return actionNotOK(`ensure: waypoint "${outcomeKey}" activity error: ${msg}`);
						}
						const recheck = await this.checkDeclarativeGoal(metadata.resolvesDomain);
						if (recheck.satisfied) {
							this.emitEnsureEnd(featureStep, outcomeKey, true);
							this.ensureAttempts.delete(attemptKey);
							return actionOK();
						}
						this.emitEnsureEnd(featureStep, outcomeKey, false, `goal ${metadata.resolvesDomain} not asserted after activity`);
						return actionNotOK(`ensure: the activity of waypoint "${outcomeKey}" didn't assert goal "${metadata.resolvesDomain}" as a fact. Add a step that produces the goal.`);
					} else {
						// The waypoint doesn't have an imperative activity body, so ensure runs the resolver's plan. A plan
						// step runs without parameter values, so the plan completes only for producers that don't take a
						// parameter (see runDeclarativeEnsure).
						const planOutcome = await this.runDeclarativeEnsure(metadata.resolvesDomain, featureStep);
						this.emitEnsureEnd(featureStep, outcomeKey, planOutcome.ok, planOutcome.errorMessage);
						this.ensureAttempts.delete(attemptKey);
						return planOutcome.ok ? actionOK() : actionNotOK(`ensure: waypoint "${outcomeKey}" goal resolution failed: ${planOutcome.errorMessage}`);
					}
				}

				if (metadata.proofStatements.length === 0) {
					this.emitEnsureEnd(featureStep, outcomeKey, false, "the waypoint doesn't have a proof");
					return actionNotOK(`ensure: waypoint "${outcomeKey}" doesn't have a proof, and ensure takes only a waypoint with a proof.`);
				}

				try {
					const flowResult = await this.runner.runSteps(outcome, {
						intent: { mode: "authoritative", usage: featureStep.intent?.usage, stepperOptions: { isEnsure: true } },
						parentStep: featureStep,
					});

					if (!flowResult.ok) {
						this.emitEnsureEnd(featureStep, outcomeKey, false, flowResult.errorMessage);
						return actionNotOK(`ensure: waypoint "${outcomeKey}" proof failed: ${flowResult.errorMessage}`);
					}
				} catch (err) {
					const msg = errorDetail(err);
					this.emitEnsureEnd(featureStep, outcomeKey, false, msg);
					return actionNotOK(`ensure: waypoint "${outcomeKey}" proof execution error: ${msg}`);
				}

				this.ensuredInstances.set(outcomeKey, { proof: metadata.proofStatements, valid: true });
				this.ensureAttempts.delete(attemptKey);

				this.emitEnsureEnd(featureStep, outcomeKey, true);
				return actionOK();
			},
		},
	} as const satisfies TActivitiesFixedSteps;

	/** Returns the registered waypoints for the affordances snapshot (the ProvidesWaypoints capability). A declarative
	 *  waypoint is ensured where its goal domain is satisfied. The proof of an imperative waypoint runs speculatively only
	 *  after `ensure` passed for the waypoint in the current feature. A waypoint that wasn't ensured doesn't have its
	 *  variables bound, so a speculative proof would fail with "<term> is not set". */
	async waypointEntries(featureStep: TFeatureStep, satisfiedDomains: Set<string>): Promise<TWaypointEntry[]> {
		const waypoints: TWaypointEntry[] = [];
		for (const [outcome, metadata] of this.registeredOutcomeMetadata.entries()) {
			const kind: TWaypointKind = metadata.resolvesDomain ? WAYPOINT_KIND.DECLARATIVE : WAYPOINT_KIND.IMPERATIVE;
			const paramSlots = Object.keys(namedInterpolation(outcome).stepValuesMap ?? {});
			const method = stepMethodName("ActivitiesStepper", outcome);
			let ensured = false;
			let error: string | undefined;

			if (metadata.resolvesDomain) {
				ensured = satisfiedDomains.has(metadata.resolvesDomain);
			} else if (this.ensuredInstances.has(outcome) && metadata.proofStatements.length > 0) {
				try {
					const result = await this.runner.runStatements(metadata.proofStatements, { intent: { mode: "speculative" }, parentStep: featureStep });
					ensured = result.ok;
					if (!result.ok && result.errorMessage) error = result.errorMessage;
				} catch (err) {
					error = errorDetail(err);
				}
			}

			waypoints.push({
				outcome,
				kind,
				method,
				paramSlots,
				proofStatements: metadata.proofStatements,
				resolvesDomain: metadata.resolvesDomain,
				ensured,
				error,
				source: { path: metadata.proofPath, lineNumber: metadata.lineNumber },
				isBackground: metadata.isBackground,
			});
		}
		return waypoints;
	}

	readonly typedSteps = this.baseSteps;

	steps: TActivitiesStepperSteps = { ...this.baseSteps };

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.held = new FlowRunner(world, steppers);
	}

	/**
	 * Registers a background waypoint whose activity is `lines`, so every feature has its step. Writes the waypoint as a
	 * record. Refreshes actuality's registry, which calls its change listeners where the steps changed. `source` is the
	 * source path the record holds.
	 */
	async saveWaypoint(outcome: string, lines: string[], source: string): Promise<TSavedWaypoint> {
		const store = this.getWorld().shared.getStore();
		// The store holds a record for each saved waypoint. Saving an outcome again with the same lines returns the existing
		// record. registerSavedWaypoints throws for every other outcome that is already registered.
		const kept = await recordOf(store, SAVED_WAYPOINT_LABEL, outcome);
		if (kept) {
			const held = SavedWaypointSchema.parse(kept);
			if (held.lines.length === lines.length && held.lines.every((line, at) => line === lines[at])) return held;
		}
		const saved: TSavedWaypoint = { id: outcome, lines, source, generatedAtTime: new Date().toISOString() };
		this.registerSavedWaypoints([saved]);
		await store.upsertIndividual(SAVED_WAYPOINT_LABEL, saved);
		return saved;
	}

	/** Registers saved waypoints as `saveWaypoint` does, without writing their records again, and refreshes actuality's
	 *  registry once. Each step requires ACTIVITIES_ACTIONS.runSavedWaypoint. A delegation is made before the waypoint is
	 *  saved, so a delegation can't name an action specific to one waypoint. Throws before it registers any waypoint where
	 *  a line doesn't resolve to one step or an outcome is already registered. */
	private registerSavedWaypoints(saved: Pick<TSavedWaypoint, "id" | "lines" | "source">[]): void {
		const world = this.getWorld();
		const steppers = runSteppers(world);
		const resolver = new Resolver(steppers);
		const refused = saved.flatMap(({ id, lines }) => [
			...(this.steps[id] ? [`the outcome "${id}" is already registered`] : []),
			...lines.flatMap((line) => {
				try {
					resolver.findSingleStepAction(line);
					return [];
				} catch (err) {
					return [`each line of a saved waypoint resolves to one step: ${errorDetail(err)}`];
				}
			}),
		]);
		if (refused.length > 0) throw new Error(refused.join("; "));
		for (const { id, lines, source } of saved)
			this.registerOutcome(id, [], source, { isBackground: true, activityBlockSteps: lines, capability: ACTIVITIES_ACTIONS.runSavedWaypoint });
		if (saved.length > 0) runRegistry(world).refresh(steppers, world);
	}

	/**
	 * Checks whether working memory holds a fact of the goal domain. Returns `satisfied: true` where one exists. Returns
	 * the reason and detail of the resolver's `refused` finding in `refused`.
	 */
	private async checkDeclarativeGoal(domainKey: string): Promise<{ satisfied: boolean; refused?: string }> {
		const world = this.getWorld();
		const graph = buildDomainChain(runSteppers(world), world.domains);
		const facts = await readFacts(world.shared.getStore());
		const resolution = resolveGoal(domainKey, { graph, facts, held: callerHolds() });
		if (resolution.finding === GOAL_FINDING.SATISFIED) return { satisfied: true };
		if (resolution.finding === GOAL_FINDING.REFUSED) return { satisfied: false, refused: `${resolution.refusalReason}: ${resolution.detail}` };
		return { satisfied: false };
	}

	/**
	 * Ensures a declarative waypoint through the goal resolver. Runs each step of the first michi the resolver returns.
	 * Ensure calls this only where the waypoint doesn't have an imperative activity body. A plan step runs with an empty
	 * stepValuesMap, because facts don't bind to step arguments. Declare an imperative activity for a producer that takes
	 * a parameter.
	 */
	private async runDeclarativeEnsure(domainKey: string, featureStep: TFeatureStep): Promise<{ handled: boolean; ok: boolean; errorMessage?: string }> {
		const world = this.getWorld();
		const steppers = runSteppers(world);
		const graph = buildDomainChain(steppers, world.domains);
		const facts = await readFacts(world.shared.getStore());
		const resolution = resolveGoal(domainKey, { graph, facts, held: callerHolds() });

		if (resolution.finding === GOAL_FINDING.SATISFIED) return { handled: true, ok: true };
		if (resolution.finding === GOAL_FINDING.REFUSED) return { handled: false, ok: false, errorMessage: `goal-${resolution.refusalReason}: ${resolution.detail}` };
		if (resolution.finding === GOAL_FINDING.UNREACHABLE) {
			return { handled: true, ok: false, errorMessage: `goal-unreachable: ${domainKey} (missing: ${resolution.missing.join(", ")})` };
		}

		// The resolver returns a list of michi. This method runs every step of the first michi without stopping, so it
		// completes only a michi whose steps don't take a supplied value. A michi that takes a value from a person runs
		// through `walk toward` and `advance the walk`.
		const registry = runRegistry(world);
		const firstMichi = resolution.michi[0];
		if (!firstMichi) return { handled: true, ok: false, errorMessage: `goal-unreachable: ${domainKey} (the resolver didn't return a michi)` };
		for (const planStep of firstMichi.steps) {
			const tool = registry.get(stepMethodName(planStep.stepperName, planStep.stepName));
			if (!tool) return { handled: true, ok: false, errorMessage: `plan step not in registry: ${planStep.stepperName}.${planStep.stepName}` };
			const syntheticSeqPath = [...featureStep.seqPath, 0];
			const synthetic: TFeatureStep = {
				in: planStep.gwta ?? `${planStep.stepperName}.${planStep.stepName}`,
				seqPath: syntheticSeqPath,
				source: featureStep.source,
				action: { actionName: planStep.stepName, stepperName: planStep.stepperName, step: { action: () => actionOK() }, stepValuesMap: {} },
			};
			const result = await tool.handler(synthetic, world);
			if (!result.ok) return { handled: true, ok: false, errorMessage: `plan step ${planStep.stepperName}.${planStep.stepName} failed: ${result.errorMessage}` };
		}
		return { handled: true, ok: true };
	}

	private emitEnsureEnd(featureStep: TFeatureStep, outcomeKey: string, ok: boolean, error?: string): void {
		this.getWorld().eventLogger.emit(
			LifecycleEvent.parse({
				id: formatSeqPath(featureStep.seqPath) + ".ensure",
				timestamp: Date.now(),
				kind: "lifecycle",
				type: "ensure",
				stage: "end",
				in: outcomeKey,
				lineNumber: featureStep.source?.lineNumber,
				featurePath: featureStep.source?.path,
				status: ok ? STATUS.completed : STATUS.failed,
				error,
			}),
		);
	}

	registerOutcome(
		outcome: string,
		proofStatements: string[],
		proofPath: string,
		{
			isBackground,
			activityBlockSteps,
			lineNumber,
			actualSourcePath,
			resolvesDomain,
			capability,
		}: {
			isBackground?: boolean;
			activityBlockSteps?: (string | TStepInput)[];
			lineNumber?: number;
			actualSourcePath?: string;
			resolvesDomain?: string;
			/** The action the outcome's step requires, where it isn't the step's own name. */
			capability?: string;
		} = {},
	) {
		if (this.steps[outcome]) {
			const existing = this.steps[outcome];
			if (existing.source?.path === (actualSourcePath || proofPath) && existing.source?.lineNumber === lineNumber) {
				return;
			}
			throw new Error(
				`Outcome "${outcome}" is already registered. Each outcome can only be defined once. (Existing: ${existing.source?.path}:${existing.source?.lineNumber}, New: ${actualSourcePath || proofPath}:${lineNumber})`,
			);
		}

		// Gives each activity and proof line a source path where the line doesn't have one.
		const sourcePath = actualSourcePath || proofPath;
		const normalizedActivitySteps: TStepInput[] =
			activityBlockSteps?.map((s) => {
				return typeof s === "string" ? { in: s, source: { path: sourcePath } } : s;
			}) ?? [];

		const normalizedProofSteps: TStepInput[] = proofStatements.map((s) => ({ in: s, source: { path: sourcePath } }));

		this.registeredOutcomeMetadata.set(outcome, {
			proofStatements,
			proofPath,
			isBackground: isBackground ?? false,
			activityBlockSteps: normalizedActivitySteps,
			lineNumber,
			resolvesDomain,
		});

		if (isBackground) {
			this.backgroundOutcomePatterns.add(outcome);
		} else {
			this.featureOutcomePatterns.add(outcome);
			this.outcomeToFeaturePath.set(outcome, proofPath);
		}

		const step: TStepperStep = {
			// Each placeholder in the outcome pattern takes a waypoint argument.
			gwta: outcome.replace(/\{([^}:]+)\}/g, (_, name: string) => `{${name}: ${DOMAIN_WAYPOINT_ARGUMENT}}`),
			virtual: true,
			...(capability ? { capability } : {}),
			source: { lineNumber, path: actualSourcePath || proofPath },
			description: `Outcome: ${outcome}. Proof: ${proofStatements.join("; ")}`,
			action: async (args: TStepArgs, featureStep: TFeatureStep) => {
				const run = (steps: TStepInput[], intent: TFeatureStep["intent"]) =>
					this.runner.runStatements(steps, { args: args as Record<string, string>, intent, parentStep: featureStep });
				// An outcome whose proof already holds is reached.
				if (normalizedProofSteps.length > 0 && (await run(normalizedProofSteps, { mode: "speculative" })).ok) return OK;
				const ensuring = featureStep.intent?.stepperOptions?.isEnsure === true;
				if (normalizedActivitySteps.length === 0) {
					if (ensuring) return actionNotOK(`ActivitiesStepper: outcome "${outcome}" doesn't have an activity body to ensure it`);
					return proofStatements.length > 0 ? actionNotOK(`ActivitiesStepper: proof failed for outcome "${outcome}"`) : OK;
				}
				const intent = { mode: featureStep.intent?.mode ?? "authoritative", usage: featureStep.intent?.usage };
				const act = await run(normalizedActivitySteps, intent);
				if (!act.ok) return actionNotOK(`ActivitiesStepper: activity body failed for outcome "${outcome}": ${act.errorMessage}`);
				// `ensure` verifies the proof after the activity body runs.
				if (!ensuring || normalizedProofSteps.length === 0) return OK;
				const verify = await run(normalizedProofSteps, intent);
				return verify.ok ? OK : actionNotOK(`ActivitiesStepper: proof verification failed after activity body for outcome "${outcome}": ${verify.errorMessage}`);
			},
		};

		this.steps[outcome] = step;
		if (!isBackground) {
			if (!this.featureSteps.has(proofPath)) {
				this.featureSteps.set(proofPath, {});
			}
			const steps = this.featureSteps.get(proofPath);
			if (steps) {
				steps[outcome] = step;
			}
		} else {
			this.backgroundSteps[outcome] = step;
		}
	}

	getRegisteredOutcomes(): Record<string, TRegisteredOutcomeEntry> {
		const result: Record<string, TRegisteredOutcomeEntry> = {};
		for (const [outcome, metadata] of this.registeredOutcomeMetadata.entries()) {
			result[outcome] = {
				proofStatements: metadata.proofStatements,
				proofPath: metadata.proofPath,
				isBackground: metadata.isBackground,
				activityBlockSteps: metadata.activityBlockSteps?.map((s) => (typeof s === "string" ? s : s.in)),
			};
		}
		return result;
	}

	sendGraphLinkMessages(): void {
		for (const [outcome, metadata] of this.registeredOutcomeMetadata.entries()) {
			this.getWorld().eventLogger.emit(
				ControlEvent.parse({
					id: `graph-link-${outcome}`,
					timestamp: Date.now(),
					kind: "control",
					level: "debug",
					signal: "graph-link",
					args: {
						outcome,
						proofStatements: metadata.proofStatements,
						proofPath: metadata.proofPath,
						isBackground: metadata.isBackground,
						activityBlockSteps: metadata.activityBlockSteps ?? null,
						lineNumber: metadata.lineNumber,
					},
				}),
			);
		}
	}

	private resolveWaypointCommon(
		line: string,
		path: string,
		allLines: string[] | undefined,
		lineIndex: number | undefined,
		requireProof: boolean,
		actualSourcePath?: string,
	): boolean {
		if (!line.match(/^waypoint\s+/i)) {
			return false;
		}

		let outcome: string;
		let proofStatements: string[] = [];
		let resolvesDomain: string | undefined;

		// Declarative form: `waypoint Outcome resolves <domain-key>`
		const resolvesMatch = line.match(/^waypoint\s+(.+?)\s+resolves\s+(\S+)\s*$/i);
		if (resolvesMatch) {
			outcome = itemAt(resolvesMatch, 1).trim();
			resolvesDomain = itemAt(resolvesMatch, 2).trim();
		} else if (requireProof) {
			if (!line.match(/^waypoint\s+.+?\s+with\s+/i)) {
				return false;
			}
			const withoutPrefix = line.replace(/^waypoint\s+/i, "");
			const lastWithIndex = withoutPrefix.lastIndexOf(" with ");
			if (lastWithIndex === -1) return false;

			outcome = withoutPrefix.substring(0, lastWithIndex).trim();
			const proofRaw = withoutPrefix.substring(lastWithIndex + 6).trim();
			proofStatements = proofRaw
				.split("\n")
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
		} else {
			if (line.match(/^waypoint\s+.+?\s+with\s+/i)) {
				return false;
			}
			const match = line.match(/^waypoint\s+(.+?)$/i);
			if (!match) return false;
			outcome = itemAt(match, 1).trim();
		}

		if (this.backgroundOutcomePatterns.has(outcome) || this.featureOutcomePatterns.has(outcome)) {
			return true;
		}

		const isBackground = path.includes("backgrounds/");

		let activityBlockSteps: TStepInput[] | undefined;

		if (allLines && lineIndex !== undefined) {
			let activityStartLine = -1;
			for (let i = lineIndex - 1; i >= 0; i--) {
				const prevLine = getActionable(itemAt(allLines, i));
				if (prevLine.match(/^Activity:/i)) {
					activityStartLine = i;
					break;
				}
				if (prevLine.match(/^(Feature|Scenario|Background):/i)) {
					break;
				}
			}

			if (activityStartLine !== -1) {
				const blockLines: TStepInput[] = [];
				for (let i = activityStartLine + 1; i < lineIndex; i++) {
					const stepLine = getActionable(itemAt(allLines, i));
					if (stepLine && !stepLine.match(/^waypoint\s+/i)) {
						blockLines.push({ in: stepLine, source: { lineNumber: i + 1, path: actualSourcePath || path } });
					}
				}
				activityBlockSteps = blockLines;
			}
		}
		this.registerOutcome(outcome, proofStatements, path, {
			isBackground,
			activityBlockSteps,
			lineNumber: lineIndex !== undefined ? lineIndex + 1 : undefined,
			actualSourcePath,
			resolvesDomain,
		});
		return true;
	}
}

export default ActivitiesStepper;
