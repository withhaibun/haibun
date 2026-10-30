/**
 * Proves a step through the logic engine. A line's term is the formula its step reads as: a built-in call, or a reading
 * over the terms of the statements it states. One query starts the line's proof. Where the proof reaches an effect, this
 * pipeline performs the effect and resumes the proof with its outcome: a built-in call through step dispatch, the opening
 * and closing of a node's record, a read of facts, a waypoint's rule, a waypoint's proof on the reasoner, and a wait of until. A
 * built-in runs once for its position in the proof, which fixes its step, its arguments and the capability it runs under. A call
 * runs in the waypoint scope of its position: the keys of the applications above it, across the proofs that nest it, and how many
 * waypoint sessions enclose it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { ClaimWitnessSchema } from "@haibun/core/lib/records/domains/axioms.js";
import type { DispatchContext } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import { dispatchStep, nextSeqPath, proveStep, runAsDispatched } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import type { TProver } from "@haibun/core/lib/actuality/ports.js";
import { findFeatureStepsFromStatement } from "@haibun/core/lib/actuality/pipelines/resolver.js";
import { argumentsOf } from "@haibun/core/lib/steps/pipelines/populate-action-args.js";
import { VERDICT, verdictOf, type TActionResult, type TStepArgs, type TStepResult, type TVerdict } from "@haibun/core/lib/domains/protocol.js";
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import { refusalCarried, type TRemedy } from "@haibun/core/lib/rpc-wire.js";
import {
	hasCycles,
	READING,
	UNTIL_DURATION,
	untilWithoutDuration,
	type TCallContext,
	type TFeatureStep,
	type TObserved,
	type TWaypointRule,
} from "@haibun/core/lib/steps/domains/stepper.js";
import { matchesQuadPattern, type TQuadPattern } from "@haibun/core/lib/steps/domains/quad-types.js";
import { formatSeqPath, stepRecordOf } from "@haibun/core/lib/actuality/domains/seq-path.js";
import type { TStepInput } from "@haibun/core/lib/actuality/domains/actuality.js";
import {
	CALL_OUTCOME,
	DIFFERENT_BUILDS,
	EFFECT,
	READ_GRAPH,
	READ_PREDICATE,
	type TFact,
	type TProofState,
	type TBinding,
	type TCloseRequest,
	type TNodeRequest,
	type TArgsBinding,
	type TReadRequest,
	type TWaypointEffect,
} from "../domains/logic.js";
import { quantifierOf, statementList, statementParams, UNTIL_RETRY_MS, type TRefusal } from "../domains/readings.js";
import { atom, factsTerm, list, whyText } from "../derivations/terms.js";
import type { TLogicEngine, TReasoner } from "../ports.js";
import { containment } from "./containment.js";
import { entailedMembers } from "./members.js";
import { canonicalOf, readerOf } from "./reads.js";
import { waypointProof, type TApplied, type TProofLine, type TWaypointHost, type TWaypointRequest, type TWaypointScope } from "./waypoints.js";

/** The waypoint scope of the code that runs now, which a call of a proof sets for the proofs it nests. */
const waypointScope = new AsyncLocalStorage<TWaypointScope>();
/** The scope outside any application. */
const OUTSIDE: TWaypointScope = { ancestors: [], sessions: 0 };
/** The verdict of each outcome of a call. */
const CALL_VERDICT: Record<string, TVerdict | undefined> = {
	[CALL_OUTCOME.passed]: VERDICT.proved,
	[CALL_OUTCOME.failed]: VERDICT.refuted,
	[CALL_OUTCOME.refused]: VERDICT.unknown,
};

/** A node of a line's proof: the step it states, and the variable a quantifier binds. */
type TNode = { step: TFeatureStep; what?: string };
/** A node whose record is open: the node, its step, the result its proof resolves, its dispatch, and when it opened. */
type TOpened = { node: string; step: TFeatureStep; close: (result: TActionResult) => void; dispatched: Promise<TStepResult>; at: number };

const keyOf = (path: readonly number[]): string => path.join(".");

/** The error where a proof reaches a request or a result the prover doesn't hold. Its message names the line's proof. */
class DifferentBuilds extends Error {}

/** The steps a line's text resolves to, each stated at the line's source where the text is one step. A text that expands a
 *  background states each background line's source. */
const statedAt = (steps: TFeatureStep[], source: TFeatureStep["source"]): TFeatureStep[] =>
	steps.length === 1 && source !== undefined ? steps.map((step) => ({ ...step, source })) : steps;

