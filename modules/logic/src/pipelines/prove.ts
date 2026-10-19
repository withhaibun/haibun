/**
 * Proves a step through the logic engine. A line's term is the formula its step reads as: a built-in call, or a reading
 * over the terms of the statements it states. One query starts the line's proof. Where the proof reaches an effect, this
 * pipeline performs the effect and resumes the proof with its outcome: a built-in call through step dispatch, the opening
 * and closing of a node's record, a quantifier's members, a waypoint's arguments and rule, and a wait of until. A built-in
 * runs once for its position in the proof, which fixes its step, its arguments and the capability it runs under.
 */
import type { DispatchContext } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import { dispatchStep, nextSeqPath, runAsDispatched } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import type { TProver } from "@haibun/core/lib/actuality/ports.js";
import { findFeatureStepsFromStatement } from "@haibun/core/lib/actuality/pipelines/resolver.js";
import { argumentsOf } from "@haibun/core/lib/steps/pipelines/populate-action-args.js";
import { VERDICT, type TActionResult, type TStepArgs, type TStepResult } from "@haibun/core/lib/domains/protocol.js";
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import { hasCycles, READING, type TCallContext, type TFeatureStep, type TStepperStep } from "@haibun/core/lib/steps/domains/stepper.js";
import type { TStepInput } from "@haibun/core/lib/actuality/domains/execution.js";
import { CALL_OUTCOME, EFFECT, type TProofState, type TBinding, type TCloseRequest, type TNodeRequest } from "../domains/logic.js";
import { quantifierOf, alternativesOf, statementParams, UNTIL_RETRY_MS } from "../domains/readings.js";
import { atom, list, whyText } from "../derivations/terms.js";
import type { TLogicEngine } from "../ports.js";

/** A node of a line's proof: the step it states, the variable a quantifier binds, and the rule a waypoint applies. */
type TNode = { step: TFeatureStep; what?: string; rule?: string };
/** A node whose record is open: the result its proof resolves, its dispatch, and when it opened. */
type TOpened = { close: (result: TActionResult) => void; dispatched: Promise<TStepResult>; at: number };

const keyOf = (path: readonly number[]): string => path.join(".");

/** Where a proof of a step's statements places them: the path segment each statement takes under the step, in order, and the
 *  host whose steps prove them, where another host does. */
type TPlaced = { segments: number[]; targetHostId?: number };

/** One line's proof: its nodes, the results of its calls and nodes by position, and the contexts and members it opened. */
class Proof {
	private readonly nodes = new Map<string, TNode>();
	private readonly rules = new Map<string, TStepperStep>();
	private readonly results = new Map<string, TStepResult>();
	/** The products of the last result under each position, where that result holds products. */
	private readonly productsUnder = new Map<string, Record<string, unknown>>();
	private readonly opened = new Map<string, TOpened>();
	private readonly contexts = new Map<string, TCallContext>();
	/** The arguments each open node read when it opened, by position. */
	private readonly argsAt = new Map<string, TStepArgs>();
	private readonly metrics = new Map<string, Record<string, Record<string, unknown>>>();

	constructor(
		private readonly ctx: DispatchContext,
		private readonly line: TFeatureStep,
		private readonly placed?: TPlaced,
	) {}

	private add(node: TNode): string {
		const id = `n${this.nodes.size + 1}`;
		this.nodes.set(id, node);
		return id;
	}

	private node(id: string): TNode {
		const node = this.nodes.get(id);
		if (node === undefined) throw new Error(`the engine requested the node ${id}, which the proof of "${this.line.in}" doesn't hold`);
		return node;
	}

