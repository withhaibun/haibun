/**
 * The reasoner's adapter: EYE (MIT) compiled for swipl-wasm 8.2.3. One runtime, started on the first session, serves every
 * session. The reset after each session returns the runtime to what it held before its first session: each predicate and its
 * clauses, the gensym counters that name blank nodes, the tables, the Prolog flags and the files. A runtime whose reset fails
 * is dropped, so the next session starts a runtime of its own. `snapshot/1` would discard the clauses `main` changes, but an
 * engine doesn't yield inside it, so the read built-in couldn't run. Sessions run one at a time in the order they start, which
 * bounds the memory and the processor time reasoning takes. A session runs EYE in a Prolog engine. The read and effect built-ins
 * yield their request from the engine and continue with the rows the host posts, as the step program's effects do. A built-in
 * also runs during scoped negation, outside the engine, where it fails. A session started within an effect of a session, such as
 * a waypoint's proof that reaches a step whose statements apply a waypoint, runs at once on a runtime of the next depth, since the
 * engines of one runtime share its clauses; a runtime of a nested depth is started on demand and dropped once it is idle.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import SWIPL from "swipl-wasm";
import { DataFactory } from "n3";
import { z } from "zod";
import type { Term } from "@rdfjs/types";
import { XSD } from "@haibun/core/lib/domains/vocabularies.js";
import { REASONER_BUILTIN, type TReasonerState, type TReasonerValue } from "../domains/reasoning.js";
import type { TReasoner, TReasonerSession } from "../ports.js";

/** The libraries EYE reaches through autoload, which the runtime's library holds as .qlf files that autoload doesn't read. */
const EYE_LIBRARIES = ["varnumbers", "when"];
const EYE_SOURCE = "@haibun/logic/eye.qlf";
const [EYE_FILE, BUILTINS_FILE, SOURCES_FILE, QUERY_FILE] = ["eye.qlf", "builtins.pl", "sources.n3", "query.n3"];
/** The engine a session runs EYE in, by its alias. */
const ENGINE = "eye";
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
/** EYE's arguments: without a banner, and with each IRI in full. Unexplained, EYE writes each derived triple as one line; explained,
 *  it writes the proof of what the query selects in the N3 proof vocabulary. */
const eyeArguments = (explained: boolean): string => `[${explained ? "" : "'--nope', "}'--quiet', '--no-qnames', '${SOURCES_FILE}', '--query', '${QUERY_FILE}']`;
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
/** The runtime returns a compound term as an object of its own class, which a schema of a plain object refuses. */
const CompoundSchema = z.custom<{ [functor: string]: unknown }>((value) => typeof value === "object" && value !== null && !Array.isArray(value));
const PrologSchema: z.ZodType<TProlog> = z.lazy(() => z.union([z.string(), z.number(), z.array(PrologSchema), CompoundSchema]));
/** EYE's `literal/2`, with its text first; the effect a step yields, its kind with its request; and what a goal returns. */
const LiteralSchema = CompoundSchema.pipe(z.looseObject({ literal: z.tuple([z.tuple([z.string(), z.unknown()])]) }));
const NeedSchema = CompoundSchema.pipe(z.looseObject({ need: z.tuple([z.array(PrologSchema)]) }));
const AnswerSchema = CompoundSchema.pipe(z.looseObject({ success: z.boolean().optional(), error: z.unknown().optional(), A: PrologSchema.optional() }));
type TAnswer = z.infer<typeof AnswerSchema>;
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

type TRuntime = Awaited<ReturnType<typeof SWIPL>>;

/** Runs a goal once. Throws with the goal and the runtime's error where it doesn't succeed. */
function once(runtime: TRuntime, goal: string, input?: Record<string, unknown>): TAnswer {
	const answered: unknown = runtime.prolog.query(goal, input).once();
	const answer = AnswerSchema.safeParse(answered);
	if (!answer.success || answer.data.success !== true)
		throw new Error(
			`EYE's runtime failed \`${goal}\`: ${JSON.stringify(answer.success && answer.data.error !== undefined ? answer.data.error : answered)}. Check the N3 the session wrote, which EYE reports above.`,
		);
	return answer.data;
}

/** A runtime with EYE and the built-ins loaded, and what EYE prints and reports while a session runs. */
type TEye = { runtime: TRuntime; printed: string[]; errors: string[] };

/** Starts a runtime with EYE and the built-ins loaded, and records the predicates and flags it holds before its first session. */
async function startedEye(program: Uint8Array): Promise<TEye> {
	const printed: string[] = [];
	const errors: string[] = [];
	const runtime = await SWIPL({ arguments: ["-q"], print: (line: string) => printed.push(line), printErr: (line: string) => errors.push(line) });
	for (const library of EYE_LIBRARIES) once(runtime, `use_module(library(${library}))`);
	runtime.FS.writeFile(EYE_FILE, program);
	once(runtime, `load_files('${EYE_FILE}', [])`);
	runtime.FS.writeFile(BUILTINS_FILE, BUILTINS);
	once(runtime, `consult('${BUILTINS_FILE}')`);
	once(runtime, "hold_runtime");
	return { runtime, printed, errors };
}

