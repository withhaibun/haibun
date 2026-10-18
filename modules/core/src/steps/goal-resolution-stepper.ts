/**
 * GoalResolutionStepper exposes the goal resolver as steps.
 *
 *   resolve {goal: domain-key}                          → DOMAIN_GOAL_RESOLUTION
 *   show affordances                                    → DOMAIN_AFFORDANCES (forward edges + goal verdicts)
 *   show chain lint                                     → DOMAIN_CHAIN_LINT (orphan/unsupplied/unreachable findings + affordance overlay)
 *
 * The resolver only searches. It doesn't run a step. `pursue` and a walk run a resolved path. `pursue` runs every step
 * in order, so it only runs a path whose steps don't take a supplied value. `walk toward` begins a walk and stops before
 * its first step. `advance the walk` runs the next step with the values a caller supplies. `advanceChainInstance` in
 * lib/chain-walker.js implements each advance.
 *
 *   walk toward {goal: domain-key}                      → DOMAIN_CHAIN_WALK (begins a walk, stops before its first step)
 *   advance the walk {walk: walk-id} with {args: json}  → DOMAIN_CHAIN_WALK (runs the next step with what it takes)
 */
import { z } from "zod";
import { JsonObjectSchema } from "../lib/domains/json-text.js";
import {
	AStepper,
	type IHasCycles,
	type IStepperCycles,
	type TAfterStep,
	type TFeatureStep,
	type TAfterStepResult,
	type TStepperSteps,
	type IHasOptions,
	type TStepperOption,
} from "../lib/steps/domains/stepper.js";
import { actionNotOK, actionOKWithProducts, getStepperOption, stringOrError } from "../lib/domains/util.js";
import {
	DOMAIN_AFFORDANCES,
	DOMAIN_CHAIN_LINT,
	DOMAIN_CHAIN_WALK,
	DOMAIN_DOMAIN_KEY,
	DOMAIN_GOAL_RESOLUTION,
	DOMAIN_JSON_OBJECT,
	DOMAIN_STEP_PATH,
	DOMAIN_WALK_ID,
} from "../lib/domains/domains.js";
import { affordancesSchema, chainLintSchema, chainWalkSchema, goalResolutionSchema } from "../lib/core-domains.js";
import { createChainInstance, type TChainInstance } from "../lib/pipelines/chain-instance.js";
import { advanceChainInstance } from "../lib/pipelines/chain-walker.js";
import { buildDomainChain } from "../lib/domain-chain.js";
import { lintDomainChain } from "../lib/domain-chain-lint.js";
import { resolveGoal, GOAL_FINDING, type TGoalResolution, type TMichi, type TBinding } from "../lib/goal-resolver.js";
import { runRegistry, type StepRegistry } from "../lib/steps/pipelines/step-registry.js";
import { stepMethodName } from "../lib/steps/domains/step-method.js";
import { callStepByName, NO_INPUT } from "../lib/steps/pipelines/call-step.js";
import { buildAffordances, providesWaypoints, AFFORDANCE_EVENT_PREFIX, type TWaypointEntry, satisfiedGoalDomains } from "../lib/affordances.js";
import { readFacts } from "../lib/records/pipelines/facts.js";
import { executionOf, factIdOf } from "../lib/actuality/domains/seq-path.js";
import { callerHolds, RUN_AUTHORITY, stepInFlight } from "../lib/domains/capability-context.js";
import { Access } from "../lib/domains/resources.js";

const SMOKE_GOALS = "SMOKE_GOALS";
const COMPOSITE_DECOMPOSITION = "COMPOSITE_DECOMPOSITION";
const COMPOSITE_MAX_DEPTH = "COMPOSITE_MAX_DEPTH";

const COMPOSITE_DECOMPOSITION_DEFAULT = true;
const COMPOSITE_MAX_DEPTH_DEFAULT = 4;

// Product domains of steps that compute a view of current memory: affordances, goal resolution and chain lint. Such a
// step doesn't change a record itself, so afterStep doesn't emit an `affordances.*` change signal for it. A step that
// `pursue` runs emits its own signal.
const PROJECTION_DOMAINS = new Set([DOMAIN_AFFORDANCES, DOMAIN_GOAL_RESOLUTION, DOMAIN_CHAIN_LINT]);