/** Where a proof of a step's statements places them: the path segment each statement takes under the step, in order, and the
 *  host whose steps prove them, where another host does. */
type TPlaced = { segments: number[]; targetHostId?: number };

/** One line's proof: its nodes, the results of its calls and nodes by position, the contexts it opened, the facts of the
 *  observation sources its quantifiers read, and its reads. */
class Proof {
	private readonly nodes = new Map<string, TNode>();
	private readonly rules = new Map<string, TWaypointRule>();
	private readonly results = new Map<string, TStepResult>();
	/** The products of the last result under each position, where that result holds products. */
	private readonly productsUnder = new Map<string, Record<string, unknown>>();
	private readonly opened = new Map<string, TOpened>();
	private readonly contexts = new Map<string, TCallContext>();
	/** The arguments each open node read when it opened, by position. */
	private readonly argsAt = new Map<string, TStepArgs>();
	/** The facts of each quantifier's observation source by their item, by the quantifier's node. */
	private readonly observed = new Map<string, Map<string, TObserved[]>>();
	/** The key of each application the proof opened, its head with the arguments it read, by its position. */
	private readonly keys = new Map<string, string>();
	/** The lines of each waypoint's proof a session read, by its head. */
	private readonly proofLines = new Map<string, readonly TProofLine[]>();
	/** The waypoint scope of the line's proof. */
	private readonly enclosing: TWaypointScope;
	private readonly reader;

	constructor(
		private readonly ctx: DispatchContext,
		private readonly reasoner: TReasoner,
		private readonly line: TFeatureStep,
		private readonly placed?: TPlaced,
	) {
		this.reader = readerOf(ctx.world.shared.getStore());
		const scope = waypointScope.getStore();
		this.enclosing = scope === undefined ? OUTSIDE : scope;
	}

	private add(node: TNode): string {
		const id = `n${this.nodes.size + 1}`;
		this.nodes.set(id, node);
		return id;
	}

	private node(id: string): TNode {
		const node = this.nodes.get(id);
		if (node === undefined) throw this.differentBuilds("reaches a part it didn't build");
		return node;
	}

	/** Resolves a statement's text to its steps, as a statement parameter is resolved. */
	private statementSteps(text: string, step: TFeatureStep): TFeatureStep[] {
		return statedAt(findFeatureStepsFromStatement(text, this.ctx.steppers, this.ctx.world, step.source?.path, [...step.seqPath, 0]), step.source);
	}

	private async listOf(steps: TFeatureStep[]): Promise<string> {
		return list(await Promise.all(steps.map((step) => this.termOf(step))));
	}

	/** The term of a step: a call of a built-in, or its reading over the terms of its statements. A term holds only what the line
	 *  writes, so building it doesn't read a variable or a record. A node reads its arguments when it opens. */
	async termOf(step: TFeatureStep): Promise<string> {
		const declared = step.action.step;
		const { reading } = declared;
		if (reading === undefined) return `call(${this.add({ step })})`;
		if (reading === READING.apply) {
			const { rule } = declared;
			if (rule === undefined) throw new Error(`\`${step.in}\` doesn't match a waypoint's head. State a line that matches one, or ensure the waypoint by its head.`);
			this.rules.set(rule.head, rule);
			return `${reading}(${this.add({ step })}, ${atom(rule.head)})`;
		}
		if (reading === READING.anyOf) {
			const alternatives = await Promise.all(statementList(writtenTerm(step, "alternatives")).map((text) => this.listOf(this.statementSteps(text, step))));
			return `${reading}(${this.add({ step })}, ${list(alternatives)})`;
		}
		const what = reading === READING.some || reading === READING.every ? writtenTerm(step, "what") : undefined;
		const statements = await Promise.all(statementParams(declared).map((name) => this.listOf(this.statementSteps(writtenTerm(step, name), step))));
		return `${reading}(${[this.add({ step, what }), ...statements].join(", ")})`;
	}

	/** The step a node states at a position of the proof, with the arguments its bindings supply. */
	private instance(node: TNode, path: readonly number[], bindings: TBinding[]): TFeatureStep {
		if (path.length === 0) return this.line;
		const runtimeArgs = this.runtimeArgsOf(bindings);
		const { line, placed } = this;
		const [first, ...rest] = path;
		const seqPath = placed === undefined || first === undefined ? [...line.seqPath, ...path] : [...line.seqPath, itemAt(placed.segments, first - 1), ...rest];
		return {
			...node.step,
			seqPath,
			isSubStep: true,
			...(placed?.targetHostId === undefined ? {} : { targetHostId: placed.targetHostId }),
			source: node.step.source === undefined ? line.source : node.step.source,
			...(Object.keys(runtimeArgs).length === 0 ? {} : { runtimeArgs }),
			...(line.programmatic === true ? { programmatic: true } : {}),
		};
	}

