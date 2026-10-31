/**
 * Goals as proofs over producer rules. The registry derives the rules from the steps' signatures, the engine proves each goal
 * within its depth limit and ancestor check, and a proof that holds is read back as a plan: the steps it leaves to call. A
 * proof reads the facts through its reader, once for every goal it proves. The affordances and the step graph's lint read the
 * same rules. A plan holds between its calls as facts of its own graph: its goal, the principal that began it, and the facts
 * its calls asserted. Its plan is proved again at each call, from the facts that hold then.
 */
import type { AStepper, TFeatureStep } from "@haibun/core/lib/steps/domains/stepper.js";
import type { TRegisteredDomain } from "@haibun/core/lib/domains/resources.js";
import { nextSeqPath, proveStep, type DispatchContext } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import { validatedFeatureStep } from "@haibun/core/lib/steps/pipelines/call-step.js";
import { literalTerm, renderStepLine } from "@haibun/core/lib/steps/derivations/named-vars.js";
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";
import { VERDICT, type TActionResult, type TStepResult } from "@haibun/core/lib/domains/protocol.js";
import { actionNotOK, actionOKWithProducts, actionUnknown } from "@haibun/core/lib/domains/util.js";
import { itemAt, valueAt } from "@haibun/core/lib/domains/item-at.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { actingAs } from "@haibun/core/lib/domains/capability-context.js";
import { DOMAIN_DOMAIN_KEY, refTargetOf } from "@haibun/core/lib/domains/domains.js";
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import { ACTUALITY_FIELD, SEQ_PATH_FIELD, actualityFeatureOf, factIdOf, producingStepRecord, stepRecordOf } from "@haibun/core/lib/actuality/domains/seq-path.js";
import {
	ApplicableStepsSchema,
	PlanProgressSchema,
	GoalResolutionSchema,
	PLAN_STATUS,
	providesWaypoints,
	type TGoalResolution,
	type TLintFinding,
} from "@haibun/core/lib/domains/goal-resolution.js";
import { argumentsOf, compositeRanges, forwardOf, goalFactsOf, isTrivial, planOf, stepGraph, stepSignatures, unmetReason, type THeldFact } from "../derivations/goals.js";
import { goalFacts, goalProofsOf, type TGoalFacts } from "../derivations/goal-rules.js";
import { lintFacts, lintFindingsOf } from "../derivations/lint-rules.js";
import { RULE_SET, type TRuleSet } from "../domains/reasoning.js";
import { derive } from "./reason.js";
import { quadsOf } from "../derivations/n3.js";
import type { Quad } from "@rdfjs/types";
import type { StepRegistry } from "@haibun/core/lib/steps/pipelines/step-registry.js";
import type { TGoalProof } from "../domains/logic.js";
import type { TReasoner } from "../ports.js";
import { readerOf, writeFacts } from "./reads.js";

/** What a goal's proof reads: the context whose steps and domains state the rules and whose store holds the facts, the reasoner,
 *  what the caller holds, and the name of the logic engine's stepper, whose steps a proof calls. */
export type TGoalScope = { ctx: DispatchContext; reasoner: TReasoner; held: string | string[] | undefined; stepper: string };

/** The most sessions of goals and lint a registry's version holds the results of, the oldest dropped first. */
const MAX_HELD_DERIVATIONS = 64;
/** What the goals and lint sessions of a registry derived, by the text each read, for the registry's version: the declarations
 *  are fixed between changes of its steps, which STEPS_CHANGED marks, so a session over the same facts derives the same again. */
export type THeldDerivations = Map<string, Promise<Quad[]>>;
const heldByRegistry = new WeakMap<Pick<StepRegistry, "version">, { version: number; derived: THeldDerivations }>();

/** The derivations a registry holds for its current version, emptied as its version changes. */
export function heldDerivations(registry: Pick<StepRegistry, "version">): THeldDerivations {
	const held = heldByRegistry.get(registry);
	if (held !== undefined && held.version === registry.version) return held.derived;
	const derived: THeldDerivations = new Map();
	heldByRegistry.set(registry, { version: registry.version, derived });
	return derived;
}

/** Returns what a session of the reasoner derives of `facts` under the rule set `rules` and its query, as quads, where it reads
 *  only its own facts; a registry's held derivations return a session's result again for the same text. */
function derivedOf(reasoner: TReasoner, [rules, query]: [TRuleSet, TRuleSet], facts: string, what: string, held?: THeldDerivations): Promise<Quad[]> {
	const key = `${rules}\n${facts}`;
	const found = held?.get(key);
	if (found !== undefined) return found;
	const deriving = derive(reasoner, `${reasoner.rules(rules)}\n${facts}`, reasoner.rules(query), false, {}, `${what} reads only its own facts`).then(quadsOf);
	if (held === undefined) return deriving;
	held.set(key, deriving);
	deriving.catch(() => held.delete(key));
	const [oldest] = held.keys();
	if (held.size > MAX_HELD_DERIVATIONS && oldest !== undefined) held.delete(oldest);
	return deriving;
}