export class GoalResolutionStepper extends AStepper implements IHasOptions, IHasCycles {
	description = "Backward-chaining goal resolver and plan runner";

	options: Record<string, TStepperOption> = {
		[SMOKE_GOALS]: { desc: "Comma-separated list of domain keys to resolve at boot as a drift-detection signal", parse: (input: string) => stringOrError(input) },
		[COMPOSITE_DECOMPOSITION]: {
			desc: `Recurse into composite input domains via topology.ranges when resolving goals (haibun equivalent of sh:node/rdfs:range). "true" / "false". Default ${COMPOSITE_DECOMPOSITION_DEFAULT}.`,
			parse: (input: string) => stringOrError(input),
		},
		[COMPOSITE_MAX_DEPTH]: {
			desc: `Cap on composite recursion depth, independent of the producer-chain depth limit. Default ${COMPOSITE_MAX_DEPTH_DEFAULT}.`,
			parse: (input: string) => stringOrError(input),
		},
	};

	private steppers: AStepper[] = [];

	override async setWorld(world: import("../lib/actuality/domains/world.js").TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
	}

	cycles: IStepperCycles = {
		startExecution: async () => {
			// Resolves each declared smoke goal and emits its verdict, for comparison against a later run's verdict.
			const world = this.getWorld();
			const smokeRaw = getStepperOption(this, SMOKE_GOALS, world.moduleOptions);
			if (smokeRaw) {
				const graph = buildDomainChain(this.steppers, world.domains);
				const goals = smokeRaw
					.split(",")
					.map((s: string) => s.trim())
					.filter((s: string) => s.length > 0);
				const facts = await readFacts(world.shared.getStore());
				const smokeFindings = goals.map((goal: string) => {
					// Actuality makes this check with RUN_AUTHORITY, so the check reaches every step actuality offers.
					const resolution = resolveGoal(goal, { graph, facts, held: RUN_AUTHORITY, ...this.compositeOptions() });
					return { goal, finding: resolution.finding };
				});
				world.eventLogger.emit({
					id: "domain-chain.smoke.startup",
					timestamp: Date.now(),
					source: "haibun",
					kind: "artifact",
					artifactType: "json",
					mimetype: "application/json",
					level: "info",
					json: { domainChainSmoke: { goals: smokeFindings } },
				});
			}
		},
		afterStep: (after: TAfterStep): Promise<TAfterStepResult> => {
			// Emits only a change signal. The affordances snapshot is large (forward edges, goals, their resolution trees
			// and composite michi), so the event log doesn't carry it on every step. The affordances panel and the
			// domain-chain view re-fetch the current snapshot with `affordances on offer`.
			// A read and a step that only computes a view of memory don't change a record, so afterStep doesn't emit a signal for them.
			// The panel's re-fetch is a read, so a signal for it would trigger the re-fetch again over SSE without bound.
			const step = after.featureStep.action.step;
			if (step.read === true || PROJECTION_DOMAINS.has(step.productsDomain ?? "")) return Promise.resolve({});
			const seqPath = stepInFlight()?.seqPath;
			if (!seqPath) throw new Error("GoalResolutionStepper.afterStep: a step isn't in flight. dispatchStep runs afterStep cycles inside the step.");
			this.getWorld().eventLogger.emit({
				id: `${AFFORDANCE_EVENT_PREFIX}${seqPath}`,
				timestamp: Date.now(),
				source: "haibun",
				kind: "artifact",
				artifactType: "json",
				mimetype: "application/json",
				level: "debug",
				json: { affordancesChanged: true },
			});
			return Promise.resolve({});
		},
	};