	/** The arguments a call reads from its bindings, outermost first, over the line's own: each waypoint's arguments, and each
	 *  quantifier's member with each function of the member its source's facts state, as `variable/function`. */
	private runtimeArgsOf(bindings: TBinding[]): Record<string, string | number> {
		const args: Record<string, string | number> = { ...this.line.runtimeArgs };
		for (const binding of [...bindings].reverse()) {
			if ("member" in binding) {
				const { what } = this.node(binding.node);
				if (what === undefined) throw this.differentBuilds("gives a value to a variable outside the line's quantifiers");
				args[what] = binding.member;
				const facts = this.observed.get(binding.node)?.get(binding.member);
				for (const { predicate, object } of facts === undefined ? [] : facts) args[`${what}/${predicate}`] = typeof object === "number" ? object : String(object);
			} else if ("args" in binding) for (const { name, value } of binding.args) args[name] = value;
		}
		return args;
	}

	/** Runs a call inside each context its bindings name, outermost first. */
	private withinContexts<T>(bindings: TBinding[], run: () => Promise<T>): Promise<T> {
		const contexts = bindings.flatMap((binding) => ("within" in binding ? [this.contextAt(binding.within)] : []));
		return contexts.reduce<() => Promise<T>>((inner, context) => () => context(inner), run)();
	}

	private contextAt(path: readonly number[]): TCallContext {
		const context = this.contexts.get(keyOf(path));
		if (context === undefined) throw this.differentBuilds("runs a call inside a context it didn't open");
		return context;
	}

	/** Performs the effect a query needs, and returns its outcome as the engine reads it. */
	async perform(need: Extract<TProofState, { need: string }>): Promise<string> {
		const { path, request } = need;
		if (need.need === EFFECT.call) return await this.call(path, request as TNodeRequest);
		if (need.need === EFFECT.open) return await this.open(path, request as TNodeRequest);
		if (need.need === EFFECT.close) return await this.close(path, request as TCloseRequest);
		if (need.need === EFFECT.read) return await this.read(path, request as TReadRequest);
		if (need.need === EFFECT.rule) return await this.rule(path, (request as { rule: string }).rule);
		if (need.need === EFFECT.waypoint) return await this.waypoint(path, request as TWaypointEffect);
		if (need.need === EFFECT.wait) return await this.wait(path, request as { node: string });
		throw this.differentBuilds("makes a request the TypeScript prover doesn't handle");
	}

	/** The error where the proof of the line reaches what the prover doesn't hold, as `what` states it. */
	private differentBuilds(what: string): DifferentBuilds {
		return new DifferentBuilds(`The proof of \`${this.line.in}\` ${what}. ${DIFFERENT_BUILDS}`);
	}

	private call(path: number[], request: TNodeRequest): Promise<string> {
		return this.callIn(path, request, this.scopeAt(path), () => dispatchStep(this.ctx, this.instance(this.node(request.node), path, request.bindings)));
	}

	/** Performs a call in a waypoint scope inside the contexts its bindings name, and holds its result at its position. */
	private async callIn(path: readonly number[], request: TNodeRequest, scope: TWaypointScope, proving: () => Promise<TStepResult>): Promise<string> {
		try {
			return this.held(path, await waypointScope.run(scope, () => this.withinContexts(request.bindings, proving)));
		} catch (caught) {
			return this.refused(path, this.instance(this.node(request.node), path, request.bindings), caught);
		}
	}

	/** The verdict of a line of a waypoint's proof that isn't a head: a built-in's call, or a reading's proof of its own. */
	private async lineVerdict(path: readonly number[], request: TNodeRequest, scope: TWaypointScope): Promise<TVerdict> {
		const step = this.instance(this.node(request.node), path, request.bindings);
		if (step.action.step.reading === undefined) {
			const verdict = CALL_VERDICT[await this.callIn(path, request, scope, () => dispatchStep(this.ctx, step))];
			if (verdict === undefined) throw this.differentBuilds("calls a step whose outcome the prover doesn't read");
			return verdict;
		}
		let result: TStepResult | undefined;
		await this.callIn(path, request, scope, async () => {
			result = await proveStep(this.ctx, step);
			return result;
		});
		return result === undefined ? VERDICT.unknown : verdictOf(result);
	}

