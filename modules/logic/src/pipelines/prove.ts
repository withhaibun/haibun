/**
 * Proves a step through the logic engine. A line's term is the formula its step reads as: a built-in call, or a reading
 * over the terms of the statements it states. One query starts the line's proof. Where the proof reaches an effect, this
 * pipeline performs the effect and resumes the proof with its outcome: a built-in call through step dispatch, the opening
 * and closing of a node's record, a quantifier's members, a waypoint's arguments and rule, and a wait of until. A built-in
 * runs once for its position in the proof, which fixes its step, its arguments and the capability it runs under.
 */
import type { DispatchContext } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import { dispatchStep } from "@haibun/core/lib/actuality/pipelines/step-dispatch.js";
import type { TProver } from "@haibun/core/lib/actuality/ports.js";
import { findFeatureStepsFromStatement } from "@haibun/core/lib/actuality/pipelines/resolver.js";
import { argumentsOf } from "@haibun/core/lib/steps/pipelines/populate-action-args.js";
import { VERDICT, type TActionResult, type TStepResult } from "@haibun/core/lib/domains/protocol.js";
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import { hasCycles, READING, type TCallContext, type TFeatureStep, type TStepperStep } from "@haibun/core/lib/steps/domains/stepper.js";
import type { TStepInput } from "@haibun/core/lib/actuality/domains/execution.js";
import { CALL_OUTCOME, EFFECT, type TProofState, type TBinding, type TCloseRequest, type TNodeRequest } from "../domains/logic.js";
import { quantifierOf, alternativesOf, statementParams, UNTIL_RETRY_MS, type TQuantifier } from "../domains/readings.js";
import { atom, list, whyText } from "../derivations/terms.js";
import type { TLogicEngine } from "../ports.js";

/** A node of a line's proof: the step it states, and what its reading reads beside its statements. */
type TNode = { step: TFeatureStep; quantifier?: TQuantifier; durationMs?: number; rule?: string };
/** A node whose record is open: the result its proof resolves, its dispatch, and when it opened. */
type TOpened = { close: (result: TActionResult) => void; dispatched: Promise<TStepResult>; at: number };

const keyOf = (path: readonly number[]): string => path.join(".");

/** One line's proof: its nodes, the results of its calls and nodes by position, and the contexts and members it opened. */
class Proof {
	private readonly nodes = new Map<string, TNode>();
	private readonly rules = new Map<string, TStepperStep>();
	private readonly results = new Map<string, TStepResult>();
	/** The products of the last result under each position, where that result holds products. */
	private readonly productsUnder = new Map<string, Record<string, unknown>>();
	private readonly opened = new Map<string, TOpened>();
	private readonly contexts = new Map<string, TCallContext>();
	private readonly metrics = new Map<string, Record<string, Record<string, unknown>>>();

