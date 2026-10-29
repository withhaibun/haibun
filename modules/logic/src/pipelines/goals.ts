/**
 * Goals as proofs over producer rules. The registry derives the rules from the steps' signatures, the engine proves each goal
 * within its depth limit and ancestor check, and a proof that holds is read back as a plan: the steps it leaves to call. A
 * proof reads the facts through its reader, once for every goal it proves. The affordances and the step graph's lint read the
 * same rules. A walk holds between its calls as facts of its own graph: its goal, the principal that began it, and the facts
 * its calls asserted. Its plan is proved again at each call, from the facts that hold then.
 */
import type { AStepper, TFeatureStep } from "@haibun/core/lib/steps/domains/stepper.js";
import type { TRegisteredDomain } from "@haibun/core/lib/domains/resources.js";
import { nextSeqPath, proveStep, type DispatchContext } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import { validatedFeatureStep } from "@haibun/core/lib/steps/pipelines/call-step.js";
import { literalTerm, renderStepLine } from "@haibun/core/lib/steps/derivations/named-vars.js";
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";
import { VERDICT, type TActionResult, type TStepResult } from "@haibun/core/lib/domains/protocol.js";
import { actionNotOK, actionOKWithProducts } from "@haibun/core/lib/domains/util.js";
import { itemAt, valueAt } from "@haibun/core/lib/domains/item-at.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { actingAs } from "@haibun/core/lib/domains/capability-context.js";
import { DOMAIN_DOMAIN_KEY, refTargetOf } from "@haibun/core/lib/domains/domains.js";
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import { ACTUALITY_FIELD, SEQ_PATH_FIELD, actualityFeatureOf, factIdOf, producingStepRecord, stepRecordOf } from "@haibun/core/lib/actuality/domains/seq-path.js";
import {
	AffordancesSchema,
	ChainWalkSchema,
	GoalResolutionSchema,
	WALK_STATUS,
	providesWaypoints,
	type TGoalResolution,
	type TLintFinding,
} from "@haibun/core/lib/domains/goal-resolution.js";
import {
	argumentsOf,
	compositeRanges,
	FACTS_HELD,
	forwardOf,
	isTrivial,
	planOf,
	producerRules,
	stepGraph,
	stepSignatures,
	unmetReason,
	type THeldFact,
} from "../derivations/goals.js";
import { DIFFERENT_BUILDS, EFFECT, type TReadRequest } from "../domains/logic.js";
import { atom, factsTerm, list } from "../derivations/terms.js";
import type { TLogicEngine } from "../ports.js";
import { proved } from "./prove.js";
import { readerOf, writeFacts } from "./reads.js";

/** What a goal's proof reads: the context whose steps and domains state the rules and whose store holds the facts, the engine,
 *  what the caller holds, and the name of the logic engine's stepper, whose steps a proof calls. */
export type TGoalScope = { ctx: DispatchContext; engine: TLogicEngine; held: string | string[] | undefined; stepper: string };

const storeOf = ({ ctx }: TGoalScope): IQuadStore => ctx.world.shared.getStore();