	/** The waypoint scope at a position: the enclosing scope's ancestors with the keys of the applications above the position. */
	private scopeAt(path: readonly number[]): TWaypointScope {
		const above = path.flatMap((_, depth) => {
			const key = this.keys.get(keyOf(path.slice(0, depth)));
			return key === undefined ? [] : [key];
		});
		return { ancestors: [...this.enclosing.ancestors, ...above], sessions: this.enclosing.sessions };
	}

	/** Holds a call's refusal as an unknown outcome. A refusal of the line's own call reaches the line's caller, as a transport
	 *  reports a refused call. */
	private refused(path: readonly number[], step: TFeatureStep, caught: unknown): string {
		if (path.length === 0) throw caught;
		const remedy = refusalCarried(caught)?.remedy;
		const result = { ok: false as const, errorMessage: errorDetail(caught), name: step.action.actionName, in: step.in, seqPath: step.seqPath, verdict: VERDICT.unknown };
		this.hold(path, remedy === undefined ? result : { ...result, remedy });
		return CALL_OUTCOME.refused;
	}

	private held(path: readonly number[], result: TStepResult): string {
		this.hold(path, result);
		return result.ok ? CALL_OUTCOME.passed : CALL_OUTCOME.failed;
	}

	/** Holds a result at its position, and its products as the last products under each position above it. */
	private hold(path: readonly number[], result: TStepResult): void {
		this.results.set(keyOf(path), result);
		for (let depth = 0; depth < path.length; depth++) {
			const above = keyOf(path.slice(0, depth));
			if (result.products === undefined) this.productsUnder.delete(above);
			else this.productsUnder.set(above, result.products);
		}
	}

	private async open(path: number[], request: TNodeRequest): Promise<string> {
		const node = this.node(request.node);
		const step = this.instance(node, path, request.bindings);
		// A node reads its arguments and opens its context inside the contexts that enclose it, so a statement holds less than its
		// caller, and never more.
		const opening = await this.withinContexts(request.bindings, () => runAsDispatched(this.ctx, () => this.contextOf(node, step))).catch((caught: unknown) => ({
			refused: errorDetail(caught),
		}));
		const begun = Promise.withResolvers<"begun">();
		const closed = Promise.withResolvers<TActionResult>();
		const dispatched = this.withinContexts(request.bindings, () =>
			dispatchStep(this.ctx, step, () => {
				begun.resolve("begun");
				return "refused" in opening ? Promise.resolve({ ok: false, errorMessage: opening.refused, verdict: VERDICT.unknown }) : closed.promise;
			}),
		);
		let first: "begun" | "ended";
		try {
			first = await Promise.race([begun.promise, dispatched.then(() => "ended" as const)]);
		} catch (caught) {
			return this.refused(path, step, caught);
		}
		if (first === "ended" || "refused" in opening) {
			this.hold(path, await dispatched);
			return CALL_OUTCOME.refused;
		}
		this.contexts.set(keyOf(path), opening.context);
		this.argsAt.set(keyOf(path), opening.args);
		this.opened.set(keyOf(path), { node: request.node, step, close: closed.resolve, dispatched, at: this.ctx.world.clock.now() });
		return "opened";
	}

	/** A node's arguments and the context it opens: a step that reads as within opens its own, and every other node runs its
	 *  calls as they are. */
	private async contextOf(node: TNode, step: TFeatureStep): Promise<{ context: TCallContext; args: TStepArgs } | { refused: string }> {
		const read = await argumentsOf(step, this.ctx.world, this.ctx.steppers);
		if ("refused" in read) return read;
		const { context } = node.step.action.step;
		if (context === undefined) return { context: (run) => run(), args: read.args };
		const opened = await context(read.args, step);
		return "refused" in opened ? opened : { context: opened, args: read.args };
	}

	/** The arguments the node at a position read when it opened. */
	private openedArgs(path: readonly number[]): TStepArgs {
		const args = this.argsAt.get(keyOf(path));
		if (args === undefined) throw this.differentBuilds("reads the values of a step it didn't open");
		return args;
	}

