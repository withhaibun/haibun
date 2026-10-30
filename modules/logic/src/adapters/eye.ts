/**
 * The reasoner's adapter: EYE (MIT) compiled for swipl-wasm 8.2.3, whose runtimes run in a worker thread (`eye-worker.ts`), so a
 * session's computation doesn't hold this process's event loop. One runtime serves every session at a depth, and the reset after
 * each session returns it to what it held before its first session: each predicate and its clauses, the gensym counters that name
 * blank nodes, the tables, the Prolog flags and the files. A runtime whose reset fails is dropped, so the next session starts a
 * runtime of its own. `snapshot/1` would discard the clauses `main` changes, but an engine doesn't yield inside it, so the read
 * built-in couldn't run. Sessions run one at a time in the order they start, which bounds the memory and the processor time
 * reasoning takes. A session runs EYE in a Prolog engine. The read and effect built-ins yield their request from the engine, which
 * crosses to this process as a message, and continue with the rows the host posts. A built-in also runs during scoped negation,
 * outside the engine, where it fails. A session started within an effect of a session, such as a waypoint's proof that reaches a
 * step whose statements apply a waypoint, runs at once on a runtime of the next depth, since the engines of one runtime share its
 * clauses; a runtime of a nested depth is started on demand and dropped once it is idle.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { DataFactory } from "n3";
import { z } from "zod";
import type { Term } from "@rdfjs/types";
import { XSD } from "@haibun/core/lib/domains/vocabularies.js";
import { REASONER_BUILTIN, type TReasonerState, type TReasonerValue } from "../domains/reasoning.js";
import type { TReasoner, TReasonerSession } from "../ports.js";
import type { TEyeReply, TEyeRequest } from "./eye-worker.js";

const EYE_SOURCE = "@haibun/logic/eye.qlf";
/** The worker's module beside this one: its source where this module runs as its source, and else its build. */
const WORKER = new URL(import.meta.url.endsWith(".ts") ? "./eye-worker.ts" : "./eye-worker.js", import.meta.url);
/** The read built-in, which yields the subject and the predicate and binds its object to each row the host posts; the effect
 *  built-in, which yields its request and binds its outcome to the row the host posts; the record of
 *  each predicate, its clauses and each Prolog flag a runtime holds before its first session; and the reset to that record. EYE's
 *  `main` asserts and retracts clauses, declares predicates, among them its own and the read built-in, and sets flags, and the
 *  reset removes each predicate `main` declared and restores the clauses of each predicate whose clauses changed. */
