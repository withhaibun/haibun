/**
 * The reasoner's adapter: EYE (MIT) compiled for swipl-wasm 8.2.3. EYE's `main` runs once per process, as its command line
 * runs, and leaves its facts, rules and tables in the runtime, so each session starts a runtime of its own (about 100 ms)
 * from the program read on the first session. Sessions run one at a time in the order they start, which bounds the memory
 * and the processor time reasoning takes. A session runs EYE in a Prolog engine. The read built-in yields its request from
 * the engine and continues with the rows the host posts, as the step program's effects do. A built-in also runs during
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
/** The read built-in: it yields the subject and the predicate, and binds its object to each row the host posts. */
const BUILTINS = `'<${REASONER_BUILTIN.read}>'([S, P], O) :- engine_self(_), engine_yield(need(read, S, P)), engine_fetch(rows(Os)), member(O, Os).`;
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

/** Starts a runtime with EYE and the built-in loaded, writes a session's sources and query, and starts EYE over them. */
async function started(program: Uint8Array, sources: string, query: string, explained: boolean): Promise<{ runtime: TRuntime; printed: string[]; errors: string[] }> {
	const printed: string[] = [];
	const errors: string[] = [];
	const runtime = await SWIPL({ arguments: ["-q"], print: (line: string) => printed.push(line), printErr: (line: string) => errors.push(line) });
	for (const library of EYE_LIBRARIES) once(runtime, `use_module(library(${library}))`);
	runtime.FS.writeFile(EYE_FILE, program);
	once(runtime, `load_files('${EYE_FILE}', [])`);
	runtime.FS.writeFile(BUILTINS_FILE, BUILTINS);
	once(runtime, `consult('${BUILTINS_FILE}')`);
	runtime.FS.writeFile(SOURCES_FILE, sources);
	runtime.FS.writeFile(QUERY_FILE, query);
	once(runtime, `engine_create(done, user:main(${eyeArguments(explained)}), _, [alias(${ENGINE})])`);
	return { runtime, printed, errors };
}

/** Returns the reasoner. EYE's program is read on its first session, and each session runs once the sessions before it ended. */
export function eyeReasoner(): TReasoner {
	let program: Uint8Array | undefined;
	let turn: Promise<unknown> = Promise.resolve();
	const session = async <T>(run: (held: TReasonerSession) => Promise<T>): Promise<T> => {
		if (program === undefined) program = readFileSync(createRequire(import.meta.url).resolve(EYE_SOURCE));
		const held = program;
		let opened: Awaited<ReturnType<typeof started>> | undefined;
		/** The state an engine step returned: the read it needs, or the text EYE printed once it ended. */
		const stateOf = ({ runtime, printed, errors }: Awaited<ReturnType<typeof started>>, answer: TAnswer): TReasonerState => {
			const text = String(answer.S);
			const need = NEED.exec(text);
			if (need !== null) return { need: "read", subject: DataFactory.namedNode(String(need[1])), predicate: DataFactory.namedNode(String(need[2])) };
			once(runtime, `engine_destroy(${ENGINE})`);
			if (text !== "done") throw new Error(`EYE ended with ${text}: ${errors.join("\n")}. Check the rules and the query of the session.`);
			return { derived: printed.join("\n") };
		};
		const openedSession = (): Awaited<ReturnType<typeof started>> => {
			if (opened === undefined) throw new Error("a session resumed before it started. Start the session with its sources and query first.");
			return opened;
		};
		return await run({
			start: async (sources, query, explained) => {
				opened = await started(held, sources, query, explained);
				return stateOf(opened, once(opened.runtime, `engine_next(${ENGINE}, A), term_string(A, S)`));
			},
			resume: (rows) => {
				const at = openedSession();
				return stateOf(at, once(at.runtime, `term_string(Rows, Text), engine_post(${ENGINE}, rows(Rows), A), term_string(A, S)`, { Text: `[${rows.map(prologOf).join(", ")}]` }));
			},
		});
	};
	return {
		session: <T>(run: (held: TReasonerSession) => Promise<T>): Promise<T> => {
			const ran = turn.then(() => session(run));
			turn = ran.catch(() => undefined);
			return ran;
		},
	};
}
