/**
 * The reasoner's adapter: EYE (MIT) compiled for swipl-wasm 8.2.3, whose sessions run as tasks of core's worker pool
 * (`eye-task.ts`), so a session's computation doesn't hold this process's event loop. A worker's runtime serves each session the
 * worker runs, and the reset after each session returns it to what it held before its first session: each predicate and its
 * clauses, the gensym counters that name blank nodes, the tables, the Prolog flags and the files. A runtime whose reset fails is
 * dropped, so the worker's next session starts a runtime of its own. `snapshot/1` would discard the clauses `main` changes, but an engine doesn't yield inside it, so the read
 * built-in couldn't run. Sessions run one at a time in the order they start, which bounds the memory and the processor time
 * reasoning takes. A session runs EYE in a Prolog engine. The read and effect built-ins yield their request from the engine, which
 * crosses to this process as a message, and continue with the rows the host posts. A built-in also runs during scoped negation,
 * outside the engine, where it fails. A session started within an effect of a session, such as a waypoint's proof that reaches a
 * step whose statements apply a waypoint, runs at once in another worker, since the engines of one runtime share its clauses; the
 * pool releases a worker once it is idle.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { DataFactory } from "n3";
import { z } from "zod";
import type { Term } from "@rdfjs/types";
import { XSD } from "@haibun/core/lib/domains/vocabularies.js";
import { REASONER_BUILTIN, type TReasonerState, type TReasonerValue } from "../domains/reasoning.js";
import type { TReasoner, TReasonerSession } from "../ports.js";
import type { IWorkerPool } from "@haibun/core/lib/workers/ports.js";
import { siblingModule, type TWorkerTask } from "@haibun/core/lib/workers/domains/worker-task.js";
import { converse, type TConversation, type TTurn } from "@haibun/core/lib/workers/adapters/conversation.js";
import { serialQueue } from "@haibun/core/lib/domains/serial-queue.js";
import { EyeNeedSchema, EyeSessionSchema, EyeSteppedSchema } from "./eye-task.js";

const EYE_SOURCE = "@haibun/logic/eye.qlf";
/** A session of EYE as a task of the worker pool. */
const EYE_TASK: TWorkerTask<z.infer<typeof EyeSessionSchema>, TStepped> = {
	name: "an EYE session",
	module: siblingModule(import.meta.url, "eye-task"),
	input: EyeSessionSchema,
	output: EyeSteppedSchema,
};
/** The read built-in, which yields the subject and the predicate and binds its object to each row the host posts; the effect
 *  built-in, which yields its request and binds its outcome to the row the host posts; the record of
 *  each predicate, the clauses of each dynamic one, and each Prolog flag a runtime holds before its first session; and the reset to that record. EYE's
 *  `main` asserts and retracts clauses, declares predicates, among them its own and the read built-in, and sets flags, and the
 *  reset removes each predicate `main` declared and restores the clauses of each predicate whose clauses changed. */
const BUILTINS = `
:- dynamic('<${REASONER_BUILTIN.read}>'/2), dynamic('<${REASONER_BUILTIN.effect}>'/2), dynamic(held_predicate/1), dynamic(held_clauses/3), dynamic(held_flag/2).
'<${REASONER_BUILTIN.read}>'([S, P], O) :- engine_self(_), engine_yield(need(read, S, P)), engine_fetch(rows(Os)), member(O, Os).
'<${REASONER_BUILTIN.effect}>'(R, O) :- engine_self(_), engine_yield(need(effect, R)), engine_fetch(rows(Os)), member(O, Os).
holding(H) :- current_predicate(user:N/A), \\+ memberchk(N, [held_predicate, held_clauses, held_flag]), functor(H, N, A), predicate_property(user:H, dynamic), \\+ predicate_property(user:H, imported_from(_)).
references(H, Refs) :- findall(Ref, clause(user:H, _, Ref), Refs).
hold_runtime :- forall(current_predicate(user:N/A), assertz(held_predicate(N/A))), forall(current_prolog_flag(F, V), assertz(held_flag(F, V))),
\tforall(holding(H), (findall(H-B, clause(user:H, B), Cs), references(H, Refs), assertz(held_clauses(H, Cs, Refs)))).
restore(H, _, Refs) :- references(H, Refs), !.
restore(H, Cs, Refs) :- retractall(user:H), forall(member(H-B, Cs), assertz(user:(H :- B))), references(H, Now),
\tretract(held_clauses(H, Cs, Refs)), assertz(held_clauses(H, Cs, Now)).
reset_runtime :- forall((current_predicate(user:N/A), \\+ held_predicate(N/A)), abolish(user:N/A)), forall(held_clauses(H, Cs, Refs), restore(H, Cs, Refs)),
\treset_gensym, abolish_all_tables, forall((held_flag(F, V), current_prolog_flag(F, W), W \\== V), set_prolog_flag(F, V)).
`;
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

/** What a step of EYE's engine returned in a worker, with what EYE printed and reported. */
type TStepped = z.infer<typeof EyeSteppedSchema>;

/** The state an engine step returned: the read or the effect it needs, or the text EYE printed once it ended. */
function stateOf({ answer, printed, errors }: TStepped): TReasonerState {
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

/** The rows of a need its caller doesn't read, as Prolog's text. */
const EMPTY_ROWS = "[]";

/** The state of a turn of a session's conversation: the read or the effect its engine needs, or the text EYE printed once it ended. */
const turnState = (turn: TTurn<TStepped>): TReasonerState => stateOf("output" in turn ? turn.output : { ...EyeNeedSchema.parse(turn.request), printed: [], errors: [] });

/** Runs a session as a conversation with a task of the worker pool, which its caller steps through: the start returns the state of
 *  the engine's first step, and each resume posts the rows of the need before it and returns the state of the next. A caller that
 *  returns or throws before the session ends, on a need it refuses, ends it, and each need that follows reads empty rows. */
async function pooledSession<T>(pool: IWorkerPool, run: (held: TReasonerSession) => Promise<T>): Promise<T> {
	const program = createRequire(import.meta.url).resolve(EYE_SOURCE);
	let conversation: TConversation<TStepped> | undefined;
	try {
		return await run({
			start: async (sources, query, explained) => {
				if (conversation !== undefined) throw new Error("a session started twice. Start a session of its own for each query.");
				conversation = converse(pool, EYE_TASK, { program, builtins: BUILTINS, sources, query, explained });
				return turnState(await conversation.first);
			},
			resume: async (posted) => {
				if (conversation === undefined) throw new Error("a session resumed before it started. Start a session before resuming it.");
				return turnState(await conversation.reply(`[${posted.map(prologOf).join(", ")}]`));
			},
		});
	} finally {
		await conversation?.end(EMPTY_ROWS);
	}
}

/** Returns the reasoner over the worker pool `pool`. Each session runs once the sessions before it ended, and a session started
 *  within an effect of a session runs at once beside it. */
export function eyeReasoner(pool: IWorkerPool): Pick<TReasoner, "session"> {
	const inTurn = serialQueue();
	return {
		session: <T>(run: (held: TReasonerSession) => Promise<T>): Promise<T> => {
			const enclosing = nesting.getStore();
			const depth = enclosing === undefined ? 0 : enclosing + 1;
			const inSession = () => nesting.run(depth, () => pooledSession(pool, run));
			return depth > 0 ? inSession() : inTurn(inSession);
		},
	};
}