/** Returns each goal's proof over the producer rules `facts` state: its fact, its plans and its gap. */
export const goalProofs = async (reasoner: TReasoner, facts: TGoalFacts, held?: THeldDerivations): Promise<TGoalProof[]> =>
	goalProofsOf(await derivedOf(reasoner, [RULE_SET.goals, RULE_SET.goalsQuery], goalFacts(facts), "a proof of goals", held), facts.goals);

const storeOf = ({ ctx }: TGoalScope): IQuadStore => ctx.world.shared.getStore();

/** Proves each goal over the products of steps `facts` holds, and returns its resolution. */
async function resolutions(scope: TGoalScope, goals: readonly string[], facts: readonly THeldFact[]): Promise<TGoalResolution[]> {
	const { steppers, world } = scope.ctx;
	const signatures = stepSignatures(steppers);
	const byMethod = new Map(signatures.map((one) => [one.method, one]));
	const byDomain = Map.groupBy(facts, (fact) => fact.domain);
	const latest = new Map(facts.toReversed().map((fact) => [fact.domain, fact.id]));
	const proofs = await goalProofs(scope.reasoner, goalFactsOf(signatures, world.domains, scope.held, facts, goals), heldDerivations(scope.ctx.registry));
	return proofs.map((proof) => {
		const plans = proof.plans.map((plan) => planOf(plan, byMethod, latest));
		const verdict = proof.held ? VERDICT.proved : VERDICT.unknown;
		const unplanned = !proof.held && plans.length === 0;
		const unmet = unplanned ? { unmet: unmetReason(proof), unmetChain: proof.unmet.map((node) => ("do" in node ? node.domain : node.unmet)) } : {};
		const factIds = proof.held ? valueAt(byDomain, proof.goal, "the facts of a goal the engine holds").map((fact) => fact.id) : [];
		return GoalResolutionSchema.parse({ goal: proof.goal, verdict, factIds, plans, ...unmet });
	});
}

/** Why a goal doesn't hold, as its resolution states it: the goal it couldn't prove, or a plan without a step to take. */
const unmetOf = ({ goal, unmet }: TGoalResolution): string => (unmet === undefined ? `its plan for ${goal} doesn't hold a step to take` : unmet);

/** Proves a goal over the facts the store holds now. */
async function resolutionOf(scope: TGoalScope, goal: string): Promise<TGoalResolution> {
	const reader = readerOf(storeOf(scope));
	return itemAt(await resolutions(scope, [goal], await reader.products()), 0);
}

/** Proves a step of a plan under the step that calls it, through the path every surface proves a step by, with the input its
 *  declaration validates. Returns its result and the id of its products' fact. */
async function proveUnder(ctx: DispatchContext, parent: TFeatureStep, method: string, input: Record<string, unknown>): Promise<{ result: TStepResult; fact: string }> {
	const { world } = ctx;
	const tool = ctx.registry.named(method);
	const seqPath = nextSeqPath(world, parent.seqPath);
	const result = await proveStep(ctx, { ...validatedFeatureStep(tool, input, seqPath, world, ctx.steppers), isSubStep: true });
	return { result, fact: factIdOf({ [ACTUALITY_FIELD]: actualityFeatureOf(world.tag), path: seqPath }) };
}

/** Proves a goal under the step `pattern` states. A proved goal returns its proof as statements in proof order: the line that
 *  asserted its fact, then the goal's statement. A goal without a fact or a plan is unknown, and its first unproved sub-goal is
 *  proved under the step, so the sub-goal's record states why. */
export async function resolved(scope: TGoalScope, parent: TFeatureStep, goal: string, pattern: string): Promise<TActionResult> {
	const resolution = await resolutionOf(scope, goal);
	if (resolution.unmet !== undefined) {
		const unmet = resolution.unmetChain?.at(-1);
		if (unmet !== undefined && unmet !== goal) await proveUnder(scope.ctx, parent, stepMethodName(scope.stepper, "resolve"), { goal: unmet });
		return actionUnknown(`\`${parent.in}\` isn't proved: ${unmetOf(resolution)}`);
	}
	const [fact] = resolution.factIds;
	if (fact === undefined) return actionOKWithProducts(resolution);
	const record = producingStepRecord(fact);
	const [stated] = await readerOf(storeOf(scope)).facts({ subject: record, predicate: SEQ_PATH_FIELD.stepText, namedGraph: SEQ_PATH_LABEL });
	const line = stated?.object;
	if (typeof line !== "string")
		throw new Error(
			`The fact ${fact} that proves \`${parent.in}\` names the record ${record}, which the store doesn't hold with its line. Run the line that states the fact again.`,
		);
	return actionOKWithProducts({ ...resolution, statements: [line, renderStepLine(pattern, { goal: literalTerm(goal, DOMAIN_DOMAIN_KEY) })] });
}

