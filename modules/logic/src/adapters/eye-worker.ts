/**
 * The reasoner's runtimes, in a worker thread of their own, so a session's computation doesn't hold the event loop of the process
 * that requests it. The worker holds a runtime of EYE for each depth of each reasoner's nested sessions, by its key, started on
 * its first session, and runs
 * each request of the adapter in `eye.ts` as it arrives: a session's start and each resume run EYE's engine until it yields an
 * effect or ends, and a session's end resets its runtime to what it held before its first session. A runtime whose reset fails is
 * dropped, so the next session at its depth starts one of its own. The worker reads only what the adapter passes it and the
 * runtime's own package, so Node runs this file as it is.
 */
import { readFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import SWIPL from "swipl-wasm";
import { z } from "zod";

/** What the adapter passes the worker: the path of EYE's program and the built-ins' Prolog text. */
const EyeWorkerDataSchema = z.object({ program: z.string(), builtins: z.string() });
/** What a goal returns: the runtime returns it as an object of its own class, which a schema of a plain object refuses. */
const AnswerSchema = z
	.custom<object>((value) => typeof value === "object" && value !== null)
	.pipe(z.looseObject({ success: z.boolean().optional(), error: z.unknown().optional(), A: z.unknown().optional() }));
/** A request of the adapter: a session's start, resume or end on a runtime, or the drop of a runtime, by its key. */
export type TEyeRequest =
	| { id: number; op: "start"; runtime: string; sources: string; query: string; explained: boolean }
	| { id: number; op: "resume"; runtime: string; rows: string }
	| { id: number; op: "end"; runtime: string }
	| { id: number; op: "drop"; runtime: string };
/** The worker's reply: what an engine step returned with what EYE printed and reported, an end, or why a request failed. */
export type TEyeReply = { id: number; answer: unknown; printed: string[]; errors: string[] } | { id: number; ended: true } | { id: number; failed: string };

type TRuntime = Awaited<ReturnType<typeof SWIPL>>;
/** A runtime with EYE and the built-ins loaded, and what EYE prints and reports while a session runs. */
type TEye = { runtime: TRuntime; printed: string[]; errors: string[] };

/** The libraries EYE reaches through autoload, which the runtime's library holds as .qlf files that autoload doesn't read. */
const EYE_LIBRARIES = ["varnumbers", "when"];
const [EYE_FILE, BUILTINS_FILE, SOURCES_FILE, QUERY_FILE] = ["eye.qlf", "builtins.pl", "sources.n3", "query.n3"];
/** The engine a session runs EYE in, by its alias. */
const ENGINE = "eye";
/** EYE's arguments: without a banner, and with each IRI in full. Unexplained, EYE writes each derived triple as one line; explained,
 *  it writes the proof of what the query selects in the N3 proof vocabulary. */
const eyeArguments = (explained: boolean): string => `[${explained ? "" : "'--nope', "}'--quiet', '--no-qnames', '${SOURCES_FILE}', '--query', '${QUERY_FILE}']`;

const { program, builtins } = EyeWorkerDataSchema.parse(workerData);
const eyeProgram = readFileSync(program);
const runtimes = new Map<string, Promise<TEye>>();

/** Runs a goal once, and returns what it bound. Throws with the goal and the runtime's error where it doesn't succeed. */
function once(runtime: TRuntime, goal: string, input?: Record<string, unknown>): { A?: unknown } {
	const answered: unknown = runtime.prolog.query(goal, input).once();
	const answer = AnswerSchema.safeParse(answered);
	if (!answer.success || answer.data.success !== true)
		throw new Error(
			`EYE's runtime failed \`${goal}\`: ${JSON.stringify(answer.success && answer.data.error !== undefined ? answer.data.error : answered)}. Check the N3 the session wrote.`,
		);
	return answer.data;
}

/** Starts a runtime with EYE and the built-ins loaded, and records the predicates and flags it holds before its first session. */
async function startedEye(): Promise<TEye> {
	const printed: string[] = [];
	const errors: string[] = [];
	const runtime = await SWIPL({ arguments: ["-q"], print: (line: string) => printed.push(line), printErr: (line: string) => errors.push(line) });
	for (const library of EYE_LIBRARIES) once(runtime, `use_module(library(${library}))`);
	runtime.FS.writeFile(EYE_FILE, eyeProgram);
	once(runtime, `load_files('${EYE_FILE}', [])`);
	runtime.FS.writeFile(BUILTINS_FILE, builtins);
	once(runtime, `consult('${BUILTINS_FILE}')`);
	once(runtime, "hold_runtime");
	return { runtime, printed, errors };
}

const eyeAt = (key: string): Promise<TEye> => {
	const held = runtimes.get(key);
	if (held !== undefined) return held;
	const started = startedEye();
	runtimes.set(key, started);
	return started;
};

/** What an engine step returned, with what EYE printed and reported. */
const stepped = (id: number, { printed, errors }: TEye, answer: { A?: unknown }): TEyeReply => ({ id, answer: answer.A, printed: [...printed], errors: [...errors] });

async function replyTo(request: TEyeRequest): Promise<TEyeReply> {
	const { id, runtime: key } = request;
	if (request.op === "drop") {
		runtimes.delete(key);
		return { id, ended: true };
	}
	const eye = await eyeAt(key);
	const { runtime } = eye;
	if (request.op === "start") {
		eye.printed.length = 0;
		eye.errors.length = 0;
		runtime.FS.writeFile(SOURCES_FILE, request.sources);
		runtime.FS.writeFile(QUERY_FILE, request.query);
		once(runtime, `engine_create(done, user:main(${eyeArguments(request.explained)}), _, [alias(${ENGINE})])`);
		return stepped(id, eye, once(runtime, `engine_next(${ENGINE}, A)`));
	}
	if (request.op === "resume") return stepped(id, eye, once(runtime, `term_string(Rows, Text), engine_post(${ENGINE}, rows(Rows), A)`, { Text: request.rows }));
	try {
		once(runtime, `(is_engine(${ENGINE}) -> engine_destroy(${ENGINE}) ; true)`);
		once(runtime, "reset_runtime");
		for (const file of [SOURCES_FILE, QUERY_FILE]) runtime.FS.unlink(file);
		return { id, ended: true };
	} catch (err) {
		runtimes.delete(key);
		throw err;
	}
}

parentPort?.on("message", (request: TEyeRequest) => {
	replyTo(request).then(
		(reply) => parentPort?.postMessage(reply),
		(err: unknown) => parentPort?.postMessage({ id: request.id, failed: err instanceof Error ? err.message : String(err) } satisfies TEyeReply),
	);
});