	/** Resolves a statement's text to its steps, as a statement parameter is resolved. */
	private statementSteps(text: string, step: TFeatureStep): TFeatureStep[] {
		return findFeatureStepsFromStatement(text, this.ctx.steppers, this.ctx.world, step.source?.path, [...step.seqPath, 0]);
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
			const rule = step.action.actionName;
			this.rules.set(rule, declared);
			return `${reading}(${this.add({ step, rule })}, ${atom(rule)})`;
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
			...(line.isAfterEveryStep === true ? { isAfterEveryStep: true } : {}),
		};
	}

	/** The arguments a call reads from its bindings: each quantifier's member and its metrics, and each waypoint's arguments,
	 *  outermost first, over the line's own. */
	private runtimeArgsOf(bindings: TBinding[]): Record<string, string | number> {
		const args: Record<string, string | number> = { ...this.line.runtimeArgs };
		for (const binding of [...bindings].reverse()) {
			if ("member" in binding) {
				const { what } = this.node(binding.node);
				if (what === undefined) throw new Error(`the node ${binding.node} binds a member without a quantifier`);
				args[what] = binding.member;
				const metrics = this.metrics.get(binding.node)?.[binding.member];
				for (const [metric, value] of metrics === undefined ? [] : Object.entries(metrics)) args[`${what}/${metric}`] = typeof value === "number" ? value : String(value);
			} else if ("args" in binding) for (const { name, value } of binding.args) args[name] = value;
		}
		return args;
	}

	/** Runs a read a node makes beside its calls inside each context its bindings name, under the authority and read scope a
	 *  dispatched step runs under. Returns the read's outcome, or its refusal as the engine reads it. */
	private async readWithin(bindings: TBinding[], read: () => Promise<string>): Promise<string> {
		try {
			return await this.withinContexts(bindings, () => runAsDispatched(this.ctx, read));
		} catch (caught) {
			return refusedTerm(errorDetail(caught));
		}
	}

	/** Runs a call inside each context its bindings name, outermost first. */
	private withinContexts<T>(bindings: TBinding[], run: () => Promise<T>): Promise<T> {
		const contexts = bindings.flatMap((binding) => ("within" in binding ? [this.contextAt(binding.within)] : []));
		return contexts.reduce<() => Promise<T>>((inner, context) => () => context(inner), run)();
	}

	private contextAt(path: readonly number[]): TCallContext {
		const context = this.contexts.get(keyOf(path));
		if (context === undefined) throw new Error(`the proof of "${this.line.in}" reads a context at ${keyOf(path)}, which its node didn't open`);
		return context;
	}

	/** Performs the effect a query needs, and returns its outcome as the engine reads it. */
	async perform(need: Extract<TProofState, { need: string }>): Promise<string> {
		const { path, request } = need;
		if (need.need === EFFECT.call) return await this.call(path, request as TNodeRequest);
		if (need.need === EFFECT.open) return await this.open(path, request as TNodeRequest);
		if (need.need === EFFECT.close) return await this.close(path, request as TCloseRequest);
		if (need.need === EFFECT.members) return await this.members(path, request as TNodeRequest);
		if (need.need === EFFECT.args) return await this.args(path, request as TNodeRequest);
		if (need.need === EFFECT.rule) return await this.rule((request as { rule: string }).rule);
		return await this.wait(path, request as { node: string });
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
		this.opened.set(keyOf(path), { close: closed.resolve, dispatched, at: this.ctx.world.clock.now() });
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
		if (args === undefined) throw new Error(`the proof of "${this.line.in}" reads the arguments at ${keyOf(path)}, which its node didn't open`);
		return args;
	}

	private async close(path: number[], request: TCloseRequest): Promise<string> {
		const opened = this.opened.get(keyOf(path));
		if (opened === undefined) throw new Error(`the engine closed the node at ${keyOf(path)} of "${this.line.in}", which it didn't open`);
		const products = this.productsUnder.get(keyOf(path));
		opened.close(
			request.verdict === VERDICT.proved
				? { ok: true, verdict: request.verdict, ...(products === undefined ? {} : { products }) }
				: { ok: false, verdict: request.verdict, errorMessage: this.why(path, request) },
		);
		this.hold(path, await opened.dispatched);
		return "closed";
	}

	/** Why a node's verdict isn't proved: the part that determined it, with that part's own reason, or the reason the engine states. */
	private why(path: readonly number[], request: TCloseRequest): string {
		const { node, verdict, why } = request;
		const line = this.node(node).step.in;
		if (why === "expired") return `${line} is ${verdict}: its statements didn't hold within ${durationOf(this.openedArgs(path))}ms`;
		if (typeof why === "string") return whyText(line, verdict, why);
		const part = this.results.get(keyOf(why));
		if (part === undefined) return `${line} is ${verdict}`;
		return `${line} is ${verdict}, since ${part.in} is ${part.verdict === undefined ? (part.ok ? VERDICT.proved : VERDICT.refuted) : part.verdict}${part.ok ? "" : `: ${part.errorMessage}`}`;
	}

	/** A quantifier's members: the items its observation source returns, or the values of its domain, read as its node reads. */
	private members(path: readonly number[], request: TNodeRequest): Promise<string> {
		const quantifier = quantifierOf(this.openedArgs(path));
		const { world, steppers } = this.ctx;
		return this.readWithin(request.bindings, async () => {
			if ("source" in quantifier) {
				const sources = steppers.flatMap((stepper) => {
					const declared = hasCycles(stepper) ? stepper.cycles.getConcerns?.().sources : undefined;
					return declared === undefined ? [] : declared;
				});
				const source = sources.find((one) => one.name.toLowerCase() === quantifier.source.toLowerCase());
				if (source === undefined) return refusedTerm(`the observation source "${quantifier.source}" isn't declared; declare it in a stepper's concerns`);
				const { items, metrics } = await source.observe(world);
				this.metrics.set(request.node, metrics);
				return `members(${list(items.map(atom))})`;
			}
			const found = await world.shared.getDomainValues(quantifier.domain);
			if (found.error !== undefined) return refusedTerm(found.error);
			return `members(${list(found.values.map((value) => atom(String(value))))})`;
		});
	}

	/** A waypoint's arguments, read as its node reads. */
	private args(path: number[], request: TNodeRequest): Promise<string> {
		const step = this.instance(this.node(request.node), path, request.bindings);
		return this.readWithin(request.bindings, async () => {
			const read = await argumentsOf(step, this.ctx.world, this.ctx.steppers);
			if ("refused" in read) return refusedTerm(read.refused);
			return `args(${list(Object.entries(read.args).map(([name, value]) => `${atom(name)}-${atom(String(value))}`))})`;
		});
	}

	private async rule(name: string): Promise<string> {
		const declared = this.rules.get(name);
		if (declared?.rule === undefined) throw new Error(`the engine requested the rule of ${name}, which the proof of "${this.line.in}" doesn't hold`);
		const { proof, activity } = declared.rule;
		return `rule(${await this.linesTerm(proof)}, ${await this.linesTerm(activity)})`;
	}

	private async linesTerm(lines: TStepInput[]): Promise<string> {
		// A line that expands to one step states the line's own source; a line that expands a background states each background line's.
		const steps = lines.flatMap((input) => {
			const expanded = findFeatureStepsFromStatement(input.in, this.ctx.steppers, this.ctx.world, input.source?.path, [0]);
			return expanded.length === 1 && input.source !== undefined ? expanded.map((step) => ({ ...step, source: input.source })) : expanded;
		});
		return await this.listOf(steps);
	}

	private async wait(path: number[], request: { node: string }): Promise<string> {
		const opened = this.opened.get(keyOf(path));
		if (opened === undefined) throw new Error(`the engine waits at ${keyOf(path)} of "${this.line.in}" for ${request.node}, which isn't open`);
		const { clock } = this.ctx.world;
		if (clock.now() >= opened.at + durationOf(this.openedArgs(path))) return "expired";
		await clock.wait(UNTIL_RETRY_MS);
		return "again";
	}

	/** The result of a step's statements: the result of the first that isn't proved, or of the last. */
	statementsResult(count: number): TStepResult {
		for (let position = 1; position <= count; position++) {
			const result = this.results.get(String(position));
			if (result === undefined) throw new Error(`the proof of the statements of "${this.line.in}" ended without the result of statement ${position}`);
			if (!result.ok || position === count) return result;
		}
		throw new Error(`the proof of the statements of "${this.line.in}" doesn't hold a statement`);
	}

	/** The line's result: the result of its own call, or of its node. */
	result(): TStepResult {
		const result = this.results.get("");
		if (result === undefined) throw new Error(`the proof of "${this.line.in}" ended without the line's result`);
		return result;
	}
}