	/**
	 * Returns the composite-decomposition resolver options from the stepper options. Decomposition defaults to enabled,
	 * and a missing or invalid depth defaults to COMPOSITE_MAX_DEPTH_DEFAULT. startExecution's smoke-goal check and
	 * runResolution pass these options to resolveGoal. computeAffordances passes them to buildAffordances.
	 */
	private compositeOptions(): { domains: import("../lib/actuality/domains/world.js").TWorld["domains"]; compositeDecomposition: boolean; compositeMaxDepth: number } {
		const world = this.getWorld();
		const decompositionRaw = getStepperOption(this, COMPOSITE_DECOMPOSITION, world.moduleOptions);
		const compositeDecomposition = decompositionRaw === undefined ? COMPOSITE_DECOMPOSITION_DEFAULT : decompositionRaw !== "false";
		const depthRaw = getStepperOption(this, COMPOSITE_MAX_DEPTH, world.moduleOptions);
		const parsed = depthRaw === undefined ? Number.NaN : Number(depthRaw);
		const compositeMaxDepth = Number.isInteger(parsed) && parsed > 0 ? parsed : COMPOSITE_MAX_DEPTH_DEFAULT;
		return { domains: world.domains, compositeDecomposition, compositeMaxDepth };
	}

	private async runResolution(goal: string): Promise<TGoalResolution> {
		const world = this.getWorld();
		const graph = buildDomainChain(this.steppers, world.domains);
		const facts = await readFacts(world.shared.getStore());
		return resolveGoal(goal, { graph, facts, held: callerHolds(), ...this.compositeOptions() });
	}

	/** Runs a michi's steps in order. callStepByName calls each step with a synthetic seqPath, as other transports call steps.
	 *  Returns the id of each call's fact. The first step that fails stops the michi, and its error is returned. */
	private async executeMichi(goal: string, michi: TMichi): Promise<ReturnType<typeof actionOKWithProducts> | ReturnType<typeof actionNotOK>> {
		const world = this.getWorld();
		const registry = runRegistry(world);
		const factIds: string[] = [];
		for (const [i, step] of michi.steps.entries()) {
			const method = stepMethodName(step.stepperName, step.stepName);
			const call = await callStepByName({ registry, world, steppers: this.steppers }, method, NO_INPUT);
			if (!call.result.ok) return actionNotOK(`pursue ${goal}: step ${i} (${method}) failed: ${call.result.errorMessage}`);
			factIds.push(factIdOf({ execution: executionOf(world.tag), path: call.seqPath }));
		}
		return actionOKWithProducts({ finding: "executed", goal, factIds });
	}

	/**
	 * Builds the affordances for the live and as-of steps. The projection excludes facts asserted after `asOf` where a step
	 * gives `asOf`, so the panel shows actuality's state at that step.
	 *
	 * Each registered stepper with the ProvidesWaypoints capability adds its waypoint entries to the same snapshot. Waypoint
	 * ensure-state holds only actuality's current state, so an as-of projection doesn't carry waypoint entries.
	 */
	private async computeAffordances(asOf: number[] | undefined, featureStep: TFeatureStep) {
		const world = this.getWorld();
		const facts = await readFacts(world.shared.getStore());
		const composite = this.compositeOptions();
		const affordances = buildAffordances({
			steppers: this.steppers,
			domains: world.domains,
			facts,
			held: callerHolds(),
			compositeDecomposition: composite.compositeDecomposition,
			compositeMaxDepth: composite.compositeMaxDepth,
			asOfSeqPath: asOf,
		});
		const waypoints: TWaypointEntry[] = [];
		if (!asOf) {
			const satisfied = satisfiedGoalDomains(affordances.goals, GOAL_FINDING.SATISFIED);
			for (const stepper of this.steppers) if (providesWaypoints(stepper)) waypoints.push(...(await stepper.waypointEntries(featureStep, satisfied)));
		}
		return actionOKWithProducts(affordancesSchema.parse({ ...affordances, waypoints, execution: executionOf(world.tag) }));
	}