	private async close(path: number[], request: TCloseRequest): Promise<string> {
		const opened = this.opened.get(keyOf(path));
		if (opened === undefined) throw this.differentBuilds("ends a step it didn't open");
		const products = request.verdict === VERDICT.proved ? this.productsOf(path, request.node) : undefined;
		opened.close(
			request.verdict === VERDICT.proved
				? { ok: true, verdict: request.verdict, ...(products === undefined ? {} : { products }) }
				: { ok: false, verdict: request.verdict, errorMessage: this.why(path, request, opened.step), ...this.remedyOf(request) },
		);
		this.hold(path, await opened.dispatched);
		return "closed";
	}

	/** The products of a node that holds: maybe's verdict, with why its statement didn't hold where it didn't, why the statement
	 *  under didn't failed, and otherwise the products of its statements. */
	private productsOf(path: readonly number[], node: string): Record<string, unknown> | undefined {
		const { reading } = this.node(node).step.action.step;
		if (reading !== READING.maybe && reading !== READING.didnt) return this.productsUnder.get(keyOf(path));
		const last = this.lastPart(path);
		if (reading === READING.maybe) return { verdict: verdictOf(last), ...(last.ok ? {} : refusalOf(last)) };
		if (last.ok) throw this.differentBuilds("holds not over a statement that held");
		return refusalOf(last);
	}

	/** The remedy of the part that determined a node's verdict, where that part carries one, so a refusal's type reaches the line. */
	private remedyOf({ why }: TCloseRequest): { remedy?: TRemedy } {
		const part = Array.isArray(why) ? this.results.get(keyOf(why)) : undefined;
		return part === undefined || part.ok || part.remedy === undefined ? {} : { remedy: part.remedy };
	}

	/** Why a node's verdict isn't proved: the part that determined it, with that part's own reason, the record that stated its
	 *  falsity with the node's own record where its proof holds as well, or the reason the engine states. */
	private why(path: readonly number[], request: TCloseRequest, step: TFeatureStep): string {
		const { node, verdict, why } = request;
		const line = this.node(node).step.in;
		if (why === "expired") return `\`${line}\` is ${verdict}: its statements didn't hold within ${durationOf(step, this.openedArgs(path))}ms`;
		if (typeof why === "string") return whyText(line, verdict, why);
		if (!Array.isArray(why)) {
			const proved = verdict === VERDICT.contradiction ? `, and its proof at ${stepRecordOf(this.ctx.world.tag, step.seqPath)} holds` : "";
			return `\`${line}\` is ${verdict}: the record ${why.falsity} states it is absent${proved}`;
		}
		const part = this.results.get(keyOf(why));
		if (part === undefined) return `\`${line}\` is ${verdict}`;
		return `\`${line}\` is ${verdict}, since \`${part.in}\` is ${verdictOf(part)}${part.ok ? "" : `: ${part.errorMessage}`}`;
	}

	/** The result of a node's last part, at which the proof of its statements ended. */
	private lastPart(path: readonly number[]): TStepResult {
		let at = 1;
		while (this.results.has(keyOf([...path, at + 1]))) at += 1;
		const part = this.results.get(keyOf([...path, at]));
		if (part === undefined) throw this.differentBuilds("ends a step without the result of its last part");
		return part;
	}

	/** Performs a read inside each context its bindings name, under the authority and read scope of a dispatched step. A pattern
	 *  of the node graph reads a node's own facts, and every other pattern the store's facts through the proof's reader. Returns
	 *  the values each pattern's variables take in each fact that holds its constants, or the read's refusal. */
	private async read(path: readonly number[], { patterns, bindings }: TReadRequest): Promise<string> {
		const factsOf = async (pattern: TQuadPattern): Promise<TFact[]> =>
			pattern.namedGraph === READ_GRAPH.node
				? (await this.nodeFacts(path, pattern)).filter((fact) => matchesQuadPattern({ ...fact, timestamp: 0 }, pattern))
				: this.reader.facts(pattern);
		try {
			return factsTerm(patterns, await this.withinContexts(bindings, () => runAsDispatched(this.ctx, () => Promise.all(patterns.map(factsOf)))));
		} catch (caught) {
			return `refused(${atom(errorDetail(caught))})`;
		}
	}

