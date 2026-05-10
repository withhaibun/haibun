/**
 * GoalResolutionStepper — exposes the goal resolver as steps.
 *
 *   how to get {goal: domain-key}                   → DOMAIN_GOAL_RESOLUTION
 *   how to get {goal: domain-key} matching {filter} → DOMAIN_GOAL_RESOLUTION (filter unused in v1)
 *   run plan {plan: goal-resolution}                → runs the plan step-by-step
 *
 * Plans are advisory. `run plan` re-checks every precondition at dispatch time;
 * the resolver never auto-runs anything.
 */
import {
	AStepper,
	type IHasCycles,
	type IStepperCycles,
	type TAfterStep,
	type TAfterStepResult,
	type TStepperSteps,
	type TFeatureStep,
	type IHasOptions,
	type TStepperOption,
} from "../lib/astepper.js";
import { actionNotOK, actionOK, actionOKWithProducts, getStepperOption, stringOrError } from "../lib/util/index.js";
import { DOMAIN_AFFORDANCES, DOMAIN_CHAIN_LINT, DOMAIN_DOMAIN_KEY, DOMAIN_GOAL_RESOLUTION, DOMAIN_JSON } from "../lib/domains.js";
import { buildDomainChain } from "../lib/domain-chain.js";
import { lintDomainChain } from "../lib/domain-chain-lint.js";
import { resolveGoal, type TGoalResolution, type TPlanStep } from "../lib/goal-resolver.js";
import { buildAffordances } from "../lib/affordances.js";
import { FACT_GRAPH } from "../lib/working-memory.js";
import { stepMethodName } from "../lib/step-dispatch.js";

const GRANTED_CAPABILITY = "GRANTED_CAPABILITY";

export class GoalResolutionStepper extends AStepper implements IHasOptions, IHasCycles {
	description = "Backward-chaining goal resolver and plan runner";

	options: Record<string, TStepperOption> = {
		[GRANTED_CAPABILITY]: {
			desc: "Comma-separated list of capabilities the caller holds; passed to the goal resolver",
			parse: (input: string) => stringOrError(input),
		},
	};

	private steppers: AStepper[] = [];

	override async setWorld(world: import("../lib/world.js").TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
	}

	cycles: IStepperCycles = {
		afterStep: async (_after: TAfterStep): Promise<TAfterStepResult> => {
			// Emit the current affordances snapshot so monitors and the shu panel can
			// render "what can I do next?" without polling. Identity is the seqPath.
			const world = this.getWorld();
			const facts = await world.shared.getStore().query({ namedGraph: FACT_GRAPH });
			const affordances = buildAffordances({
				steppers: this.steppers,
				domains: world.domains,
				facts,
				capabilities: this.grantedCapabilities(),
			});
			world.eventLogger.emit({
				id: `affordances.${world.runtime.currentSeqPath ?? "ad-hoc"}`,
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

	private async runResolution(goal: string): Promise<TGoalResolution> {
		const world = this.getWorld();
		const graph = buildDomainChain(this.steppers, world.domains);
		const facts = await world.shared.getStore().query({ namedGraph: FACT_GRAPH });
		return resolveGoal(goal, { graph, facts, capabilities: this.grantedCapabilities() });
	}

	steps: TStepperSteps = {
		howToGet: {
			gwta: `how to get {goal: ${DOMAIN_DOMAIN_KEY}}`,
			inputDomains: { goal: DOMAIN_DOMAIN_KEY },
			outputDomain: DOMAIN_GOAL_RESOLUTION,
			action: async ({ goal }: { goal: string }) => {
				const resolution = await this.runResolution(goal);
				return actionOKWithProducts(resolution as unknown as Record<string, unknown>);
			},
		},

		howToGetMatching: {
			gwta: `how to get {goal: ${DOMAIN_DOMAIN_KEY}} matching {constraint: ${DOMAIN_JSON}}`,
			inputDomains: { goal: DOMAIN_DOMAIN_KEY, constraint: DOMAIN_JSON },
			outputDomain: DOMAIN_GOAL_RESOLUTION,
			action: async ({ goal }: { goal: string; constraint: unknown }) => {
				// v1: constraints are accepted but not yet propagated through the resolver.
				const resolution = await this.runResolution(goal);
				return actionOKWithProducts(resolution as unknown as Record<string, unknown>);
			},
		},

		showAffordances: {
			gwta: "show affordances",
			outputDomain: DOMAIN_AFFORDANCES,
			action: async () => {
				const world = this.getWorld();
				const facts = await world.shared.getStore().query({ namedGraph: FACT_GRAPH });
				const affordances = buildAffordances({
					steppers: this.steppers,
					domains: world.domains,
					facts,
					capabilities: this.grantedCapabilities(),
				});
				return actionOKWithProducts(affordances as unknown as Record<string, unknown>);
			},
		},

		showDomainChainLint: {
			gwta: "show domain chain lint",
			outputDomain: DOMAIN_CHAIN_LINT,
			action: () => {
				const world = this.getWorld();
				const graph = buildDomainChain(this.steppers, world.domains);
				const report = lintDomainChain(graph, world.domains);
				return Promise.resolve(actionOKWithProducts(report as unknown as Record<string, unknown>));
			},
		},

		runPlan: {
			gwta: `run plan {plan: ${DOMAIN_GOAL_RESOLUTION}}`,
			inputDomains: { plan: DOMAIN_GOAL_RESOLUTION },
			action: async ({ plan }: { plan: TGoalResolution }, _featureStep?: TFeatureStep) => {
				if (plan.finding !== "plan") return actionNotOK(`run plan: cannot run a "${plan.finding}" finding`);
				const world = this.getWorld();
				if (!world.runtime.stepRegistry) return actionNotOK("run plan: no step registry available on world.runtime");
				for (const planStep of plan.steps) {
					const error = await this.dispatchPlanStep(planStep);
					if (error) return actionNotOK(`run plan: ${planStep.stepperName}.${planStep.stepName} failed: ${error}`);
				}
				return actionOK();
			},
		},
	};

	private async dispatchPlanStep(planStep: TPlanStep): Promise<string | undefined> {
		const world = this.getWorld();
		const registry = world.runtime.stepRegistry;
		if (!registry) return "no step registry";
		const tool = registry.get(stepMethodName(planStep.stepperName, planStep.stepName));
		if (!tool) return `step not found: ${planStep.stepperName}.${planStep.stepName}`;
		// Build a synthetic FeatureStep for the plan step. The current seqPath
		// nests under the runPlan step's own seqPath via the runtime currentSeqPath.
		const syntheticSeqPath = [...(world.runtime.currentSeqPath?.split(".").map((n) => Number(n)) ?? [0]), 0];
		const featureStep: TFeatureStep = {
			in: planStep.gwta ?? `${planStep.stepperName}.${planStep.stepName}`,
			seqPath: syntheticSeqPath,
			source: { path: world.runtime.feature ?? "plan" },
			action: { actionName: planStep.stepName, stepperName: planStep.stepperName, step: { action: () => actionOK() }, stepValuesMap: {} },
		};
		const result = await tool.handler(featureStep, world);
		if (!result.ok) return result.errorMessage;
		return undefined;
	}
}

export default GoalResolutionStepper;
