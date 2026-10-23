/**
 * Proves a step through the logic engine. A line's term is the formula its step reads as: a built-in call, or a reading
 * over the terms of the statements it states. One query starts the line's proof. Where the proof reaches an effect, this
 * pipeline performs the effect and resumes the proof with its outcome: a built-in call through step dispatch, the opening
 * and closing of a node's record, a read of facts, a waypoint's rule, and a wait of until. A built-in runs once for its
 * position in the proof, which fixes its step, its arguments and the capability it runs under.
 */
import type { DispatchContext } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import { dispatchStep, nextSeqPath, runAsDispatched } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import type { TProver } from "@haibun/core/lib/actuality/ports.js";
import { findFeatureStepsFromStatement } from "@haibun/core/lib/actuality/pipelines/resolver.js";
import { argumentsOf } from "@haibun/core/lib/steps/pipelines/populate-action-args.js";
import { VERDICT, verdictOf, type TActionResult, type TStepArgs, type TStepResult } from "@haibun/core/lib/domains/protocol.js";
import { errorDetail } from "@haibun/core/lib/domains/util.js";
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
import { stepRecordOf } from "@haibun/core/lib/actuality/domains/seq-path.js";
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
	type TReadRequest,
} from "../domains/logic.js";
import { quantifierOf, alternativesOf, statementParams, UNTIL_RETRY_MS } from "../domains/readings.js";
import { atom, factsTerm, list, whyText } from "../derivations/terms.js";
import type { TLogicEngine } from "../ports.js";
import { canonicalOf, readerOf } from "./reads.js";

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
	private readonly reader;

	constructor(
		private readonly ctx: DispatchContext,
		private readonly line: TFeatureStep,
		private readonly placed?: TPlaced,
	) {
		this.reader = readerOf(ctx.world.shared.getStore());
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
			const alternatives = await Promise.all(alternativesOf(writtenTerm(step, "alternatives")).map((text) => this.listOf(this.statementSteps(text, step))));
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
		if (need.need === EFFECT.rule) return await this.rule((request as { rule: string }).rule);
		if (need.need === EFFECT.wait) return await this.wait(path, request as { node: string });
		throw this.differentBuilds("makes a request the TypeScript prover doesn't handle");
	}

	/** The error where the proof of the line reaches what the prover doesn't hold, as `what` states it. */
	private differentBuilds(what: string): DifferentBuilds {
		return new DifferentBuilds(`The proof of \`${this.line.in}\` ${what}. ${DIFFERENT_BUILDS}`);
	}

	private async call(path: number[], request: TNodeRequest): Promise<string> {
		const step = this.instance(this.node(request.node), path, request.bindings);
		try {
			return this.held(path, await this.withinContexts(request.bindings, () => dispatchStep(this.ctx, step)));
		} catch (caught) {
			return this.refused(path, step, caught);
		}
	}

	/** Holds a call's refusal as an unknown outcome. A refusal of the line's own call reaches the line's caller, as a transport
	 *  reports a refused call. */
	private refused(path: readonly number[], step: TFeatureStep, caught: unknown): string {
		if (path.length === 0) throw caught;
		this.hold(path, { ok: false, errorMessage: errorDetail(caught), name: step.action.actionName, in: step.in, seqPath: step.seqPath, verdict: VERDICT.unknown });
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
		const products = this.node(request.node).step.action.step.reading === READING.maybe ? { verdict: verdictOf(this.lastPart(path)) } : this.productsUnder.get(keyOf(path));
		opened.close(
			request.verdict === VERDICT.proved
				? { ok: true, verdict: request.verdict, ...(products === undefined ? {} : { products }) }
				: { ok: false, verdict: request.verdict, errorMessage: this.why(path, request, opened.step) },
		);
		this.hold(path, await opened.dispatched);
		return "closed";
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

	private async rule(name: string): Promise<string> {
		const rule = this.rules.get(name);
		if (rule === undefined) throw this.differentBuilds(`requests the rule of the waypoint "${name}", which the line doesn't apply`);
		const { proof, activity } = rule;
		return `rule(${await this.linesTerm(proof)}, ${await this.linesTerm(activity)})`;
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

/** The prover of an engine. */
export function proverOf(engine: TLogicEngine): TProver {
	return {
		prove: async (ctx, line) => {
			const proof = new Proof(ctx, line);
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
			const proof = new Proof(ctx, parent, { segments, ...(targetHostId === undefined ? {} : { targetHostId }) });
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
