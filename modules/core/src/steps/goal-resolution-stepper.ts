/**
 * GoalResolutionStepper: exposes the goal resolver as steps.
 *
 *   resolve {goal: domain-key}                          → DOMAIN_GOAL_RESOLUTION
 *   show affordances                                    → DOMAIN_AFFORDANCES (forward edges + goal verdicts)
 *   show chain lint                                     → DOMAIN_CHAIN_LINT (orphan/unsupplied/unreachable findings + affordance overlay)
 *
 * The resolver is pure search; it never auto-runs anything. A resolved path gets run in one of two ways: `pursue`
 * runs it straight through, which it can only do where the steps don't need a supplied value, and `walk toward` holds it
 * open one step at a time so what each step takes can be given to it, which is what the chain-walker
 * (`advanceChainInstance` in lib/chain-walker.js) does.
 *
 *   walk toward {goal: domain-key}                      → DOMAIN_CHAIN_WALK (begins a walk, stops before its first step)
 *   advance the walk {walk: walk-id} with {args: json}  → DOMAIN_CHAIN_WALK (runs the next step with what it takes)
 */
import { z } from "zod";
import { JsonObjectSchema } from "../lib/json-text.js";
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
} from "../lib/astepper.js";
import { actionNotOK, actionOKWithProducts, getStepperOption, stringOrError } from "../lib/util/index.js";
import {
	DOMAIN_AFFORDANCES,
	DOMAIN_CHAIN_LINT,
	DOMAIN_CHAIN_WALK,
	DOMAIN_DOMAIN_KEY,
	DOMAIN_GOAL_RESOLUTION,
	DOMAIN_JSON_OBJECT,
	DOMAIN_STEP_PATH,
	DOMAIN_WALK_ID,
} from "../lib/domains.js";
import { affordancesSchema, chainLintSchema, chainWalkSchema, goalResolutionSchema } from "../lib/core-domains.js";
import { createChainInstance, type TChainInstance } from "../lib/chain-instance.js";
import { advanceChainInstance } from "../lib/chain-walker.js";
import { buildDomainChain } from "../lib/domain-chain.js";
import { lintDomainChain } from "../lib/domain-chain-lint.js";
import { resolveGoal, GOAL_FINDING, type TGoalResolution, type TMichi, type TBinding } from "../lib/goal-resolver.js";
import { runRegistry, stepMethodName, type StepRegistry } from "../lib/step-registry.js";
import { callStepByName } from "../lib/call-step.js";
import { buildAffordances, providesWaypoints, AFFORDANCE_EVENT_PREFIX, type TWaypointEntry, satisfiedGoalDomains } from "../lib/affordances.js";
import { FACT_GRAPH } from "../lib/working-memory.js";
import { executionOf } from "../lib/seq-path.js";
import { authorizedWith, RUN_AUTHORITY, stepInFlight } from "../lib/capability-context.js";
import { Access } from "../lib/resources.js";

const SMOKE_GOALS = "SMOKE_GOALS";
const COMPOSITE_DECOMPOSITION = "COMPOSITE_DECOMPOSITION";
const COMPOSITE_MAX_DEPTH = "COMPOSITE_MAX_DEPTH";

const COMPOSITE_DECOMPOSITION_DEFAULT = true;
const COMPOSITE_MAX_DEPTH_DEFAULT = 4;

// Projection-query domains, steps that only compute a view of current memory (show affordances / waypoints /
// chain-lint). Completing one doesn't change a record, so afterStep must NOT emit an `affordances.*` change signal for it. The
// same holds of every step declared a read, which is what the affordances panel's own re-fetch dispatches: announcing
// a change for it would re-fire that fetch over SSE without bound.
const PROJECTION_DOMAINS = new Set([DOMAIN_AFFORDANCES, DOMAIN_GOAL_RESOLUTION, DOMAIN_CHAIN_LINT]);

export class GoalResolutionStepper extends AStepper implements IHasOptions, IHasCycles {
	description = "Backward-chaining goal resolver and plan runner";