	/** A node's own facts: a waypoint's arguments as it read them when it opened, each individual as its canonical
	 *  representative, and a quantifier's members, the values of its domain or the items its observation source's facts state. */
	private async nodeFacts(path: readonly number[], { subject: id }: TQuadPattern): Promise<TFact[]> {
		if (id === undefined) throw this.differentBuilds("reads the facts of a step without naming the step");
		const fact = (predicate: string, object: unknown): TFact => ({ subject: id, predicate, object, namedGraph: READ_GRAPH.node });
		if (this.node(id).step.action.step.reading === READING.apply) {
			const canonical = await canonicalOf(this.reader);
			return Object.entries(this.openedArgs(path)).map(([name, value]) => fact(name, canonical(String(value))));
		}
		const quantifier = quantifierOf(this.openedArgs(path));
		const { world, steppers } = this.ctx;
		if ("domain" in quantifier) {
			const found = await world.shared.getDomainValues(quantifier.domain);
			if (found.error !== undefined) throw new Error(found.error);
			return found.values.map((value) => fact(READ_PREDICATE.member, value));
		}
		const sources = steppers.flatMap((stepper) => {
			const declared = hasCycles(stepper) ? stepper.cycles.getConcerns?.().sources : undefined;
			return declared === undefined ? [] : declared;
		});
		const source = sources.find((one) => one.name.toLowerCase() === quantifier.source.toLowerCase());
		if (source === undefined)
			throw new Error(`\`${this.node(id).step.in}\` reads the observation source "${quantifier.source}", which the steppers don't declare. Declare it in a stepper's concerns.`);
		const byItem = Map.groupBy(await source.observe(world), ({ subject }) => subject);
		this.observed.set(id, byItem);
		return [...byItem.keys()].map((item) => fact(READ_PREDICATE.member, item));
	}

	/** A waypoint's rule as the line's proof reads it: whether it states a proof, its activity, and `cycle` where its key, its head
	 *  with the arguments its application read, is the key of an application above it, or `none`. */
	private async rule(path: readonly number[], name: string): Promise<string> {
		const rule = this.ruleOf(name);
		const key = await this.keyOf(path, name);
		const bound = this.scopeAt(path).ancestors.includes(key) ? "cycle" : "none";
		return `rule(${rule.proof.length > 0}, ${await this.linesTerm(rule.activity)}, ${bound})`;
	}

	private ruleOf(head: string): TWaypointRule {
		const rule = this.rules.get(head);
		if (rule === undefined) throw this.differentBuilds(`requests the rule of the waypoint "${head}", which the line doesn't apply`);
		return rule;
	}

	/** The key of the application at a position, its head with the arguments it read, which the proof then holds by the position. */
	private async keyOf(path: readonly number[], head: string): Promise<string> {
		// A key is a string the rules compare, so its JSON is encoded to the characters an N3 string holds without escapes.
		const key = encodeURIComponent(JSON.stringify([head, await this.openedArgsOf(path)]));
		this.keys.set(keyOf(path), key);
		return key;
	}

	/** The arguments the application at a position read, each as its canonical individual, as a binding of its node. */
	private async openedArgsOf(path: readonly number[]): Promise<{ name: string; value: string }[]> {
		const canonical = await canonicalOf(this.reader);
		return Object.entries(this.openedArgs(path)).map(([name, value]) => ({ name, value: canonical(String(value)) }));
	}

	/** Proves what a waypoint effect requests on the reasoner, through this proof's effects. */
	private async waypoint(path: readonly number[], effect: TWaypointEffect): Promise<string> {
		const { mode, node, bindings, base, group, given } = effect;
		const { rule } = this.node(node).step.action.step;
		if (rule === undefined) throw this.differentBuilds("requests the proof of a waypoint that a node doesn't apply");
		const key = this.keys.get(keyOf(path));
		const opened: TApplied | undefined = key === undefined ? undefined : { key, binding: { node, args: await this.openedArgsOf(path) } };
		const request: TWaypointRequest = {
			mode,
			node,
			head: rule.head,
			bindings,
			base,
			group,
			...(opened === undefined ? {} : { opened }),
			...(given === undefined ? {} : { given }),
		};
		return await waypointProof(this.reasoner, this.waypointHost(), path, request);
	}

	/** What a waypoint session performs through this proof. */
	private waypointHost(): TWaypointHost {
		return {
			lines: (head) => this.proofLinesOf(head),
			scope: (path) => this.scopeAt(path),
			open: async (path, node, bindings) => {
				if ((await this.open([...path], { node, bindings: [...bindings] })) !== "opened") return "refused";
				const { rule } = this.node(node).step.action.step;
				if (rule === undefined) throw this.differentBuilds("opens an application of a node that doesn't apply a waypoint");
				return { key: await this.keyOf(path, rule.head), binding: { node, args: await this.openedArgsOf(path) } };
			},
			call: (path, node, bindings, scope) => this.lineVerdict(path, { node, bindings: [...bindings] }, scope),
			close: async (path, node, verdict, why) => {
				await this.close([...path], { node, verdict, why });
			},
			falsities: (bindings, head, opened) => this.falsitiesOf(bindings, head, opened),
		};
	}

