/**
 * GoalResolutionStepper — exposes the goal resolver as steps.
 *
 *   resolve {goal: domain-key}                          → DOMAIN_GOAL_RESOLUTION
 *   resolve {goal: domain-key} where {constraint: json} → DOMAIN_GOAL_RESOLUTION (constraint unused in v1)
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
	type TAfterStepResult,
	type TStepperSteps,
	type IHasOptions,
	type TStepperOption,
} from "../lib/astepper.js";
import { actionNotOK, actionOKWithProducts, getStepperOption, stringOrError } from "../lib/util/index.js";
import { DOMAIN_AFFORDANCES, DOMAIN_CHAIN_LINT, DOMAIN_DOMAIN_KEY, DOMAIN_GOAL_RESOLUTION, DOMAIN_JSON } from "../lib/domains.js";
import { buildDomainChain } from "../lib/domain-chain.js";
import { lintDomainChain } from "../lib/domain-chain-lint.js";
import { resolveGoal, type TGoalResolution } from "../lib/goal-resolver.js";
import { buildAffordances } from "../lib/affordances.js";
import { FACT_GRAPH } from "../lib/working-memory.js";
import { parseSeqPath } from "../lib/seq-path.js";

const GRANTED_CAPABILITY = "GRANTED_CAPABILITY";
const SMOKE_GOALS = "SMOKE_GOALS";
const COMPOSITE_DECOMPOSITION = "COMPOSITE_DECOMPOSITION";
const COMPOSITE_MAX_DEPTH = "COMPOSITE_MAX_DEPTH";

const COMPOSITE_DECOMPOSITION_DEFAULT = true;
const COMPOSITE_MAX_DEPTH_DEFAULT = 4;

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

			// Smoke-goals drift detector. Resolve each declared smoke goal and emit
			// the verdict. Consumers (the user, a CI checker) compare against the
			// previous snapshot to detect graph-shape regressions.
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
		afterStep: async (_after: TAfterStep): Promise<TAfterStepResult> => {
			// Emit the current affordances snapshot so monitors and the shu panel can
			// render "what can I do next?" without polling. Identity is the seqPath.
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
			});
			const seqPath = world.runtime.currentSeqPath;
			if (!seqPath) {
				throw new Error("GoalResolutionStepper.afterStep: world.runtime.currentSeqPath is unset. dispatchStep must set currentSeqPath before invoking afterStep cycles.");
			}
			world.eventLogger.emit({
				id: `affordances.${seqPath}`,
				timestamp: Date.now(),
				source: "haibun",
				kind: "artifact",
				artifactType: "json",
				mimetype: "application/json",
				level: "debug",
				json: { affordances } as Record<string, unknown>,
			});
			return { failed: false };
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

	/**
	 * Shared affordances builder for the live and as-of variants. When `asOf`
	 * is set, the projection drops facts asserted after that seqPath so the
	 * panel reconstructs the run state at that point.
	 */
	private async computeAffordances(asOf: number[] | undefined) {
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
		return actionOKWithProducts(affordances as unknown as Record<string, unknown>);
	}

	steps: TStepperSteps = {
		resolve: {
			gwta: `resolve {goal: ${DOMAIN_DOMAIN_KEY}}`,
			inputDomains: { goal: DOMAIN_DOMAIN_KEY },
			productsDomain: DOMAIN_GOAL_RESOLUTION,
			action: async ({ goal }: { goal: string }) => {
				const resolution = await this.runResolution(goal);
				return actionOKWithProducts(resolution as unknown as Record<string, unknown>);
			},
		},

		resolveWhere: {
			gwta: `resolve {goal: ${DOMAIN_DOMAIN_KEY}} where {constraint: ${DOMAIN_JSON}}`,
			inputDomains: { goal: DOMAIN_DOMAIN_KEY, constraint: DOMAIN_JSON },
			productsDomain: DOMAIN_GOAL_RESOLUTION,
			action: async ({ goal }: { goal: string; constraint: unknown }) => {
				// constraints accepted but not yet propagated through the resolver.
				const resolution = await this.runResolution(goal);
				return actionOKWithProducts(resolution as unknown as Record<string, unknown>);
			},
		},

		showAffordances: {
			gwta: "show affordances",
			productsDomain: DOMAIN_AFFORDANCES,
			action: async () => this.computeAffordances(undefined),
		},

		showAffordancesAsOf: {
			gwta: "show affordances as of {asOf: string}",
			productsDomain: DOMAIN_AFFORDANCES,
			action: ({ asOf }: { asOf: string }) => {
				const parsed = parseSeqPath(asOf);
				if (!parsed) return actionNotOK(`show affordances as of: ${asOf} is not a seqPath (expected dot-joined integers, e.g. "0.-1.5.1")`);
				return this.computeAffordances(parsed);
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
				return actionOKWithProducts({ ...(report as unknown as Record<string, unknown>), forward: affordances.forward, goals: affordances.goals });
			},
		},
	};
}

export default GoalResolutionStepper;