/** Writes a session's sources and query, and starts EYE over them in an engine. */
function startSession({ runtime, printed, errors }: TEye, sources: string, query: string, explained: boolean): void {
	printed.length = 0;
	errors.length = 0;
	runtime.FS.writeFile(SOURCES_FILE, sources);
	runtime.FS.writeFile(QUERY_FILE, query);
	once(runtime, `engine_create(done, user:main(${eyeArguments(explained)}), _, [alias(${ENGINE})])`);
}

/** Ends a session: destroys its engine where it is held, resets the runtime and removes the session's files. */
function endSession({ runtime }: TEye): void {
	once(runtime, `(is_engine(${ENGINE}) -> engine_destroy(${ENGINE}) ; true)`);
	once(runtime, "reset_runtime");
	for (const file of [SOURCES_FILE, QUERY_FILE]) runtime.FS.unlink(file);
}

/** A depth's runtime: the runtime, started on its first session, the turn its next session waits for, how many sessions wait or
 *  run, and the timer that drops a nested depth's runtime once it is idle. */
type TDepth = { eye: Promise<TEye> | undefined; turn: Promise<unknown>; waiting: number; idle?: ReturnType<typeof setTimeout> };

/** The state an engine step returned: the read or the effect it needs, or the text EYE printed once it ended. */
function stateOf({ printed, errors }: TEye, answer: TAnswer): TReasonerState {
	const { A } = answer;
	if (A === "done") return { derived: printed.join("\n") };
	const need = NeedSchema.safeParse(A);
	const [kind, ...request] = need.success ? need.data.need[0] : [];
	const [subject, predicate] = request.map((part) => (typeof part === "string" ? IRI.exec(part)?.[1] : undefined));
	if (kind === "read" && subject !== undefined && predicate !== undefined)
		return { need: "read", subject: DataFactory.namedNode(subject), predicate: DataFactory.namedNode(predicate) };
	const effect = request[0];
	if (kind === "effect" && Array.isArray(effect)) return { need: "effect", request: effect.map(reasonerValueOf) };
	throw new Error(`EYE ended with ${JSON.stringify(A)}: ${errors.join("\n")}. Check the rules and the query of the session.`);
}

/** Returns the reasoner, with how many runtimes it holds. A depth's runtime starts on its first session, and each session runs
 *  once the sessions before it at its depth ended. */
export function eyeReasoner(): Pick<TReasoner, "session"> & { runtimes: () => number } {
	let program: Uint8Array | undefined;
	const depths = new Map<number, TDepth>();
	const depthAt = (depth: number): TDepth => {
		const held = depths.get(depth);
		if (held !== undefined) return held;
		const started: TDepth = { eye: undefined, turn: Promise.resolve(), waiting: 0 };
		depths.set(depth, started);
		return started;
	};
	/** Counts a session's end, and drops a nested depth's runtime once it is idle for `NESTED_IDLE_MS`. */
	const ended = (at: TDepth, depth: number): void => {
		at.waiting -= 1;
		if (depth === 0 || at.waiting > 0) return;
		at.idle = setTimeout(() => {
			if (at.waiting === 0 && depths.get(depth) === at) depths.delete(depth);
		}, NESTED_IDLE_MS);
		at.idle.unref();
	};
	const session = async <T>(at: TDepth, depth: number, run: (held: TReasonerSession) => Promise<T>): Promise<T> => {
		if (program === undefined) program = readFileSync(createRequire(import.meta.url).resolve(EYE_SOURCE));
		if (at.eye === undefined) at.eye = startedEye(program);
		const held = await at.eye;
		let started = false;
		/** Ends a started session, and drops a runtime whose reset failed, so the next session starts a runtime of its own. */
		const reset = (): unknown => {
			if (!started) return undefined;
			try {
				endSession(held);
				return undefined;
			} catch (err) {
				at.eye = undefined;
				return err;
			}
		};
		let result: T;
		try {
			result = await nesting.run(depth, () =>
				run({
					start: (sources, query, explained) =>
						new Promise((resolve) => {
							startSession(held, sources, query, explained);
							started = true;
							resolve(stateOf(held, once(held.runtime, `engine_next(${ENGINE}, A)`)));
						}),
					resume: (rows) => {
						if (!started) throw new Error("a session resumed before it started. Start the session with its sources and query first.");
						return stateOf(held, once(held.runtime, `term_string(Rows, Text), engine_post(${ENGINE}, rows(Rows), A)`, { Text: `[${rows.map(prologOf).join(", ")}]` }));
					},
				}),
			);
		} catch (err) {
			const failure = reset();
			throw failure === undefined ? err : new AggregateError([err, failure], "a session threw, and EYE's runtime wasn't reset after it");
		}
		const failure = reset();
		if (failure !== undefined) throw failure;
		return result;
	};
	return {
		runtimes: () => [...depths.values()].filter(({ eye }) => eye !== undefined).length,
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