	/** The lines of a waypoint's proof, each a head its application applies or a step it calls, by a node of this proof. */
	private proofLinesOf(head: string): readonly TProofLine[] {
		const held = this.proofLines.get(head);
		if (held !== undefined) return held;
		const steps = this.ruleOf(head).proof.flatMap((input) =>
			statedAt(findFeatureStepsFromStatement(input.in, this.ctx.steppers, this.ctx.world, input.source.path, [0]), input.source),
		);
		const lines = steps.map((step): TProofLine => {
			const { rule } = step.action.step;
			if (step.action.step.reading !== READING.apply || rule === undefined) return { kind: "call", node: this.add({ step }) };
			this.rules.set(rule.head, rule);
			return { kind: "apply", node: this.add({ step }), head: rule.head };
		});
		this.proofLines.set(head, lines);
		return lines;
	}

	/** The records that state the falsity of a head with an application's arguments, read under its bindings' contexts. */
	private async falsitiesOf(bindings: readonly TBinding[], head: string, { args }: TArgsBinding): Promise<string[]> {
		const read = (pattern: TQuadPattern) => this.reader.facts({ ...pattern, namedGraph: READ_GRAPH.falsity });
		return await this.withinContexts([...bindings], () =>
			runAsDispatched(this.ctx, async () => {
				const stating = (await read({ predicate: READ_PREDICATE.head, object: head })).map(({ subject }) => subject);
				const held = await Promise.all(
					stating.map(async (record) =>
						(await Promise.all(args.map(async ({ name, value }) => (await read({ subject: record, predicate: name, object: value })).length > 0))).every(Boolean),
					),
				);
				return stating.filter((_, at) => held[at] === true);
			}),
		);
	}

	private async linesTerm(lines: TStepInput[]): Promise<string> {
		return await this.listOf(lines.flatMap((input) => statedAt(findFeatureStepsFromStatement(input.in, this.ctx.steppers, this.ctx.world, input.source.path, [0]), input.source)));
	}

	/** Waits once for an until whose statements don't hold yet. Throws where the node the engine names isn't the until open at
	 *  its position, since the engine and the proof then disagree about the proof. */
	private async wait(path: number[], request: { node: string }): Promise<string> {
		const opened = this.opened.get(keyOf(path));
		const { reading } = this.node(request.node).step.action.step;
		if (opened?.node !== request.node || reading !== READING.until) throw this.differentBuilds("tries again a step that doesn't read as until");
		const { clock } = this.ctx.world;
		if (clock.now() >= opened.at + durationOf(opened.step, this.openedArgs(path))) return "expired";
		await clock.wait(UNTIL_RETRY_MS);
		return "again";
	}

	/** The result of a step's statements: the result of the first that isn't proved, or of the last. */
	statementsResult(count: number): TStepResult {
		for (let position = 1; position <= count; position++) {
			const result = this.results.get(String(position));
			if (result === undefined) throw this.differentBuilds(`ends without the result of its statement ${position}`);
			if (!result.ok || position === count) return result;
		}
		throw this.differentBuilds("ends before its first statement");
	}

	/** Whether the line's own node is open, so a proof that stops ends the line's record with its cause. */
	lineOpen(): boolean {
		return this.opened.has(keyOf([])) && !this.results.has(keyOf([]));
	}

	/** Ends each record the proof left open when it stopped on an exception, innermost first, as unknown with the cause, which
	 *  names the line, and returns the cause. */
	async stopped(caught: unknown): Promise<string> {
		const errorMessage = caught instanceof DifferentBuilds ? caught.message : `The proof of \`${this.line.in}\` stopped: ${errorDetail(caught)}`;
		const depth = (key: string): number => (key === "" ? 0 : key.split(".").length);
		const open = [...this.opened.entries()].filter(([key]) => !this.results.has(key)).sort(([a], [b]) => depth(b) - depth(a));
		for (const [key, opened] of open) {
			opened.close({ ok: false, verdict: VERDICT.unknown, errorMessage });
			this.results.set(key, await opened.dispatched);
		}
		return errorMessage;
	}