/** The term a step's line writes for a parameter of a written domain, such as a statement or a quantifier's variable. */
function writtenTerm(step: TFeatureStep, name: string): string {
	const value = step.action.stepValuesMap?.[name];
	if (value === undefined) throw new Error(`${step.in} doesn't state {${name}}, which its reading reads`);
	return value.term;
}

/** The length of time an until's arguments state, in milliseconds. */
function durationOf(args: TStepArgs): number {
	const ms = Number(args.duration);
	if (!Number.isFinite(ms)) throw new Error(`until states the duration ${String(args.duration)}, which isn't a length of time`);
	return ms;
}

/** A read's refusal as the engine reads it. */
const refusedTerm = (reason: string): string => `refused(${atom(reason)})`;

/** The prover of an engine. The engine holds each open proof under an id of its own until the proof completes. */
export function proverOf(engine: TLogicEngine): TProver {
	let proofs = 0;
	/** Proves a term to its verdict, performing each effect it needs, and removes what the engine holds for it. */
	const proved = async <T>(proof: Proof, term: string, result: () => T): Promise<T> => {
		proofs += 1;
		const top = `q${proofs}`;
		try {
			let outcome = engine.prove(top, term);
			while ("need" in outcome) outcome = engine.resume(top, await proof.perform(outcome));
			return result();
		} finally {
			engine.forget(top);
		}
	};
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
			return await proved(proof, term, () => proof.result());
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
			return await proved(proof, `all(${list(terms)})`, () => proof.statementsResult(statements.length));
		},
	};
}