	steps = {
		resolve: {
			gwta: `resolve {goal: ${DOMAIN_DOMAIN_KEY}}`,
			productsDomain: DOMAIN_GOAL_RESOLUTION,
			action: async ({ goal }: { goal: string }) => {
				const resolution = await this.runResolution(goal);
				return actionOKWithProducts(goalResolutionSchema.parse(resolution));
			},
		},

		/**
		 * A1 · `pursue {goal}` resolves a goal and runs the first path toward it. Pursuing a satisfied goal doesn't run a step.
		 *
		 *  satisfied   → doesn't run a step; returns the resolution with the satisfying factIds (as `ensure` skips a proven waypoint)
		 *  michi (fact-only bindings) → runs each step of the first michi in order; returns the produced factIds
		 *  michi with `kind: "argument"` bindings → refuses and names the domains to supply (`walk toward` takes their values one step at a time)
		 *  unreachable → refuses with the list of missing producers
		 *  refused     → refuses with the resolver's reason
		 *
		 *  The step follows the activities pattern: check the world, act only where needed, and state what is missing when a step can't run. An agent reading affordances follows the same primitives.
		 */
		pursue: {
			gwta: `pursue {goal: ${DOMAIN_DOMAIN_KEY}}`,
			productsDomain: DOMAIN_GOAL_RESOLUTION,
			action: async ({ goal }: { goal: string }) => {
				const resolution = await this.runResolution(goal);
				if (resolution.finding === GOAL_FINDING.SATISFIED) {
					return actionOKWithProducts(goalResolutionSchema.parse(resolution));
				}
				const michi = firstPathToward("pursue", resolution);
				const argBindings = collectArgumentBindings(michi.bindings);
				if (argBindings.length > 0) {
					return actionNotOK(
						`pursue ${goal}: ${argBindings.length} argument binding(s) need a supplied value, in domains ${argBindings.join(", ")}. Supply them one step at a time with "walk toward", or start the path from the affordances panel.`,
					);
				}
				return await this.executeMichi(goal, michi);
			},
		},

		/**
		 * Begins a walk toward a goal. The step resolves the goal, records the first path as a walk and stops before its
		 * first step. `pursue` runs every step of a path in order, so it only runs a path whose steps don't take a supplied
		 * value. A walk runs a path whose steps take values from a caller, one step at a time, and records what each step
		 * produced. The walk records the acting principal as its owner where a principal acts.
		 */
		walkToward: {
			gwta: `walk toward {goal: ${DOMAIN_DOMAIN_KEY}}`,
			productsDomain: DOMAIN_CHAIN_WALK,
			action: async ({ goal }: { goal: string }) => {
				const resolution = await this.runResolution(goal);
				if (resolution.finding === GOAL_FINDING.SATISFIED) return actionNotOK(`walk toward ${goal}: already satisfied, so it doesn't need a path`);
				const michi = firstPathToward("walk toward", resolution);
				const world = this.getWorld();
				const instance = await createChainInstance(world, goal, michi);
				return actionOKWithProducts(walkProducts(instance, runRegistry(world)));
			},
		},

		/**
		 * Runs the walk's next step with the given arguments. Only the walk's owner may advance it, since the arguments a
		 * step takes are the owner's.
		 */
		advanceWalk: {
			gwta: `advance the walk {walk: ${DOMAIN_WALK_ID}} with {args: ${DOMAIN_JSON_OBJECT}}`,
			productsDomain: DOMAIN_CHAIN_WALK,
			action: async ({ walk, args }: { walk: string; args: z.infer<typeof JsonObjectSchema> }) => {
				const world = this.getWorld();
				const ctx = { registry: runRegistry(world), world, steppers: this.steppers };
				const advanced = await advanceChainInstance(ctx, walk, args);
				if (advanced.kind === "failed") return actionNotOK(`advance the walk ${walk}: ${advanced.error}`);
				return actionOKWithProducts(walkProducts(advanced.instance, ctx.registry));
			},
		},

		showAffordances: { gwta: "show affordances", productsDomain: DOMAIN_AFFORDANCES, action: async (_args, featureStep) => this.computeAffordances(undefined, featureStep) },

		showAffordancesAsOf: {
			gwta: `show affordances as of {asOf: ${DOMAIN_STEP_PATH}}`,
			productsDomain: DOMAIN_AFFORDANCES,
			action: ({ asOf }: { asOf: number[] }, featureStep) => this.computeAffordances(asOf, featureStep),
		},

		// Returns the snapshot `show affordances` returns, as a read. A page that shows the panel requests it after every
		// step. `show affordances` is an act of actuality, and actuality records it. A read of the affordances on offer
		// isn't shown or recorded.
		affordancesOnOffer: {
			gwta: "affordances on offer",
			read: true,
			readsAt: Access.public,
			productsDomain: DOMAIN_AFFORDANCES,
			action: async (_args, featureStep) => this.computeAffordances(undefined, featureStep),
		},

		affordancesOnOfferAsOf: {
			gwta: `affordances on offer as of {asOf: ${DOMAIN_STEP_PATH}}`,
			read: true,
			readsAt: Access.public,
			productsDomain: DOMAIN_AFFORDANCES,
			action: ({ asOf }: { asOf: number[] }, featureStep) => this.computeAffordances(asOf, featureStep),
		},

		showDomainChainLint: {
			gwta: "show chain lint",
			productsDomain: DOMAIN_CHAIN_LINT,
			action: async () => {
				const world = this.getWorld();
				const graph = buildDomainChain(this.steppers, world.domains);
				const report = lintDomainChain(graph, world.domains);
				// The bound view (`shu-domain-chain-view`) draws the chain from the affordance snapshot the product carries (forward edges,
				// goal verdicts, the satisfied domains and their facts), with the lint findings that mark orphan, unsupplied and unreachable nodes.
				const facts = await readFacts(world.shared.getStore());
				const affordances = buildAffordances({ steppers: this.steppers, domains: world.domains, facts, held: callerHolds() });
				return actionOKWithProducts(chainLintSchema.parse({ ...report, ...affordances, execution: executionOf(world.tag) }));
			},
		},
	} as const satisfies TStepperSteps;
}