	/** The line's result: the result of its own call, or of its node. */
	result(): TStepResult {
		const result = this.results.get("");
		if (result === undefined) throw this.differentBuilds("ends without the line's result");
		return result;
	}
}

/** The term a step's line writes for a parameter of a written domain, such as a statement or a quantifier's variable. */
function writtenTerm(step: TFeatureStep, name: string): string {
	const value = step.action.stepValuesMap?.[name];
	if (value === undefined)
		throw new Error(`\`${step.in}\` doesn't state {${name}}, which its step's reading proves. State it in the line, and in the step's pattern where the pattern doesn't take it.`);
	return value.term;
}

/** The length of time the line of an until states, in milliseconds, from the values its step read. */
function durationOf(step: TFeatureStep, args: TStepArgs): number {
	const ms = Number(args[UNTIL_DURATION]);
	if (!Number.isFinite(ms)) throw new Error(untilWithoutDuration(step.in));
	return ms;
}

/** The proofs the engine of this process has started, so each holds an id of its own until it completes. */
let proofs = 0;

/** Proves a term to its end, performing each effect it needs, and removes what the engine holds for it. Returns how it ended. */
export async function proved(engine: TLogicEngine, term: string, perform: (need: Extract<TProofState, { need: string }>) => Promise<string>): Promise<TProofState> {
	proofs += 1;
	const top = `q${proofs}`;
	try {
		let outcome = engine.prove(top, term);
		while ("need" in outcome) outcome = engine.resume(top, await perform(outcome));
		return outcome;
	} finally {
		engine.forget(top);
	}
}

/** Why a statement didn't hold: its failing step's error text and seqPath, the action the gate refused it for, where it did, and
 *  the witness a refused claim's products hold, where they hold one. */
function refusalOf(failed: TStepResult & { ok: false }): TRefusal {
	const witness = WitnessProductsSchema.safeParse(failed.products).data?.witness;
	return {
		refusal: failed.errorMessage,
		seqPath: formatSeqPath(failed.seqPath),
		...(failed.remedy?.do === "request" ? { lacksAction: failed.remedy.action } : {}),
		...(witness === undefined ? {} : { witness }),
	};
}

/** The products of a refused claim of subsumption, which hold its witness. */
const WitnessProductsSchema = z.object({ witness: ClaimWitnessSchema });

/** The prover of an engine, which proves a permission's containment through the reasoner. */
export function proverOf(engine: TLogicEngine, reasoner: TReasoner): TProver {
	return {
		exceeding: async (candidate, bound) => (await containment(reasoner, candidate, bound)).exceeds,
		entailed: (world, expression) => entailedMembers(reasoner, world.shared.getStore(), world.domains, world.runtime.records, expression),
		prove: async (ctx, line) => {
			const proof = new Proof(ctx, reasoner, line);
			let term: string;
			try {
				term = await proof.termOf(line);
			} catch (caught) {
				// A line whose term doesn't build ends unknown with the reason. Dispatch checks its caller's capability first,
				// so a call its caller may not make returns only its refusal.
				return await dispatchStep(ctx, line, () => Promise.resolve({ ok: false, errorMessage: errorDetail(caught), verdict: VERDICT.unknown }));
			}
			try {
				await proved(engine, term, (need) => proof.perform(need));
			} catch (caught) {
				// A refusal of the line's own call reaches the line's caller. An exception within a node the line opened fails the
				// line with its cause, and the features after it run.
				if (!proof.lineOpen()) throw caught;
				await proof.stopped(caught);
			}
			return proof.result();
		},
		proveStatements: async (ctx, parent, statements, targetHostId) => {
			if (statements.length === 0) return { ok: true };
			const segments = statements.map(() => itemAt(nextSeqPath(ctx.world, parent.seqPath), parent.seqPath.length));
			const proof = new Proof(ctx, reasoner, parent, { segments, ...(targetHostId === undefined ? {} : { targetHostId }) });
			let terms: string[];
			try {
				terms = await Promise.all(statements.map((statement) => proof.termOf(statement)));
			} catch (caught) {
				return { ok: false, errorMessage: errorDetail(caught), verdict: VERDICT.unknown };
			}
			try {
				await proved(engine, `all(${list(terms)})`, (need) => proof.perform(need));
			} catch (caught) {
				return { ok: false, errorMessage: await proof.stopped(caught), verdict: VERDICT.unknown };
			}
			return proof.statementsResult(statements.length);
		},
	};
}