/** Proves a goal, and where only its plan would prove it, proves each step of its first plan under the step and the goal again. */
export async function pursued(scope: TGoalScope, parent: TFeatureStep, goal: string): Promise<TActionResult> {
	const resolution = await resolutionOf(scope, goal);
	if (resolution.verdict === VERDICT.proved) return actionOKWithProducts(resolution);
	const [plan] = resolution.plans;
	if (plan === undefined) return actionNotOK(`\`${parent.in}\` doesn't hold: ${unmetOf(resolution)}`);
	const supplied = argumentsOf(plan);
	if (supplied.length > 0) return actionNotOK(`\`${parent.in}\` needs ${supplied.join(", ")} from the caller, which its plan takes. Supply each through \`plan "${goal}"\`.`);
	for (const step of plan.steps) {
		const { result } = await proveUnder(scope.ctx, parent, stepMethodName(step.stepperName, step.stepName), {});
		if (!result.ok) return actionNotOK(`\`${parent.in}\` stopped at \`${result.in}\`, which failed: ${result.errorMessage}`);
	}
	const again = await resolutionOf(scope, goal);
	if (again.verdict === VERDICT.proved) return actionOKWithProducts(again);
	return actionNotOK(`The steps of the plan for \`${parent.in}\` passed, and a fact of ${goal} still doesn't hold. Declare ${goal} as the products of the plan's last step.`);
}

/** The graph that holds each plan's facts. */
const PLAN_GRAPH = "plan";
const PLAN = { goal: "goal", owner: "owner", factIds: "factIds" } as const;

/** A plan's facts: its goal, the principal that began it, where one did, and the facts its calls asserted. */
type TPlanRecord = { goal: string; owner?: string; factIds: string[] };

/** Writes a plan's facts in place of the facts it held, at the read level of its caller, so its owner reads them back. */
async function writePlan(store: IQuadStore, plan: string, { goal, owner, factIds }: TPlanRecord): Promise<void> {
	await store.remove({ subject: plan, namedGraph: PLAN_GRAPH });
	await writeFacts(store, plan, PLAN_GRAPH, { [PLAN.goal]: goal, [PLAN.factIds]: factIds, [PLAN.owner]: owner });
}

/** Reads a plan's facts. Refuses a plan the store doesn't hold. */
async function readPlan(store: IQuadStore, plan: string): Promise<TPlanRecord> {
	const held = new Map((await readerOf(store).facts({ subject: plan, namedGraph: PLAN_GRAPH })).map(({ predicate, object }) => [predicate, object]));
	const [goal, owner, factIds] = [PLAN.goal, PLAN.owner, PLAN.factIds].map((predicate) => held.get(predicate));
	if (typeof goal !== "string" || !Array.isArray(factIds))
		throw new Error(`The store doesn't hold the plan ${plan}. Begin a plan with \`plan\` and its goal, and advance the plan it returns.`);
	return { goal, factIds: factIds.map(String), ...(typeof owner === "string" ? { owner } : {}) };
}

/** A plan's products: the step its next advance calls and the parameters that step takes, from its goal's plan as it holds now. */
async function planProducts(scope: TGoalScope, line: string, plan: string, goal: string, factIds: string[]): Promise<TActionResult> {
	const resolution = await resolutionOf(scope, goal);
	const next = resolution.verdict === VERDICT.proved ? undefined : resolution.plans[0]?.steps[0];
	if (resolution.verdict === VERDICT.unknown && next === undefined) return actionUnknown(`\`${line}\` doesn't have a plan that reaches ${goal}: ${unmetOf(resolution)}`);
	if (next === undefined) return actionOKWithProducts(PlanProgressSchema.parse({ plan, goal, status: PLAN_STATUS.ended, needs: [], factIds }));
	const method = stepMethodName(next.stepperName, next.stepName);
	const needs = [...scope.ctx.registry.named(method).paramDomainKeys.keys()];
	return actionOKWithProducts(PlanProgressSchema.parse({ plan, goal, status: PLAN_STATUS.running, next: method, needs, factIds }));
}

/** Begins a plan toward a goal that isn't proved, under the principal that begins it, named by the record of the step. */
export async function planBegun(scope: TGoalScope, parent: TFeatureStep, goal: string): Promise<TActionResult> {
	if ((await resolutionOf(scope, goal)).verdict === VERDICT.proved)
		return actionNotOK(`\`${parent.in}\` doesn't need a plan: a fact of ${goal} already holds. Read it with \`resolve "${goal}"\`.`);
	const plan = stepRecordOf(scope.ctx.world.tag, parent.seqPath);
	const owner = actingAs();
	await writePlan(storeOf(scope), plan, { goal, factIds: [], ...(owner === undefined ? {} : { owner }) });
	return await planProducts(scope, parent.in, plan, goal, []);
}