export default GoalResolutionStepper;

/** Returns the resolver's first path toward a goal that isn't satisfied. Throws for an unreachable or a refused goal, with
 *  `doing` and the reason in the error. */
function firstPathToward(doing: string, resolution: Exclude<TGoalResolution, { finding: typeof GOAL_FINDING.SATISFIED }>): TMichi {
	if (resolution.finding === GOAL_FINDING.UNREACHABLE) throw new Error(`${doing} ${resolution.goal}: unreachable (missing producers: ${resolution.missing.join(", ")})`);
	if (resolution.finding === GOAL_FINDING.REFUSED) throw new Error(`${doing} ${resolution.goal}: refused (${resolution.refusalReason}: ${resolution.detail})`);
	return resolution.michi[0];
}

/** Returns a walk's products: its id, goal, status, step index and steps, the step that runs next, the parameters that
 *  step takes and the produced factIds. The parameters are read from the step's declaration, since an advance supplies
 *  them. */
function walkProducts(instance: TChainInstance, registry: StepRegistry): z.infer<typeof chainWalkSchema> {
	const steps = instance.michi.steps.map((step) => stepMethodName(step.stepperName, step.stepName));
	const next = steps[instance.stepIndex];
	const takes = next === undefined ? [] : [...(registry.get(next)?.paramDomainKeys.keys() ?? [])];
	return chainWalkSchema.parse({
		walk: instance.id,
		goal: instance.goal,
		status: instance.status,
		stepIndex: instance.stepIndex,
		steps,
		...(next === undefined ? {} : { next }),
		needs: takes,
		factIds: instance.stepFactIds.flat(),
	});
}

/**
 * Returns the domains of a michi's argument bindings, including those nested in composite fields. `pursue` refuses
 * with this list when a step takes a value that a fact doesn't supply.
 */
function collectArgumentBindings(bindings: TBinding[]): string[] {
	const out: string[] = [];
	const visit = (b: TBinding | { kind: string; domain?: string; fields?: unknown[] }): void => {
		if ((b as TBinding).kind === "argument") out.push((b as TBinding).domain ?? "(unknown)");
		else if ((b as TBinding).kind === "composite") {
			for (const f of (b as { kind: "composite"; fields: TBinding[] }).fields ?? []) visit(f);
		}
	};
	for (const b of bindings) visit(b);
	return out;
}
