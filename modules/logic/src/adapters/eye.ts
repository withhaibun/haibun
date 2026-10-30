/**
 * The reasoner's adapter: EYE (MIT) compiled for swipl-wasm 8.2.3. One runtime, started on the first session, serves every
 * session. The reset after each session returns the runtime to what it held before its first session: each predicate and its
 * clauses, the gensym counters that name blank nodes, the tables, the Prolog flags and the files. A runtime whose reset fails
 * is dropped, so the next session starts a runtime of its own. `snapshot/1` would discard the clauses `main` changes, but an
 * engine doesn't yield inside it, so the read built-in couldn't run. Sessions run one at a time in the order they start, which bounds the
 * memory and the processor time reasoning takes. A session runs EYE in a Prolog engine. The read built-in yields its request
 * from the engine and continues with the rows the host posts, as the step program's effects do. A built-in also runs during
 * scoped negation, outside the engine, where it fails.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import SWIPL from "swipl-wasm";
import { DataFactory } from "n3";
import type { Term } from "@rdfjs/types";
import { XSD } from "@haibun/core/lib/domains/vocabularies.js";
import { REASONER_BUILTIN, type TReasonerState } from "../domains/reasoning.js";
import type { TReasoner, TReasonerSession } from "../ports.js";

/** The libraries EYE reaches through autoload, which the runtime's library holds as .qlf files that autoload doesn't read. */
const EYE_LIBRARIES = ["varnumbers", "when"];
const EYE_SOURCE = "@haibun/logic/eye.qlf";
const [EYE_FILE, BUILTINS_FILE, SOURCES_FILE, QUERY_FILE] = ["eye.qlf", "builtins.pl", "sources.n3", "query.n3"];
/** The engine a session runs EYE in, by its alias. */
const ENGINE = "eye";
/** The read built-in, which yields the subject and the predicate and binds its object to each row the host posts; the record of
 *  each predicate, its clauses and each Prolog flag a runtime holds before its first session; and the reset to that record. EYE's
 *  `main` asserts and retracts clauses, declares predicates, among them its own and the read built-in, and sets flags, and the
 *  reset removes each predicate `main` declared and restores the clauses of each predicate whose clauses changed. */
const BUILTINS = `
:- dynamic('<${REASONER_BUILTIN.read}>'/2), dynamic(held_predicate/1), dynamic(held_clauses/3), dynamic(held_flag/2).
'<${REASONER_BUILTIN.read}>'([S, P], O) :- engine_self(_), engine_yield(need(read, S, P)), engine_fetch(rows(Os)), member(O, Os).
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
const NEED = /^need\(read,'<([^']*)>','<([^']*)>'\)$/;
/** The datatypes EYE holds as Prolog numbers and booleans, in place of `literal/2`. */
const NATIVE: ReadonlySet<string> = new Set([XSD.integer, XSD.decimal, XSD.boolean]);
const quotedAtom = (text: string): string => `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** Returns a term as EYE holds it in Prolog: an IRI as a quoted atom in angle brackets, a number or a boolean as itself, and
 *  another literal as `literal/2` with its language or datatype. */
function prologOf(term: Term): string {
	if (term.termType === "NamedNode") return quotedAtom(`<${term.value}>`);
	if (term.termType !== "Literal") throw new Error(`a read's value ${term.value} is a ${term.termType}, and a read returns a named node or a literal.`);
	if (NATIVE.has(term.datatype.value)) return term.value;
	const text = quotedAtom(term.value);
	if (term.language !== "") return `literal(${text}, lang(${quotedAtom(term.language)}))`;
	return `literal(${text}, type(${quotedAtom(`<${term.datatype.value}>`)}))`;
}

type TRuntime = Awaited<ReturnType<typeof SWIPL>>;
type TAnswer = { success?: boolean; error?: unknown; S?: unknown };

/** Runs a goal once. Throws with the goal and the runtime's error where it doesn't succeed. */
function once(runtime: TRuntime, goal: string, input?: Record<string, unknown>): TAnswer {
	const answer = runtime.prolog.query(goal, input).once() as TAnswer | null;
	if (answer?.success !== true)
		throw new Error(`EYE's runtime failed \`${goal}\`: ${JSON.stringify(answer?.error ?? answer)}. Check the N3 the session wrote, which EYE reports above.`);
	return answer;
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

/** Returns the reasoner. Its runtime starts on its first session, and each session runs once the sessions before it ended. */
export function eyeReasoner(): Pick<TReasoner, "session"> {
	let eye: Promise<TEye> | undefined;
	let turn: Promise<unknown> = Promise.resolve();
	const session = async <T>(run: (held: TReasonerSession) => Promise<T>): Promise<T> => {
		if (eye === undefined) eye = startedEye(readFileSync(createRequire(import.meta.url).resolve(EYE_SOURCE)));
		const held = await eye;
		let started = false;
		/** The state an engine step returned: the read it needs, or the text EYE printed once it ended. */
		const stateOf = (answer: TAnswer): TReasonerState => {
			const text = String(answer.S);
			const need = NEED.exec(text);
			if (need !== null) return { need: "read", subject: DataFactory.namedNode(String(need[1])), predicate: DataFactory.namedNode(String(need[2])) };
			if (text !== "done") throw new Error(`EYE ended with ${text}: ${held.errors.join("\n")}. Check the rules and the query of the session.`);
			return { derived: held.printed.join("\n") };
		};
		/** Ends a started session, and drops a runtime whose reset failed, so the next session starts a runtime of its own. */
		const reset = (): unknown => {
			if (!started) return undefined;
			try {
				endSession(held);
				return undefined;
			} catch (err) {
				eye = undefined;
				return err;
			}
		};
		let result: T;
		try {
			result = await run({
				start: (sources, query, explained) =>
					new Promise((resolve) => {
						startSession(held, sources, query, explained);
						started = true;
						resolve(stateOf(once(held.runtime, `engine_next(${ENGINE}, A), term_string(A, S)`)));
					}),
				resume: (rows) => {
					if (!started) throw new Error("a session resumed before it started. Start the session with its sources and query first.");
					return stateOf(once(held.runtime, `term_string(Rows, Text), engine_post(${ENGINE}, rows(Rows), A), term_string(A, S)`, { Text: `[${rows.map(prologOf).join(", ")}]` }));
				},
			});
		} catch (err) {
			const failure = reset();
			throw failure === undefined ? err : new AggregateError([err, failure], "a session threw, and EYE's runtime wasn't reset after it");
		}
		const failure = reset();
		if (failure !== undefined) throw failure;
		return result;
	};
	return {
		session: <T>(run: (held: TReasonerSession) => Promise<T>): Promise<T> => {
			const ran = turn.then(() => session(run));
			turn = ran.catch(() => undefined);
			return ran;
		},
	};
}