const BUILTINS = `
:- dynamic('<${REASONER_BUILTIN.read}>'/2), dynamic('<${REASONER_BUILTIN.effect}>'/2), dynamic(held_predicate/1), dynamic(held_clauses/3), dynamic(held_flag/2).
'<${REASONER_BUILTIN.read}>'([S, P], O) :- engine_self(_), engine_yield(need(read, S, P)), engine_fetch(rows(Os)), member(O, Os).
'<${REASONER_BUILTIN.effect}>'(R, O) :- engine_self(_), engine_yield(need(effect, R)), engine_fetch(rows(Os)), member(O, Os).
holding(H) :- current_predicate(user:N/A), \\+ memberchk(N, [held_predicate, held_clauses, held_flag]), functor(H, N, A), \\+ predicate_property(user:H, imported_from(_)).
references(H, Refs) :- findall(Ref, clause(user:H, _, Ref), Refs).
hold_runtime :- forall(current_predicate(user:N/A), assertz(held_predicate(N/A))), forall(current_prolog_flag(F, V), assertz(held_flag(F, V))),
\tforall(holding(H), (findall(H-B, clause(user:H, B), Cs), references(H, Refs), assertz(held_clauses(H, Cs, Refs)))).
restore(H, _, Refs) :- references(H, Refs), !.
restore(H, Cs, Refs) :- retractall(user:H), forall(member(H-B, Cs), assertz(user:(H :- B))), references(H, Now),
\tretract(held_clauses(H, Cs, Refs)), assertz(held_clauses(H, Cs, Now)).
reset_runtime :- forall((current_predicate(user:N/A), \\+ held_predicate(N/A)), abolish(user:N/A)), forall(held_clauses(H, Cs, Refs), restore(H, Cs, Refs)),
\treset_gensym, abolish_all_tables, forall((held_flag(F, V), current_prolog_flag(F, W), W \\== V), set_prolog_flag(F, V)).
`;
/** How long a runtime of a nested depth is held after its last session, for the next session at its depth. */
const NESTED_IDLE_MS = 30_000;
/** The depth of the session whose effect runs now, where one does. */
const nesting = new AsyncLocalStorage<number>();
/** The datatypes EYE holds as Prolog numbers and booleans, in place of `literal/2`. */
const NATIVE: ReadonlySet<string> = new Set([XSD.integer, XSD.decimal, XSD.boolean]);
const quotedAtom = (text: string): string => `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** Returns a value as EYE holds it in Prolog: an IRI as a quoted atom in angle brackets, a number or a boolean as itself, a list
 *  as a list, and another literal or a string as `literal/2` with its language or datatype. */
function prologOf(value: TReasonerValue): string {
	if (typeof value === "number") return String(value);
	if (typeof value === "string") return `literal(${quotedAtom(value)}, type(${quotedAtom(`<${XSD.string}>`)}))`;
	if (!isTerm(value)) return `[${value.map(prologOf).join(", ")}]`;
	if (value.termType === "NamedNode") return quotedAtom(`<${value.value}>`);
	if (value.termType !== "Literal") throw new Error(`a value ${value.value} the host returned is a ${value.termType}, and a session reads a named node or a literal.`);
	if (NATIVE.has(value.datatype.value)) return value.value;
	const text = quotedAtom(value.value);
	if (value.language !== "") return `literal(${text}, lang(${quotedAtom(value.language)}))`;
	return `literal(${text}, type(${quotedAtom(`<${value.datatype.value}>`)}))`;
}

/** Whether a value is an IRI or a literal, rather than a string, a number or a list. */
const isTerm = (value: TReasonerValue): value is Term => typeof value === "object" && "termType" in value;

/** A Prolog term as the runtime returns it: an atom or a string, a number, a list, or a compound term by its functor. */
type TProlog = string | number | TProlog[] | { [functor: string]: unknown };
const PrologSchema: z.ZodType<TProlog> = z.lazy(() => z.union([z.string(), z.number(), z.array(PrologSchema), z.record(z.string(), z.unknown())]));
/** EYE's `literal/2`, with its text first, and the effect a step yields, its kind with its request. */
const LiteralSchema = z.looseObject({ literal: z.tuple([z.tuple([z.string(), z.unknown()])]) });
const NeedSchema = z.looseObject({ need: z.tuple([z.array(PrologSchema)]) });
const IRI = /^<(.*)>$/;

/** Returns a term EYE yielded as a value: an atom in angle brackets as its IRI, `literal/2` as its text, and a list as a list. */
function reasonerValueOf(term: TProlog): TReasonerValue {
	if (typeof term === "number") return term;
	if (typeof term === "string") {
		const iri = IRI.exec(term)?.[1];
		return iri === undefined ? term : DataFactory.namedNode(iri);
	}
	if (Array.isArray(term)) return term.map(reasonerValueOf);
	const literal = LiteralSchema.safeParse(term);
	if (literal.success) return literal.data.literal[0][0];
	throw new Error(`EYE yielded ${JSON.stringify(term)}, which isn't an IRI, a literal, a number or a list. Check the rules of the session.`);
}

/** A depth's runtime: its key in the worker, whether it started, the turn its next session waits for, how many sessions wait or
 *  run, and the timer that drops a nested depth's runtime once it is idle. */
type TDepth = { key: string; started: boolean; turn: Promise<unknown>; waiting: number; idle?: ReturnType<typeof setTimeout> };
/** What a step of EYE's engine returned in the worker, with what EYE printed and reported. */
type TStepped = Extract<TEyeReply, { answer: unknown }>;
type TRequest = TEyeRequest extends infer R ? (R extends TEyeRequest ? Omit<R, "id"> : never) : never;

/** The worker that holds every reasoner's runtimes, started on the first request; it holds the process open only while a
 *  request waits for its reply. */
const eyeWorker = (() => {
	let worker: Worker | undefined;
	let next = 0;
	const pending = new Map<number, { resolve: (reply: TEyeReply) => void; reject: (err: Error) => void }>();
	const started = (): Worker => {
		if (worker !== undefined) return worker;
		const workerData = { program: createRequire(import.meta.url).resolve(EYE_SOURCE), builtins: BUILTINS };
		const opened = new Worker(WORKER, { workerData });
		opened.unref();
		opened.on("message", (reply: TEyeReply) => {
			const waiting = pending.get(reply.id);
			pending.delete(reply.id);
			if (pending.size === 0) opened.unref();
			if ("failed" in reply) waiting?.reject(new Error(reply.failed));
			else waiting?.resolve(reply);
		});
		// A worker that stops ends each request it held, and the next request starts a worker of its own.
		const stopped = (err: Error) => {
			worker = undefined;
			for (const { reject } of pending.values()) reject(err);
			pending.clear();
		};
		opened.on("error", stopped);
		opened.on("exit", (code) => stopped(new Error(`EYE's worker stopped with ${code}. A session that held a request was ended; the next session starts a worker of its own.`)));
		worker = opened;
		return opened;
	};
	return (body: TRequest): Promise<TEyeReply> =>
		new Promise((resolve, reject) => {
			const running = started();
			next += 1;
			pending.set(next, { resolve, reject });
			running.ref();
			running.postMessage({ ...body, id: next });
		});
})();