	constructor(
		private readonly ctx: DispatchContext,
		private readonly line: TFeatureStep,
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

	/** The term of a step: a call of a built-in, or its reading over the terms of its statements. */
	async termOf(step: TFeatureStep): Promise<string> {
		const declared = step.action.step;
		const { reading } = declared;
		if (reading === undefined) return `call(${this.add({ step })})`;
		if (reading === READING.apply) {
			const rule = step.action.actionName;
			this.rules.set(rule, declared);
			return `${reading}(${this.add({ step, rule })}, ${atom(rule)})`;
		}
		const read = await argumentsOf(step, this.ctx.world, this.ctx.steppers);
		if ("refused" in read) throw new Error(read.refused);
		const { args } = read;
		if (reading === READING.anyOf) {
			const alternatives = await Promise.all(alternativesOf(String(args.alternatives)).map((text) => this.listOf(this.statementSteps(text, step))));
			return `${reading}(${this.add({ step })}, ${list(alternatives)})`;
		}
		const quantifier = reading === READING.some || reading === READING.every ? quantifierOf(args) : undefined;
		const durationMs = reading === READING.until ? Number(args.duration) : undefined;
		const statements = await Promise.all(statementParams(declared).map((name) => this.listOf(statementsOf(args[name], step))));
		return `${reading}(${[this.add({ step, quantifier, durationMs }), ...statements].join(", ")})`;
	}

	/** The step a node states at a position of the proof, with the arguments its bindings supply. */
	private instance(node: TNode, path: readonly number[], bindings: TBinding[]): TFeatureStep {
		if (path.length === 0) return this.line;
		const runtimeArgs = this.runtimeArgsOf(bindings);
		const { line } = this;
		return {
			...node.step,
			seqPath: [...line.seqPath, ...path],
			isSubStep: true,
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
				const { quantifier } = this.node(binding.node);
				if (quantifier === undefined) throw new Error(`the node ${binding.node} binds a member without a quantifier`);
				args[quantifier.what] = binding.member;
				const metrics = this.metrics.get(binding.node)?.[binding.member];
				for (const [metric, value] of metrics === undefined ? [] : Object.entries(metrics))
					args[`${quantifier.what}/${metric}`] = typeof value === "number" ? value : String(value);
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
		if (context === undefined) throw new Error(`the proof of "${this.line.in}" reads a context at ${keyOf(path)}, which its node didn't open`);
		return context;
	}

	/** Performs the effect a query needs, and returns its outcome as the engine reads it. */
	async perform(need: Extract<TProofState, { need: string }>): Promise<string> {
		const { path, request } = need;
		if (need.need === EFFECT.call) return await this.call(path, request as TNodeRequest);
		if (need.need === EFFECT.open) return await this.open(path, request as TNodeRequest);
		if (need.need === EFFECT.close) return await this.close(path, request as TCloseRequest);
		if (need.need === EFFECT.members) return await this.members(request as TNodeRequest);
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
		// A context opens inside the contexts that enclose its node, so a statement holds less than its caller, and never more.
		const opening = await this.withinContexts(request.bindings, () => this.contextOf(node, step));
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
		this.opened.set(keyOf(path), { close: closed.resolve, dispatched, at: this.ctx.world.clock.now() });
		return "opened";
	}

	/** The context a node opens: a step that reads as within opens its own, and every other node runs its calls as they are. */
	private async contextOf(node: TNode, step: TFeatureStep): Promise<{ context: TCallContext } | { refused: string }> {
		const { context } = node.step.action.step;
		if (context === undefined) return { context: (run) => run() };
		const read = await argumentsOf(step, this.ctx.world, this.ctx.steppers);
		if ("refused" in read) return read;
		const opened = await context(read.args, step);
		return "refused" in opened ? opened : { context: opened };
	}

	private async close(path: number[], request: TCloseRequest): Promise<string> {
		const opened = this.opened.get(keyOf(path));
		if (opened === undefined) throw new Error(`the engine closed the node at ${keyOf(path)} of "${this.line.in}", which it didn't open`);
		const products = this.productsUnder.get(keyOf(path));
		opened.close(
			request.verdict === VERDICT.proved
				? { ok: true, verdict: request.verdict, ...(products === undefined ? {} : { products }) }
				: { ok: false, verdict: request.verdict, errorMessage: this.why(request) },
		);
		this.hold(path, await opened.dispatched);
		return "closed";
	}

	/** Why a node's verdict isn't proved: the part that determined it, with that part's own reason, or the reason the engine states. */
	private why(request: TCloseRequest): string {
		const { node, verdict, why } = request;
		const { step, durationMs } = this.node(node);
		const line = step.in;
		if (why === "expired") return `${line} is ${verdict}: its statements didn't hold within ${durationMs}ms`;
		if (typeof why === "string") return whyText(line, verdict, why);
		const part = this.results.get(keyOf(why));
		if (part === undefined) return `${line} is ${verdict}`;
		return `${line} is ${verdict}, since ${part.in} is ${part.verdict === undefined ? (part.ok ? VERDICT.proved : VERDICT.refuted) : part.verdict}${part.ok ? "" : `: ${part.errorMessage}`}`;
	}

	private async members(request: TNodeRequest): Promise<string> {
		const { quantifier } = this.node(request.node);
		if (quantifier === undefined) throw new Error(`the engine requested the members of ${request.node}, which isn't a quantifier`);
		const { world, steppers } = this.ctx;
		if ("source" in quantifier) {
			const sources = steppers.flatMap((stepper) => {
				const declared = hasCycles(stepper) ? stepper.cycles.getConcerns?.().sources : undefined;
				return declared === undefined ? [] : declared;
			});
			const source = sources.find((one) => one.name.toLowerCase() === quantifier.source.toLowerCase());
			if (source === undefined) return `refused(${atom(`the observation source "${quantifier.source}" isn't declared; declare it in a stepper's concerns`)})`;
			const { items, metrics } = await source.observe(world);
			this.metrics.set(request.node, metrics);
			return `members(${list(items.map(atom))})`;
		}
		const found = await world.shared.getDomainValues(quantifier.domain);
		if (found.error !== undefined) return `refused(${atom(found.error)})`;
		return `members(${list(found.values.map((value) => atom(String(value))))})`;
	}

	private async args(path: number[], request: TNodeRequest): Promise<string> {
		const step = this.instance(this.node(request.node), path, request.bindings);
		const read = await argumentsOf(step, this.ctx.world, this.ctx.steppers);
		if ("refused" in read) return `refused(${atom(read.refused)})`;
		return `args(${list(Object.entries(read.args).map(([name, value]) => `${atom(name)}-${atom(String(value))}`))})`;
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
		const { durationMs } = this.node(request.node);
		const opened = this.opened.get(keyOf(path));
		if (durationMs === undefined || opened === undefined) throw new Error(`the engine waits at ${keyOf(path)} of "${this.line.in}", which isn't an open until`);
		const { clock } = this.ctx.world;
		if (clock.now() >= opened.at + durationMs) return "expired";
		await clock.wait(UNTIL_RETRY_MS);
		return "again";
	}

	/** The line's result: the result of its own call, or of its node. */
	result(): TStepResult {
		const result = this.results.get("");
		if (result === undefined) throw new Error(`the proof of "${this.line.in}" ended without the line's result`);
		return result;
	}
}

/** The statements a statement parameter holds, as the statement domain resolves them. */
function statementsOf(value: unknown, step: TFeatureStep): TFeatureStep[] {
	if (!Array.isArray(value)) throw new Error(`${step.in} states a statement that didn't resolve to steps`);
	return value as TFeatureStep[];
}

/** The prover of an engine. The engine holds each open proof under an id of its own until the proof completes. */
export function proverOf(engine: TLogicEngine): TProver {
	let proofs = 0;
	return {
		prove: async (ctx, line) => {
			proofs += 1;
			const top = `q${proofs}`;
			const proof = new Proof(ctx, line);
			try {
				let term: string;
				try {
					term = await proof.termOf(line);
				} catch (caught) {
					// A line whose term doesn't build ends unknown with the reason. Dispatch checks its caller's capability first,
					// so a call its caller may not make returns only its refusal.
					return await dispatchStep(ctx, line, () => Promise.resolve({ ok: false, errorMessage: errorDetail(caught), verdict: VERDICT.unknown }));
				}
				let outcome = engine.prove(top, term);
				while ("need" in outcome) outcome = engine.resume(top, await proof.perform(outcome));
				return proof.result();
			} finally {
				engine.forget(top);
			}
		},
	};
}
