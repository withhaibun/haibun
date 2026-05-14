import { z } from "zod";
import { AStepper, IHasCycles, TStepperSteps, TFeatureStep, IStepperCycles, TStepperStep, CycleWhen } from "../lib/astepper.js";
import type { TFeatures, TStepInput } from "../lib/execution.js";
import type { TWorld } from "../lib/world.js";
import { TStepArgs, TRegisteredOutcomeEntry, OK } from "../schema/protocol.js";
import { actionOK, actionNotOK, actionOKWithProducts, getActionable, formatCurrentSeqPath, errorDetail } from "../lib/util/index.js";
import { DOMAIN_STATEMENT } from "../lib/domains.js";
import { FlowRunner } from "../lib/core/flow-runner.js";
import { ControlEvent, LifecycleEvent } from "../schema/protocol.js";
import { buildDomainChain } from "../lib/domain-chain.js";
import { GOAL_FINDING, resolveGoal } from "../lib/goal-resolver.js";
import { FACT_GRAPH } from "../lib/working-memory.js";
import { stepMethodName } from "../lib/step-dispatch.js";
import { buildAffordances, WAYPOINT_KIND, type TWaypointEntry, type TWaypointKind } from "../lib/affordances.js";
import { DOMAIN_AFFORDANCES } from "../lib/domains.js";
import { namedInterpolation } from "../lib/namedVars.js";

const ActivityOutcomeSchema = z.object({ proofStatements: z.array(z.string()) });

// need this type because some steps are dynamically generated (e.g. waypoints)
type TActivitiesFixedSteps = {
	activity: TStepperStep;
	waypointWithProof: TStepperStep;
	waypointLabel: TStepperStep;
	ensure: TStepperStep;
	showWaypoints: TStepperStep;
};

type TActivitiesStepperSteps = TStepperSteps & TActivitiesFixedSteps;

/**
 * Stepper that dynamically builds virtual steps from `waypoint` statements.
 * implements this logic: P ∨ (¬P ∧ [A]P)
 */
export class ActivitiesStepper extends AStepper implements IHasCycles {
	description = "Define and reuse activities with waypoints and proofs";

	private runner: FlowRunner;
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
			// Always reload background steps
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
	cyclesWhen = {
		startExecution: CycleWhen.FIRST,
		startFeature: CycleWhen.FIRST,
	};