/** Proves each goal over the products of steps `facts` holds, and returns its resolution. */
async function resolutions(scope: TGoalScope, goals: readonly string[], facts: readonly THeldFact[]): Promise<TGoalResolution[]> {
	const { steppers, world } = scope.ctx;
	const signatures = stepSignatures(steppers);
	const byMethod = new Map(signatures.map((one) => [one.method, one]));
	const byDomain = Map.groupBy(facts, (fact) => fact.domain);
	const latest = new Map(facts.toReversed().map((fact) => [fact.domain, fact.id]));
	const ended = await proved(scope.engine, `goals(${producerRules(signatures, world.domains, scope.held)}, ${list(goals.map(atom))})`, ({ need, request }) => {
		if (need !== EFFECT.read) return Promise.reject(new Error(`A proof of goals makes a request besides a read of facts. ${DIFFERENT_BUILDS}`));
		const { patterns } = request as TReadRequest;
		// A proof of goals reads the products of steps, which the reader read as records, latest first.
		if (patterns.some((pattern) => pattern.predicate !== FACTS_HELD.predicate || pattern.namedGraph !== FACTS_HELD.namedGraph))
			return Promise.reject(new Error(`A proof of goals reads a pattern besides the products of steps. ${DIFFERENT_BUILDS}`));
		const held = facts.toReversed().map(({ id, domain }) => ({ subject: id, predicate: FACTS_HELD.predicate, object: domain, namedGraph: FACTS_HELD.namedGraph }));
		return Promise.resolve(
			factsTerm(
				patterns,
				patterns.map(() => held),
			),
		);
	});
	if (!("goals" in ended)) throw new Error(`A proof of goals ended without the proof of each goal. ${DIFFERENT_BUILDS}`);
	return ended.goals.map((proof) => {
		const plans = proof.plans.map((plan) => planOf(plan, byMethod, latest));
		const verdict = proof.held ? VERDICT.proved : plans.length > 0 ? VERDICT.unknown : VERDICT.refuted;
		const unmet = verdict === VERDICT.refuted ? { unmet: unmetReason(proof), unmetChain: proof.unmet.map((node) => ("do" in node ? node.domain : node.unmet)) } : {};
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
 *  asserted its fact, then the goal's statement. A refuted goal's first unproved sub-goal is proved under the step, so the
 *  sub-goal's record states why. */
export async function resolved(scope: TGoalScope, parent: TFeatureStep, goal: string, pattern: string): Promise<TActionResult> {
	const resolution = await resolutionOf(scope, goal);
	if (resolution.verdict === VERDICT.refuted) {
		const unmet = resolution.unmetChain?.at(-1);
		if (unmet !== undefined && unmet !== goal) await proveUnder(scope.ctx, parent, stepMethodName(scope.stepper, "resolve"), { goal: unmet });
		return actionNotOK(`\`${parent.in}\` doesn't hold: ${unmetOf(resolution)}`);
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
	if (supplied.length > 0)
		return actionNotOK(`\`${parent.in}\` needs ${supplied.join(", ")} from the caller, which its plan takes. Supply each through \`walk toward "${goal}"\`.`);
	for (const step of plan.steps) {
		const { result } = await proveUnder(scope.ctx, parent, stepMethodName(step.stepperName, step.stepName), {});
		if (!result.ok) return actionNotOK(`\`${parent.in}\` stopped at \`${result.in}\`, which failed: ${result.errorMessage}`);
	}
	const again = await resolutionOf(scope, goal);
	if (again.verdict === VERDICT.proved) return actionOKWithProducts(again);
	return actionNotOK(`The steps of the plan for \`${parent.in}\` passed, and a fact of ${goal} still doesn't hold. Declare ${goal} as the products of the plan's last step.`);
}

/** The graph that holds each walk's facts. */
const WALK_GRAPH = "walk";
const WALK = { goal: "goal", owner: "owner", factIds: "factIds" } as const;

/** A walk's facts: its goal, the principal that began it, where one did, and the facts its calls asserted. */
type TWalk = { goal: string; owner?: string; factIds: string[] };

/** Writes a walk's facts in place of the facts it held, at the read level of its caller, so its owner reads them back. */
async function writeWalk(store: IQuadStore, walk: string, { goal, owner, factIds }: TWalk): Promise<void> {
	await store.remove({ subject: walk, namedGraph: WALK_GRAPH });
	await writeFacts(store, walk, WALK_GRAPH, { [WALK.goal]: goal, [WALK.factIds]: factIds, [WALK.owner]: owner });
}

/** Reads a walk's facts. Refuses a walk the store doesn't hold. */
async function readWalk(store: IQuadStore, walk: string): Promise<TWalk> {
	const held = new Map((await readerOf(store).facts({ subject: walk, namedGraph: WALK_GRAPH })).map(({ predicate, object }) => [predicate, object]));
	const [goal, owner, factIds] = [WALK.goal, WALK.owner, WALK.factIds].map((predicate) => held.get(predicate));
	if (typeof goal !== "string" || !Array.isArray(factIds))
		throw new Error(`The store doesn't hold the walk ${walk}. Begin a walk with \`walk toward\` and its goal, and advance the walk it returns.`);
	return { goal, factIds: factIds.map(String), ...(typeof owner === "string" ? { owner } : {}) };
}

/** A walk's products: the step its next advance calls and the parameters that step takes, from its goal's plan as it holds now. */
async function walkProducts(scope: TGoalScope, line: string, walk: string, goal: string, factIds: string[]): Promise<TActionResult> {
	const resolution = await resolutionOf(scope, goal);
	const next = resolution.verdict === VERDICT.proved ? undefined : resolution.plans[0]?.steps[0];
	if (resolution.verdict === VERDICT.refuted || (resolution.verdict === VERDICT.unknown && next === undefined))
		return actionNotOK(`\`${line}\` can't reach ${goal}: ${unmetOf(resolution)}`);
	if (next === undefined) return actionOKWithProducts(ChainWalkSchema.parse({ walk, goal, status: WALK_STATUS.ended, needs: [], factIds }));
	const method = stepMethodName(next.stepperName, next.stepName);
	const needs = [...scope.ctx.registry.named(method).paramDomainKeys.keys()];
	return actionOKWithProducts(ChainWalkSchema.parse({ walk, goal, status: WALK_STATUS.running, next: method, needs, factIds }));
}

/** Begins a walk toward a goal that isn't proved, under the principal that begins it, named by the record of the step. */
export async function walkBegun(scope: TGoalScope, parent: TFeatureStep, goal: string): Promise<TActionResult> {
	if ((await resolutionOf(scope, goal)).verdict === VERDICT.proved)
		return actionNotOK(`\`${parent.in}\` doesn't need a walk: a fact of ${goal} already holds. Read it with \`resolve "${goal}"\`.`);
	const walk = stepRecordOf(scope.ctx.world.tag, parent.seqPath);
	const owner = actingAs();
	await writeWalk(storeOf(scope), walk, { goal, factIds: [], ...(owner === undefined ? {} : { owner }) });
	return await walkProducts(scope, parent.in, walk, goal, []);
}

/** Proves the next step of a walk's plan, as it holds now, under the step with the values given, and holds the fact it asserted.
 *  Refuses a caller other than the principal that began the walk. */
export async function walkAdvanced(scope: TGoalScope, parent: TFeatureStep, walk: string, args: Record<string, unknown>): Promise<TActionResult> {
	const store = storeOf(scope);
	const held = await readWalk(store, walk);
	if (held.owner !== actingAs()) {
		const began = held.owner === undefined ? "a caller without a principal" : held.owner;
		return actionNotOK(`\`${parent.in}\` advances a walk that ${began} began. Begin a walk of your own with \`walk toward "${held.goal}"\`.`);
	}
	const resolution = await resolutionOf(scope, held.goal);
	const next = resolution.plans[0]?.steps[0];
	if (resolution.verdict !== VERDICT.unknown || next === undefined) return await walkProducts(scope, parent.in, walk, held.goal, held.factIds);
	const { result, fact } = await proveUnder(scope.ctx, parent, stepMethodName(next.stepperName, next.stepName), args);
	if (!result.ok) return actionNotOK(`\`${parent.in}\` stopped at \`${result.in}\`, which failed: ${result.errorMessage}`);
	const factIds = [...held.factIds, fact];
	await writeWalk(store, walk, { ...held, factIds });
	return await walkProducts(scope, parent.in, walk, held.goal, factIds);
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
		if (resolution.verdict !== VERDICT.refuted && isTrivial(resolution.plans)) return [];
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
export async function affordancesAt(scope: TGoalScope, parent: TFeatureStep, asOf: readonly number[] | undefined): Promise<TActionResult> {
	const waypointers = asOf === undefined ? scope.ctx.steppers.filter(providesWaypoints) : [];
	const waypoints = (await Promise.all(waypointers.map((stepper) => stepper.waypointEntries(parent)))).flat();
	const findings = lintFindings(scope.engine, scope.ctx.steppers, scope.ctx.world.domains);
	return actionOKWithProducts(AffordancesSchema.parse({ ...(await snapshotOf(scope, asOf)), waypoints, findings }));
}

/** The step graph's lint findings, as queries over the steps' signatures and the domains. */
export const lintFindings = (engine: TLogicEngine, steppers: readonly AStepper[], domains: Record<string, TRegisteredDomain>): TLintFinding[] =>
	engine.lint(stepGraph(stepSignatures(steppers), domains));
