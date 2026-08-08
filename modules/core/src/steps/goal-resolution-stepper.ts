/**
 * GoalResolutionStepper — exposes the goal resolver as steps.
 *
 *   resolve {goal: domain-key}                          → DOMAIN_GOAL_RESOLUTION
 *   resolve {goal: domain-key} where {constraint: json} → DOMAIN_GOAL_RESOLUTION (constraint accepted; resolution runs on the goal)
 *   show affordances                                    → DOMAIN_AFFORDANCES (forward edges + goal verdicts)
 *   show chain lint                                     → DOMAIN_CHAIN_LINT (orphan/starved/unreachable findings + affordance overlay)
 *
 * The resolver is pure search; it never auto-runs anything. Multi-step
 * execution along a resolved michi happens through the chain-walker
 * (`advanceChainInstance` in lib/chain-walker.js), which drives one step at
 * a time so the SPA can collect per-step user input.
 */
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
import { DOMAIN_AFFORDANCES, DOMAIN_CHAIN_LINT, DOMAIN_DOMAIN_KEY, DOMAIN_GOAL_RESOLUTION, DOMAIN_JSON } from "../lib/domains.js";
import { affordancesSchema, chainLintSchema, goalResolutionSchema } from "../lib/core-domains.js";
import { buildDomainChain } from "../lib/domain-chain.js";
import { lintDomainChain } from "../lib/domain-chain-lint.js";
import { resolveGoal, GOAL_FINDING, type TGoalResolution, type TMichi, type TBinding } from "../lib/goal-resolver.js";
import { StepRegistry, stepMethodName } from "../lib/step-registry.js";
import { callStepByName } from "../lib/call-step.js";
import { buildAffordances, providesWaypoints, AFFORDANCE_EVENT_PREFIX, type TWaypointEntry, satisfiedGoalDomains } from "../lib/affordances.js";
import { FACT_GRAPH } from "../lib/working-memory.js";
import { parseSeqPath } from "../lib/seq-path.js";

const GRANTED_CAPABILITY = "GRANTED_CAPABILITY";
const SMOKE_GOALS = "SMOKE_GOALS";
const COMPOSITE_DECOMPOSITION = "COMPOSITE_DECOMPOSITION";
const COMPOSITE_MAX_DEPTH = "COMPOSITE_MAX_DEPTH";

const COMPOSITE_DECOMPOSITION_DEFAULT = true;
const COMPOSITE_MAX_DEPTH_DEFAULT = 4;

// Projection-query domains — steps that only READ current memory (show affordances / waypoints / chain-lint). Completing
// one changes nothing, so afterStep must NOT emit an `affordances.*` change signal for it: the affordances panel's own
// re-fetch dispatches one of these steps, and announcing a change re-fires that fetch over SSE — an unbounded RPC↔SSE storm.
const PROJECTION_DOMAINS = new Set([DOMAIN_AFFORDANCES, DOMAIN_GOAL_RESOLUTION, DOMAIN_CHAIN_LINT]);

export class GoalResolutionStepper extends AStepper implements IHasOptions, IHasCycles {
	description = "Backward-chaining goal resolver and plan runner";