	/**
	 * Called during resolution phase to clear feature-scoped steps.
	 * This prevents activity patterns from leaking between features during resolution.
	 */
	startFeatureResolution(path: string): void {
		this.inActivityBlock = false;
		// Clear steps from previous feature (resolution phase)
		if (this.lastResolutionPath && this.lastResolutionPath !== path) {
			const previousSteps = this.featureSteps.get(this.lastResolutionPath);
			if (previousSteps) {
				for (const outcome of Object.keys(previousSteps)) {
					delete this.steps[outcome];
				}
			}
		}

		// Reload current feature's steps if already registered
		const currentSteps = this.featureSteps.get(path);
		if (currentSteps) {
			for (const [outcome, step] of Object.entries(currentSteps)) {
				this.steps[outcome] = step;
			}
		}

		// Always reload background steps
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
		activity: {
			gwta: "Activity: {activity}",
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
						// Use actualSourcePath for VSCode linking, path for registration
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
			gwta: `waypoint {outcome} with {proof:${DOMAIN_STATEMENT}}`,
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

		waypointLabel: {
			gwta: `waypoint {outcome}`,
			action: async () => actionOK(),
		},

		ensure: {
			description:
				"Ensure a waypoint condition by always running the proof. If proof passes, waypoint is already satisfied. If proof fails, run the full activity, then try the proof again",
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

				// Emit ensure start for monitors
				this.getWorld().eventLogger.emit(
					LifecycleEvent.parse({
						id: formatCurrentSeqPath(featureStep.seqPath) + ".ensure",
						timestamp: Date.now(),
						kind: "lifecycle",
						type: "ensure",
						stage: "start",
						in: outcomeKey,
						lineNumber: featureStep.source.lineNumber,
						featurePath: featureStep.source.path,
						status: "running",
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
					this.emitEnsureEnd(featureStep, outcomeKey, false, "no metadata for waypoint");
					return actionNotOK(`ensure: waypoint "${outcomeKey}" has no metadata.`);
				}

				if (metadata.resolvesDomain) {
					// P ∨ (¬P ∧ [A]P) for declarative goals:
					//   1. Already satisfied? skip activity.
					//   2. Otherwise run the imperative activity (which provides parameter
					//      bindings the goal-resolver itself can't infer); the activity's
					//      step(s) auto-assert their outputDomain product as a fact.
					//   3. Re-check the goal.
					const initial = await this.checkDeclarativeGoal(metadata.resolvesDomain);
					if (initial.refused) {
						// Resolver refused (e.g. anonymous outputs present). Fall through to
						// imperative proof if one was also declared, otherwise bail.
					} else if (initial.satisfied) {
						this.emitEnsureEnd(featureStep, outcomeKey, true);
						this.ensureAttempts.delete(attemptKey);
						return actionOK();
					} else if (metadata.activityBlockSteps && metadata.activityBlockSteps.length > 0) {
						// Run the activity body imperatively.
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
						return actionNotOK(`ensure: waypoint "${outcomeKey}" — activity ran but goal "${metadata.resolvesDomain}" was not asserted as a fact.`);
					} else {
						// No imperative activity body. Try running the resolver's plan as a
						// fallback (with the limitations on parameter binding noted in the
						// resolver — this works for parameterless producers).
						const planOutcome = await this.runDeclarativeEnsure(metadata.resolvesDomain, featureStep);
						this.emitEnsureEnd(featureStep, outcomeKey, planOutcome.ok, planOutcome.errorMessage);
						this.ensureAttempts.delete(attemptKey);
						return planOutcome.ok ? actionOK() : actionNotOK(`ensure: waypoint "${outcomeKey}" goal resolution failed: ${planOutcome.errorMessage}`);
					}
				}

				if (metadata.proofStatements.length === 0) {
					this.emitEnsureEnd(featureStep, outcomeKey, false, "no proof defined");
					return actionNotOK(`ensure: waypoint "${outcomeKey}" has no proof. ensure can only be used with waypoints that have a proof.`);
				}

				const activityArgs: Record<string, string> = {};
				for (const step of outcome) {
					if (step.action.stepValuesMap) {
						for (const [key, val] of Object.entries(step.action.stepValuesMap)) {
							const value = val.value !== undefined ? String(val.value) : val.term;
							if (value !== undefined) {
								activityArgs[key] = value;
							}
						}
					}
				}

				let proofStatements: string[] | undefined;

				try {
					const flowResult = await this.runner.runSteps(outcome, {
						intent: { mode: "authoritative", usage: featureStep.intent?.usage, stepperOptions: { isEnsure: true } },
						parentStep: featureStep,
					});

					if (!flowResult.ok) {
						this.emitEnsureEnd(featureStep, outcomeKey, false, flowResult.errorMessage);
						return actionNotOK(`ensure: waypoint "${outcomeKey}" proof failed: ${flowResult.errorMessage}`);
					}

					proofStatements = (flowResult.products as Record<string, unknown>)?.proofStatements as string[] | undefined;

					if (!proofStatements) {
						this.emitEnsureEnd(featureStep, outcomeKey, false, "no proofStatements returned");
						return actionNotOK(`ensure: waypoint "${outcomeKey}" succeeded but returned no proofStatements`);
					}
				} catch (err) {
					const msg = errorDetail(err);
					this.emitEnsureEnd(featureStep, outcomeKey, false, msg);
					return actionNotOK(`ensure: waypoint "${outcomeKey}" proof execution error: ${msg}`);
				}

				this.ensuredInstances.set(outcomeKey, { proof: proofStatements, valid: true });
				this.ensureAttempts.delete(attemptKey);

				this.emitEnsureEnd(featureStep, outcomeKey, true);
				return actionOK();
			},
		},
		showWaypoints: {
			gwta: "show waypoints",
			productsDomain: DOMAIN_AFFORDANCES,
			action: async (_args, featureStep: TFeatureStep) => {
				const world = this.getWorld();
				const steppers = (world.runtime.steppers as AStepper[]) ?? [];
				const facts = await world.shared.getStore().query({ namedGraph: FACT_GRAPH });
				// `compositeDecomposition: true` matches GoalResolutionStepper's default; without it
				// composite-input goals (issuer-vertex inside issueCredential, …) get filtered as
				// trivial when no fact exists yet, leaving the panel with empty goals[].
				const affordances = buildAffordances({ steppers, domains: world.domains, facts, capabilities: new Set(), compositeDecomposition: true });
				const satisfiedDomains = new Set(affordances.goals.filter((g) => g.resolution.finding === GOAL_FINDING.SATISFIED).map((g) => g.domain));

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
						// Only verify imperative proofs that have actually been ensured. A speculative
						// re-run for waypoints that never executed has no variable bindings in scope,
						// produces cryptic "<term> is not set" errors, and tells the user nothing useful.
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

				return actionOKWithProducts({ forward: affordances.forward, goals: affordances.goals, composites: affordances.composites, satisfiedDomains: affordances.satisfiedDomains, satisfiedFacts: affordances.satisfiedFacts, waypoints });
			},
		},
	} as const satisfies TActivitiesFixedSteps;

	readonly typedSteps = this.baseSteps;

	steps: TActivitiesStepperSteps = { ...this.baseSteps };

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.runner = new FlowRunner(world, steppers);
	}

	/**
	 * Check whether the declarative goal is already satisfied in working memory.
	 * Returns satisfied=true if a fact of the goal domain exists. The resolver's
	 * `refused` finding is surfaced too so the caller can decide to fall through.
	 */
	private async checkDeclarativeGoal(domainKey: string): Promise<{ satisfied: boolean; refused?: string }> {
		const world = this.getWorld();
		if (!world.runtime.steppers) {
			throw new Error("ActivitiesStepper: world.runtime.steppers is unset. Executor.executeFeatures must set it before cycles run.");
		}
		const steppers = world.runtime.steppers as AStepper[];
		const graph = buildDomainChain(steppers, world.domains);
		const facts = await world.shared.getStore().query({ namedGraph: FACT_GRAPH });
		const resolution = resolveGoal(domainKey, { graph, facts, capabilities: new Set() });
		if (resolution.finding === GOAL_FINDING.SATISFIED) return { satisfied: true };
		if (resolution.finding === GOAL_FINDING.REFUSED) return { satisfied: false, refused: `${resolution.refusalReason}: ${resolution.detail}` };
		return { satisfied: false };
	}

	/**
	 * Run a declarative-ensure via the goal resolver: invoke the resolver, and if it
	 * returns a plan, dispatch each plan step. Used only when no imperative activity
	 * body exists for the waypoint. Limited utility — plan steps run with empty
	 * stepValuesMap (no parameter binding from facts to step args). Useful for
	 * parameterless producers; for parameterized ones, declare an imperative activity.
	 */
	private async runDeclarativeEnsure(domainKey: string, featureStep: TFeatureStep): Promise<{ handled: boolean; ok: boolean; errorMessage?: string }> {
		const world = this.getWorld();
		if (!world.runtime.steppers) {
			throw new Error("ActivitiesStepper: world.runtime.steppers is unset. Executor.executeFeatures must set it before cycles run.");
		}
		const steppers = world.runtime.steppers as AStepper[];
		const graph = buildDomainChain(steppers, world.domains);
		const facts = await world.shared.getStore().query({ namedGraph: FACT_GRAPH });
		const capabilities = new Set<string>();
		const resolution = resolveGoal(domainKey, { graph, facts, capabilities });

		if (resolution.finding === GOAL_FINDING.SATISFIED) return { handled: true, ok: true };
		if (resolution.finding === GOAL_FINDING.REFUSED) return { handled: false, ok: false, errorMessage: `goal-${resolution.refusalReason}: ${resolution.detail}` };
		if (resolution.finding === GOAL_FINDING.UNREACHABLE) {
			return { handled: true, ok: false, errorMessage: `goal-unreachable: ${domainKey} (missing: ${resolution.missing.join(", ")})` };
		}

		// The resolver returns multiple michi (paths). The declarative waypoint always runs
		// the first; choice-driven flows go through the chain-walker (advanceChainInstance),
		// which steps one michi forward at a time so the SPA can collect per-step input.
		const registry = world.runtime.stepRegistry;
		if (!registry) return { handled: true, ok: false, errorMessage: "no step registry available" };
		const firstMichi = resolution.michi[0];
		if (!firstMichi) return { handled: true, ok: false, errorMessage: `goal-unreachable: ${domainKey} (no michi returned)` };
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
				id: formatCurrentSeqPath(featureStep.seqPath) + ".ensure",
				timestamp: Date.now(),
				kind: "lifecycle",
				type: "ensure",
				stage: "end",
				in: outcomeKey,
				lineNumber: featureStep.source.lineNumber,
				featurePath: featureStep.source.path,
				status: ok ? "completed" : "failed",
				error,
			}),
		);
	}

	registerOutcome(
		outcome: string,
		proofStatements: string[],
		proofPath: string,
		isBackground?: boolean,
		activityBlockSteps?: (string | TStepInput)[],
		lineNumber?: number,
		actualSourcePath?: string,
		resolvesDomain?: string,
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

		// Normalize activity steps and proofs to ensure they carry source location
		const sourcePath = actualSourcePath || proofPath;
		const normalizedActivitySteps: TStepInput[] =
			activityBlockSteps?.map((s) => {
				return typeof s === "string" ? { in: s, source: { path: sourcePath } } : s;
			}) ?? [];

		const normalizedProofSteps: TStepInput[] = proofStatements.map((s) => ({
			in: s,
			source: { path: sourcePath },
		}));

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
			gwta: outcome,
			virtual: true,
			handlesUndefined: true,
			source: {
				lineNumber,
				path: actualSourcePath || proofPath,
			},
			description: `Outcome: ${outcome}. Proof: ${proofStatements.join("; ")}`,
			productsSchema: ActivityOutcomeSchema,
			action: async (args: TStepArgs, featureStep: TFeatureStep) => {
				const robustArgs: Record<string, string> = { ...(args as Record<string, string>) };
				if (featureStep.action.stepValuesMap) {
					for (const [key, val] of Object.entries(featureStep.action.stepValuesMap)) {
						if (robustArgs[key] === undefined && val.term !== undefined) {
							robustArgs[key] = val.term;
						}
					}
				}

				// 1. Check Proof (Speculative)
				if (normalizedProofSteps.length > 0) {
					const proof = await this.runner.runStatements(normalizedProofSteps, {
						args: robustArgs,
						intent: { mode: "speculative" },
						parentStep: featureStep,
					});

					if (proof.ok) {
						return actionOKWithProducts({ proofStatements });
					}
				}

				// 2. Proof Failed or not present
				if (!featureStep.intent?.stepperOptions?.isEnsure) {
					if (normalizedActivitySteps && normalizedActivitySteps.length > 0) {
						const mode = featureStep.intent?.mode === "speculative" ? "speculative" : "authoritative";
						const act = await this.runner.runStatements(normalizedActivitySteps, {
							args: robustArgs,
							intent: { mode, usage: featureStep.intent?.usage },
							parentStep: featureStep,
						});
						if (!act.ok) {
							return actionNotOK(`ActivitiesStepper: activity body failed for outcome "${outcome}": ${act.errorMessage}`);
						}
						return actionOKWithProducts({ proofStatements });
					}

					if (proofStatements.length > 0) {
						return actionNotOK(`ActivitiesStepper: proof failed for outcome "${outcome}"`);
					}
					return actionOKWithProducts({ proofStatements });
				}

				// 3. Ensure Mode: Run Activity Body
				if (normalizedActivitySteps && normalizedActivitySteps.length > 0) {
					const mode = featureStep.intent?.mode === "speculative" ? "speculative" : "authoritative";
					const act = await this.runner.runStatements(normalizedActivitySteps, {
						args: robustArgs,
						intent: { mode, usage: featureStep.intent?.usage },
						parentStep: featureStep,
					});
					if (!act.ok) {
						return actionNotOK(`ActivitiesStepper: activity body failed for outcome "${outcome}": ${act.errorMessage}`);
					}

					// 4. Verify Proof After Activity
					if (normalizedProofSteps.length > 0) {
						const verify = await this.runner.runStatements(normalizedProofSteps, {
							args: robustArgs,
							intent: { mode, usage: featureStep.intent?.usage },
							parentStep: featureStep,
						});
						if (!verify.ok) {
							return actionNotOK(`ActivitiesStepper: proof verification failed after activity body for outcome "${outcome}": ${verify.errorMessage}`);
						}
					}
					return actionOKWithProducts({ proofStatements });
				}

				return actionNotOK(`ActivitiesStepper: no activity body for outcome "${outcome}"`);
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
			outcome = resolvesMatch[1].trim();
			resolvesDomain = resolvesMatch[2].trim();
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
			outcome = match[1].trim();
		}

		if (this.backgroundOutcomePatterns.has(outcome) || this.featureOutcomePatterns.has(outcome)) {
			return true;
		}

		const isBackground = path.includes("backgrounds/");

		let activityBlockSteps: TStepInput[] | undefined;

		if (allLines && lineIndex !== undefined) {
			let activityStartLine = -1;
			for (let i = lineIndex - 1; i >= 0; i--) {
				const prevLine = getActionable(allLines[i]);
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
					const stepLine = getActionable(allLines[i]);
					if (stepLine && !stepLine.match(/^waypoint\s+/i)) {
						blockLines.push({
							in: stepLine,
							source: {
								lineNumber: i + 1,
								path: actualSourcePath || path,
							},
						});
					}
				}
				activityBlockSteps = blockLines;
			}
		}
		this.registerOutcome(outcome, proofStatements, path, isBackground, activityBlockSteps, lineIndex !== undefined ? lineIndex + 1 : undefined, actualSourcePath, resolvesDomain);
		return true;
	}
}

export default ActivitiesStepper;