	options: Record<string, TStepperOption> = {
		[SMOKE_GOALS]: {
			desc: "Comma-separated list of domain keys to resolve at boot as a drift-detection signal",
			parse: (input: string) => stringOrError(input),
		},
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

	override async setWorld(world: import("../lib/world.js").TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
	}

	cycles: IStepperCycles = {
		startExecution: async () => {
			// Resolves each declared smoke goal and emits its verdict, which a later run's verdict is compared with.
			const world = this.getWorld();
			const smokeRaw = getStepperOption(this, SMOKE_GOALS, world.moduleOptions);
			if (smokeRaw) {
				const graph = buildDomainChain(this.steppers, world.domains);
				const goals = smokeRaw
					.split(",")
					.map((s: string) => s.trim())
					.filter((s: string) => s.length > 0);
				const facts = await world.shared.getStore().query({ namedGraph: FACT_GRAPH });
				const smokeFindings = goals.map((goal: string) => {
					// Actuality's own check, made as actuality: what it may reach is everything its steps offer.
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
			// Lean event: emit only a change signal. The affordances snapshot is large (forward + goals + their
			// resolution trees + composite michi), so the affordances panel and the domain-chain view re-fetch the
			// current snapshot on demand (show affordances) rather than ride every step's event.
			// Keeps the event log lean by construction: the bulk never denormalizes onto every step.
			// A step that didn't change a record doesn't announce a change: a read, or a step that only computes a view of memory.
			// Otherwise the panel's own re-fetch, which is a read, would re-trigger itself over SSE without bound.
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
	 * Returns composite-decomposition resolver options threaded from stepper config.
	 * Defaults: decomposition enabled, depth 4. Call sites spread these into the
	 * resolver inputs so every entry point shares the same configuration.
	 */
	private compositeOptions(): { domains: import("../lib/world.js").TWorld["domains"]; compositeDecomposition: boolean; compositeMaxDepth: number } {
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
		const facts = await world.shared.getStore().query({ namedGraph: FACT_GRAPH });
		return resolveGoal(goal, { graph, facts, held: authorizedWith(), ...this.compositeOptions() });
	}

	/** Walk a michi's steps in order, dispatching each through the synthetic-seqPath path used by other transports. Returns the produced factIds on success; surfaces the offending step's error on first failure. */
	private async executeMichi(goal: string, michi: TMichi): Promise<ReturnType<typeof actionOKWithProducts> | ReturnType<typeof actionNotOK>> {
		const world = this.getWorld();
		const registry = runRegistry(world);
		const factIds: string[] = [];
		for (const [i, step] of michi.steps.entries()) {
			const method = stepMethodName(step.stepperName, step.stepName);
			const call = await callStepByName({ registry, world, steppers: this.steppers }, method);
			if (!call.result.ok) return actionNotOK(`pursue ${goal}: step ${i} (${method}) failed: ${call.result.errorMessage}`);
			factIds.push(call.seqPath.join("."));
		}
		return actionOKWithProducts({ finding: "executed", goal, factIds });
	}

	/**
	 * Shared affordances builder for the live and as-of variants. When `asOf`
	 * is set, the projection drops facts asserted after that seqPath so the
	 * panel reconstructs actuality state at that point.
	 *
	 * Every registered stepper with the ProvidesWaypoints capability contributes waypoint entries to the same
	 * snapshot. Live only, waypoint ensure-state is current run state, so an as-of projection doesn't carry waypoint entries.
	 */
	private async computeAffordances(asOf: number[] | undefined, featureStep: TFeatureStep) {
		const world = this.getWorld();
		const facts = await world.shared.getStore().query({ namedGraph: FACT_GRAPH });
		const composite = this.compositeOptions();
		const affordances = buildAffordances({
			steppers: this.steppers,
			domains: world.domains,
			facts,
			held: authorizedWith(),
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
		 * A1 · `pursue {goal}`, close the goal-resolution loop with idempotent execution.
		 *
		 *  satisfied   → no-op, returns the satisfying factIds (matches activities/waypoints' `ensure` skip-when-proven contract)
		 *  michi (fact-only bindings) → execute each step in the first michi sequentially via dispatchStep; returns the produced factIds
		 *  michi with `kind: "argument"` bindings → refuses with what's missing (the caller must supply args via a follow-up; the SPA's path-card UI is the existing surface)
		 *  unreachable → refuses with the list of missing producers
		 *  refused     → refuses with the resolver's reason
		 *
		 *  The shape mirrors the architecture's activities pattern: check the world, act only if necessary, surface what's needed when stuck. Same primitives a Kihan reading affordances would follow, codified in one verb.
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
						`pursue ${goal}: ${argBindings.length} argument binding(s) need supplying, domains: ${argBindings.join(", ")}. Use the SPA's path-card or extend pursue with explicit args.`,
					);
				}
				return await this.executeMichi(goal, michi);
			},
		},

		/**
		 * Begin a walk toward a goal: resolve it, hold the path chosen, and stop before each step so what that step needs
		 * can be supplied. `pursue` runs a path straight through and so can only run one whose steps don't need a supplied value; a walk
		 * is how a path that needs something from a person is run, one step at a time, with what it produced recorded as
		 * it goes. The walk belongs to whoever began it.
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
		 * Run the walk's next step with what it needs. Only the reader who began the walk may advance it, since the
		 * arguments a step runs with are theirs.
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

		showAffordances: {
			gwta: "show affordances",
			productsDomain: DOMAIN_AFFORDANCES,
			action: async (_args, featureStep) => this.computeAffordances(undefined, featureStep),
		},

		showAffordancesAsOf: {
			gwta: `show affordances as of {asOf: ${DOMAIN_STEP_PATH}}`,
			productsDomain: DOMAIN_AFFORDANCES,
			action: ({ asOf }: { asOf: number[] }, featureStep) => this.computeAffordances(asOf, featureStep),
		},

		// The same snapshot the showing steps produce, as a read: what a page showing the panel asks for after every
		// step to stay current. Showing the panel is an act of actuality and is recorded as one; asking what is on offer
		// isn't shown and isn't recorded.
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
				// The bound view (`shu-domain-chain-view`) renders the chain as a Mermaid
				// graph from affordance data (forward edges + goal verdicts). Include both
				// shapes so opening the lint pane shows the graph immediately, with lint
				// findings available for overlaying orphan/unsupplied/unreachable nodes.
				const facts = await world.shared.getStore().query({ namedGraph: FACT_GRAPH });
				const affordances = buildAffordances({
					steppers: this.steppers,
					domains: world.domains,
					facts,
					held: authorizedWith(),
				});
				return actionOKWithProducts(chainLintSchema.parse({ ...report, forward: affordances.forward, goals: affordances.goals, execution: executionOf(world.tag) }));
			},
		},
	} as const satisfies TStepperSteps;
}

export default GoalResolutionStepper;

/** The first path the resolver found toward a goal that isn't satisfied yet. A goal it can't reach, or that it refused, is
 *  refused as `doing` it, stating why. */
function firstPathToward(doing: string, resolution: Exclude<TGoalResolution, { finding: typeof GOAL_FINDING.SATISFIED }>): TMichi {
	if (resolution.finding === GOAL_FINDING.UNREACHABLE) throw new Error(`${doing} ${resolution.goal}: unreachable (missing producers: ${resolution.missing.join(", ")})`);
	if (resolution.finding === GOAL_FINDING.REFUSED) throw new Error(`${doing} ${resolution.goal}: refused (${resolution.refusalReason}: ${resolution.detail})`);
	return resolution.michi[0];
}

/**
 * Walk a michi's bindings (and their nested composite fields) and collect
 * domain names that need argument values supplied by the caller. The list is
 * what `pursue` surfaces when execution can't proceed without input.
 */
/** A walk as a reader is shown it: where it has got to, what runs next, and what that step takes of them. What it
 *  needs is read from the step's own declaration, since that is what an advance has to supply. */
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