	options: Record<string, TStepperOption> = {
		[GRANTED_CAPABILITY]: {
			desc: "Comma-separated list of capabilities the caller holds; passed to the goal resolver",
			parse: (input: string) => stringOrError(input),
		},
		[SMOKE_GOALS]: {
			desc: "Comma-separated list of domain keys to resolve at boot as a drift-detection signal",
			parse: (input: string) => stringOrError(input),
		},
		[COMPOSITE_DECOMPOSITION]: {
			desc: `Recurse into composite input domains via topology.ranges when resolving goals (haibun equivalent of sh:node/rdfs:range). "true" / "false". Default ${COMPOSITE_DECOMPOSITION_DEFAULT}.`,
			parse: (input: string) => stringOrError(input),
		},
		[COMPOSITE_MAX_DEPTH]: {
			desc: `Cap on composite recursion depth, independent of the producer-chain depth budget. Default ${COMPOSITE_MAX_DEPTH_DEFAULT}.`,
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
			// Emit a one-time domain-chain lint report at startup so monitors and the
			// shu UI can surface orphan/starved/unreachable findings before any step runs.
			const world = this.getWorld();
			const graph = buildDomainChain(this.steppers, world.domains);
			const lint = lintDomainChain(graph, world.domains);
			world.eventLogger.emit({
				id: "domain-chain.lint.startup",
				timestamp: Date.now(),
				source: "haibun",
				kind: "artifact",
				artifactType: "json",
				mimetype: "application/json",
				level: "debug",
				json: { domainChainLint: lint } as Record<string, unknown>,
			});

			// Smoke-goals drift detector: resolve each declared smoke goal and emit
			// the verdict for comparison against a prior snapshot to detect graph-shape regressions.
			const smokeRaw = getStepperOption(this, SMOKE_GOALS, world.moduleOptions);
			if (smokeRaw) {
				const goals = smokeRaw
					.split(",")
					.map((s: string) => s.trim())
					.filter((s: string) => s.length > 0);
				const facts = await world.shared.getStore().query({ namedGraph: FACT_GRAPH });
				const smokeFindings = goals.map((goal: string) => {
					const resolution = resolveGoal(goal, { graph, facts, capabilities: this.grantedCapabilities(), ...this.compositeOptions() });
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
					json: { domainChainSmoke: { goals: smokeFindings } } as Record<string, unknown>,
				});
			}
		},
		afterStep: (after: TAfterStep): Promise<TAfterStepResult> => {
			// Lean event: emit only a change signal. The affordances snapshot is large (forward + goals + their
			// resolution trees + composite michi), so the affordances panel and the domain-chain view re-fetch the
			// current snapshot on demand (show affordances) rather than ride every step's event.
			// Keeps the event log lean by construction — the bulk never denormalizes onto every step.
			// But a projection-query step itself changed nothing, so it must not announce a change — else the panel's
			// on-demand re-fetch (which dispatched this very step) re-triggers itself over SSE without bound.
			if (PROJECTION_DOMAINS.has(after.featureStep.action.step.productsDomain ?? "")) return Promise.resolve({ failed: false });
			const seqPath = this.getWorld().runtime.currentSeqPath;
			if (!seqPath) {
				throw new Error("GoalResolutionStepper.afterStep: world.runtime.currentSeqPath is unset. dispatchStep must set currentSeqPath before invoking afterStep cycles.");
			}
			this.getWorld().eventLogger.emit({
				id: `${AFFORDANCE_EVENT_PREFIX}${seqPath}`,
				timestamp: Date.now(),
				source: "haibun",
				kind: "artifact",
				artifactType: "json",
				mimetype: "application/json",
				level: "debug",
				json: { affordancesChanged: true } as Record<string, unknown>,
			});
			return Promise.resolve({ failed: false });
		},
	};