/** Proves the next step of a plan, as it holds now, under the step with the values given, and holds the fact it asserted.
 *  Refuses a caller other than the principal that began the plan. */
export async function planAdvanced(scope: TGoalScope, parent: TFeatureStep, plan: string, args: Record<string, unknown>): Promise<TActionResult> {
	const store = storeOf(scope);
	const held = await readPlan(store, plan);
	if (held.owner !== actingAs()) {
		const began = held.owner === undefined ? "a caller without a principal" : held.owner;
		return actionNotOK(`\`${parent.in}\` advances a plan that ${began} began. Begin a plan of your own with \`plan "${held.goal}"\`.`);
	}
	const resolution = await resolutionOf(scope, held.goal);
	const next = resolution.plans[0]?.steps[0];
	if (resolution.verdict !== VERDICT.unknown || next === undefined) return await planProducts(scope, parent.in, plan, held.goal, held.factIds);
	const { result, fact } = await proveUnder(scope.ctx, parent, stepMethodName(next.stepperName, next.stepName), args);
	if (!result.ok) return actionNotOK(`\`${parent.in}\` stopped at \`${result.in}\`, which failed: ${result.errorMessage}`);
	const factIds = [...held.factIds, fact];
	await writePlan(store, plan, { ...held, factIds });
	return await planProducts(scope, parent.in, plan, held.goal, factIds);
}

/** The steps on offer and the resolution of each goal a step returns, over the facts that held at `asOf` where it is stated. A
 *  goal whose every plan is one step on offer is left out, and a fact whose id doesn't name a step holds at every step. */
async function snapshotOf(scope: TGoalScope, asOf: readonly number[] | undefined) {
	const { steppers, world } = scope.ctx;
	const reader = readerOf(storeOf(scope), asOf);
	const facts = await reader.products();
	const signatures = stepSignatures(steppers);
	// A reference names a record of its target, so the goal is the target where a step returns it.
	const isReference = (domain: string) => world.domains[domain] !== undefined && refTargetOf(world.domains[domain], world.domains) !== undefined;
	const goals = [...new Set(signatures.flatMap((one) => one.outputDomains))].filter((domain) => !isReference(domain));
	const goalsOf = (await resolutions(scope, goals, facts)).flatMap((resolution) => {
		if (resolution.unmet === undefined && isTrivial(resolution.plans)) return [];
		const domain = world.domains[resolution.goal];
		const description = domain?.description ?? domain?.schema.description;
		if (description === undefined)
			throw new Error(`The goal ${resolution.goal} doesn't have a description. Describe its schema with .describe("…"), or set description on its domain definition.`);
		return [{ domain: resolution.goal, description, resolution }];
	});
	return {
		forward: forwardOf(signatures, facts, scope.held),
		goals: goalsOf,
		satisfiedDomains: [...new Set(facts.map((fact) => fact.domain))].sort(),
		satisfiedFacts: Object.fromEntries([...Map.groupBy(facts, (fact) => fact.domain)].map(([domain, held]) => [domain, held.map((fact) => fact.id)])),
		composites: compositeRanges(world.domains),
		[ACTUALITY_FIELD]: actualityFeatureOf(world.tag),
	};
}

/** The affordances over the facts that held at `asOf` where it is stated, with each stepper's waypoints where it isn't. */
export async function applicableStepsAt(scope: TGoalScope, parent: TFeatureStep, asOf: readonly number[] | undefined): Promise<TActionResult> {
	const waypointers = asOf === undefined ? scope.ctx.steppers.filter(providesWaypoints) : [];
	const waypoints = (await Promise.all(waypointers.map((stepper) => stepper.waypointEntries(parent)))).flat();
	const findings = await lintFindings(scope.reasoner, scope.ctx.steppers, scope.ctx.world.domains, heldDerivations(scope.ctx.registry));
	return actionOKWithProducts(ApplicableStepsSchema.parse({ ...(await snapshotOf(scope, asOf)), waypoints, findings }));
}

/** The step graph's lint findings, as the reasoner derives them from the steps' signatures and the domains. */
export const lintFindings = async (
	reasoner: TReasoner,
	steppers: readonly AStepper[],
	domains: Record<string, TRegisteredDomain>,
	held?: THeldDerivations,
): Promise<TLintFinding[]> =>
	lintFindingsOf(await derivedOf(reasoner, [RULE_SET.lint, RULE_SET.lintQuery], lintFacts(stepGraph(stepSignatures(steppers), domains)), "the step graph's lint", held));