/** The state an engine step returned: the read or the effect it needs, or the text EYE printed once it ended. */
function stateOf(reply: TEyeReply): TReasonerState {
	if (!("answer" in reply)) throw new Error(`EYE's worker ended a session where a step of its engine was requested. Check the adapter of the reasoner.`);
	const { answer, printed, errors }: TStepped = reply;
	if (answer === "done") return { derived: printed.join("\n") };
	const need = NeedSchema.safeParse(answer);
	const [kind, ...request] = need.success ? need.data.need[0] : [];
	const [subject, predicate] = request.map((part) => (typeof part === "string" ? IRI.exec(part)?.[1] : undefined));
	if (kind === "read" && subject !== undefined && predicate !== undefined)
		return { need: "read", subject: DataFactory.namedNode(subject), predicate: DataFactory.namedNode(predicate) };
	const effect = request[0];
	if (kind === "effect" && Array.isArray(effect)) return { need: "effect", request: effect.map(reasonerValueOf) };
	throw new Error(`EYE ended with ${JSON.stringify(answer)}: ${errors.join("\n")}. Check the rules and the query of the session.`);
}

/** How many reasoners this process started, which names each one's runtimes in the worker. */
let reasoners = 0;

/** Returns the reasoner, with how many runtimes it holds. A depth's runtime starts on its first session, and each session runs
 *  once the sessions before it at its depth ended. */
export function eyeReasoner(): Pick<TReasoner, "session"> & { runtimes: () => number } {
	reasoners += 1;
	const named = reasoners;
	const depths = new Map<number, TDepth>();
	const depthAt = (depth: number): TDepth => {
		const held = depths.get(depth);
		if (held !== undefined) return held;
		const started: TDepth = { key: `${named}:${depth}`, started: false, turn: Promise.resolve(), waiting: 0 };
		depths.set(depth, started);
		return started;
	};
	/** Counts a session's end, and drops a nested depth's runtime once it is idle for `NESTED_IDLE_MS`. */
	const ended = (at: TDepth, depth: number): void => {
		at.waiting -= 1;
		if (depth === 0 || at.waiting > 0) return;
		at.idle = setTimeout(() => {
			if (at.waiting !== 0 || depths.get(depth) !== at) return;
			depths.delete(depth);
			void eyeWorker({ op: "drop", runtime: at.key });
		}, NESTED_IDLE_MS);
		at.idle.unref();
	};
	const session = async <T>(at: TDepth, depth: number, run: (held: TReasonerSession) => Promise<T>): Promise<T> => {
		const runtime = at.key;
		let started = false;
		/** Ends a started session; the worker drops a runtime whose reset failed, so the next session starts one of its own. */
		const reset = async (): Promise<unknown> => {
			if (!started) return undefined;
			try {
				await eyeWorker({ op: "end", runtime });
				return undefined;
			} catch (err) {
				return err;
			}
		};
		let result: T;
		try {
			result = await nesting.run(depth, () =>
				run({
					start: async (sources, query, explained) => {
						const stepped = await eyeWorker({ op: "start", runtime, sources, query, explained });
						started = true;
						at.started = true;
						return stateOf(stepped);
					},
					resume: async (rows) => {
						if (!started) throw new Error("a session resumed before it started. Start the session with its sources and query first.");
						return stateOf(await eyeWorker({ op: "resume", runtime, rows: `[${rows.map(prologOf).join(", ")}]` }));
					},
				}),
			);
		} catch (err) {
			const failure = await reset();
			throw failure === undefined ? err : new AggregateError([err, failure], "a session threw, and EYE's runtime wasn't reset after it");
		}
		const failure = await reset();
		if (failure !== undefined) throw failure;
		return result;
	};
	return {
		runtimes: () => [...depths.values()].filter(({ started }) => started).length,
		session: <T>(run: (held: TReasonerSession) => Promise<T>): Promise<T> => {
			const enclosing = nesting.getStore();
			const depth = enclosing === undefined ? 0 : enclosing + 1;
			const at = depthAt(depth);
			clearTimeout(at.idle);
			at.waiting += 1;
			const ran = at.turn.then(() => session(at, depth, run)).finally(() => ended(at, depth));
			at.turn = ran.catch(() => undefined);
			return ran;
		},
	};
}