	private grantedCapabilities(): ReadonlySet<string> {
		const raw = getStepperOption(this, GRANTED_CAPABILITY, this.getWorld().moduleOptions);
		if (!raw) return new Set();
		return new Set(
			raw
				.split(",")
				.map((s: string) => s.trim())
				.filter((s: string) => s.length > 0),
		);
	}

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
		return resolveGoal(goal, { graph, facts, capabilities: this.grantedCapabilities(), ...this.compositeOptions() });
	}

	/** Walk a michi's steps in order, dispatching each through the synthetic-seqPath path used by other transports. Returns the produced factIds on success; surfaces the offending step's error on first failure. */
	private async executeMichi(goal: string, michi: TMichi): Promise<ReturnType<typeof actionOKWithProducts> | ReturnType<typeof actionNotOK>> {
		const world = this.getWorld();
		const registry = new StepRegistry(this.steppers, world);
		const factIds: string[] = [];
		for (let i = 0; i < michi.steps.length; i++) {
			const step = michi.steps[i];
			const method = stepMethodName(step.stepperName, step.stepName);
			const call = await callStepByName({ registry, world, steppers: this.steppers, grantedCapability: Array.from(this.grantedCapabilities()) }, method);
			if (!call.registered) return actionNotOK(`pursue ${goal}: step ${i} (${method}) not registered`);
			if (!call.result.ok) return actionNotOK(`pursue ${goal}: step ${i} (${method}) failed: ${call.result.errorMessage ?? "(no message)"}`);
			factIds.push(call.seqPath.join("."));
		}
		return actionOKWithProducts({ finding: "executed", goal, factIds });
	}

	/**
	 * Shared affordances builder for the live and as-of variants. When `asOf`
	 * is set, the projection drops facts asserted after that seqPath so the
	 * panel reconstructs the run state at that point.
	 *
	 * Every registered stepper with the ProvidesWaypoints capability contributes waypoint entries to the same
	 * snapshot. Live only — waypoint ensure-state is current run state, so an as-of projection carries none.
	 */
	private async computeAffordances(asOf: number[] | undefined, featureStep: TFeatureStep) {
		const world = this.getWorld();
		const facts = await world.shared.getStore().query({ namedGraph: FACT_GRAPH });
		const composite = this.compositeOptions();
		const affordances = buildAffordances({
			steppers: this.steppers,
			domains: world.domains,
			facts,
			capabilities: this.grantedCapabilities(),
			compositeDecomposition: composite.compositeDecomposition,
			compositeMaxDepth: composite.compositeMaxDepth,
			asOfSeqPath: asOf,
		});
		const waypoints: TWaypointEntry[] = [];
		if (!asOf) {
			const satisfied = satisfiedGoalDomains(affordances.goals, GOAL_FINDING.SATISFIED);
			for (const stepper of this.steppers) if (providesWaypoints(stepper)) waypoints.push(...(await stepper.waypointEntries(featureStep, satisfied)));
		}
		return actionOKWithProducts(affordancesSchema.parse({ ...affordances, waypoints }));
	}

	steps: TStepperSteps = {
		resolve: {
			gwta: `resolve {goal: ${DOMAIN_DOMAIN_KEY}}`,
			inputDomains: { goal: DOMAIN_DOMAIN_KEY },
			productsDomain: DOMAIN_GOAL_RESOLUTION,
			action: async ({ goal }: { goal: string }) => {
				const resolution = await this.runResolution(goal);
				return actionOKWithProducts(goalResolutionSchema.parse(resolution));
			},
		},

		/**
		 * A1 · `pursue {goal}` — close the goal-resolution loop with idempotent execution.
		 *
		 *  satisfied   → no-op, returns the satisfying factIds (matches activities/waypoints' `ensure` skip-when-proven contract)
		 *  michi (fact-only bindings) → execute each step in the first michi sequentially via dispatchStep; returns the produced factIds
		 *  michi with `kind: "argument"` bindings → refuses with what's missing (the caller must supply args via a follow-up; the SPA's path-card UI is the existing surface)
		 *  unreachable → refuses with the list of missing producers
		 *  refused     → refuses with the resolver's reason
		 *
		 *  The shape mirrors the architecture's activities pattern: check the world, act only if necessary, surface what's needed when stuck. Same primitives a Kihan reading affordances would follow — codified in one verb.
		 */
		pursue: {
			gwta: `pursue {goal: ${DOMAIN_DOMAIN_KEY}}`,
			inputDomains: { goal: DOMAIN_DOMAIN_KEY },
			productsDomain: DOMAIN_GOAL_RESOLUTION,
			action: async ({ goal }: { goal: string }) => {
				const resolution = await this.runResolution(goal);
				if (resolution.finding === GOAL_FINDING.SATISFIED) {
					return actionOKWithProducts(goalResolutionSchema.parse(resolution));
				}
				if (resolution.finding === GOAL_FINDING.UNREACHABLE) {
					return actionNotOK(`pursue ${goal}: unreachable (missing producers: ${resolution.missing.join(", ")})`);
				}
				if (resolution.finding === GOAL_FINDING.REFUSED) {
					return actionNotOK(`pursue ${goal}: refused (${resolution.refusalReason}: ${resolution.detail})`);
				}
				// finding === MICHI — take the first path
				const michi: TMichi = resolution.michi[0];
				if (!michi) return actionNotOK(`pursue ${goal}: no michi returned`);
				const argBindings = collectArgumentBindings(michi.bindings);
				if (argBindings.length > 0) {
					return actionNotOK(
						`pursue ${goal}: ${argBindings.length} argument binding(s) need supplying — domains: ${argBindings.join(", ")}. Use the SPA's path-card or extend pursue with explicit args.`,
					);
				}
				return await this.executeMichi(goal, michi);
			},
		},

		resolveWhere: {
			gwta: `resolve {goal: ${DOMAIN_DOMAIN_KEY}} where {constraint: ${DOMAIN_JSON}}`,
			inputDomains: { goal: DOMAIN_DOMAIN_KEY, constraint: DOMAIN_JSON },
			productsDomain: DOMAIN_GOAL_RESOLUTION,
			action: async ({ goal }: { goal: string; constraint: unknown }) => {
				// constraint is accepted as a domain input; resolution runs on the goal alone.
				const resolution = await this.runResolution(goal);
				return actionOKWithProducts(goalResolutionSchema.parse(resolution));
			},
		},

		showAffordances: {
			gwta: "show affordances",
			productsDomain: DOMAIN_AFFORDANCES,
			action: async (_args, featureStep) => this.computeAffordances(undefined, featureStep),
		},

		showAffordancesAsOf: {
			gwta: "show affordances as of {asOf: string}",
			productsDomain: DOMAIN_AFFORDANCES,
			action: ({ asOf }: { asOf: string }, featureStep) => {
				const parsed = parseSeqPath(asOf);
				if (!parsed) return actionNotOK(`show affordances as of: ${asOf} is not a seqPath (expected dot-joined integers, e.g. "0.-1.5.1")`);
				return this.computeAffordances(parsed, featureStep);
			},
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
				// findings available for overlaying orphan/starved/unreachable nodes.
				const facts = await world.shared.getStore().query({ namedGraph: FACT_GRAPH });
				const affordances = buildAffordances({
					steppers: this.steppers,
					domains: world.domains,
					facts,
					capabilities: this.grantedCapabilities(),
				});
				return actionOKWithProducts(chainLintSchema.parse({ ...report, forward: affordances.forward, goals: affordances.goals }));
			},
		},
	};
}

export default GoalResolutionStepper;

/**
 * Walk a michi's bindings (and their nested composite fields) and collect
 * domain names that need argument values supplied by the caller. The list is
 * what `pursue` surfaces when execution can't proceed without input.
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
