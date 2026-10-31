/**
 * A session of EYE as a task of the worker pool, so its computation doesn't hold the event loop of the process that requests it.
 * A worker holds one runtime of EYE, started on its first session, and runs one session at a time: EYE's engine runs until it
 * yields a read or an effect, which the task requests of its process, and continues with the rows the process replies. The
 * session's end resets the runtime to what it held before its first session; a runtime whose reset fails is dropped, so the
 * worker's next session starts one of its own. The module reads only what its input passes and packages, so Node runs it as it is.
 */
import { readFileSync } from "node:fs";
import SWIPL from "swipl-wasm";
import { z } from "zod";
import { runTask } from "@haibun/core/lib/workers/adapters/run-task.js";

/** A session: the path of EYE's program, the built-ins' Prolog text, the sources, the query and whether it explains. */
export const EyeSessionSchema = z.object({ program: z.string(), builtins: z.string(), sources: z.string(), query: z.string(), explained: z.boolean() });
/** What an engine step returned, which a read or an effect requests of the process, or the session's end: with what EYE printed
 *  and reported. */
export const EyeSteppedSchema = z.object({ answer: z.unknown(), printed: z.array(z.string()), errors: z.array(z.string()) });
/** A step that needs a read or an effect, which crosses with its engine's result alone: what EYE printed crosses once, as the session ends. */
export const EyeNeedSchema = z.object({ answer: z.unknown() });
/** The rows a process replies to a read or an effect, as Prolog's text. */
const RowsSchema = z.string();

type TRuntime = Awaited<ReturnType<typeof SWIPL>>;
/** A runtime with EYE and the built-ins loaded, and what EYE prints and reports while a session runs. */
type TEye = { runtime: TRuntime; printed: string[]; errors: string[] };

/** The libraries EYE reaches through autoload, which the runtime's library holds as .qlf files that autoload doesn't read. */
const EYE_LIBRARIES = ["varnumbers", "when"];
const [EYE_FILE, BUILTINS_FILE, SOURCES_FILE, QUERY_FILE] = ["eye.qlf", "builtins.pl", "sources.n3", "query.n3"];
/** The engine a session runs EYE in, by its alias, and what an engine that ended returns. */
const ENGINE = "eye";
const DONE = "done";
/** EYE's arguments: without a banner, and with each IRI in full. Unexplained, EYE writes each derived triple as one line; explained,
 *  it writes the proof of what the query selects in the N3 proof vocabulary. */
const eyeArguments = (explained: boolean): string => `[${explained ? "" : "'--nope', "}'--quiet', '--no-qnames', '${SOURCES_FILE}', '--query', '${QUERY_FILE}']`;
/** What a goal returns: the runtime returns it as an object of its own class, which a schema of a plain object refuses. */
const AnswerSchema = z
	.custom<object>((value) => typeof value === "object" && value !== null)
	.pipe(z.looseObject({ success: z.boolean().optional(), error: z.unknown().optional(), A: z.unknown().optional() }));

/** The worker's runtime, started on its first session. */
let held: Promise<TEye> | undefined;

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
async function startedEye(program: string, builtins: string): Promise<TEye> {
	const printed: string[] = [];
	const errors: string[] = [];
	const runtime = await SWIPL({ arguments: ["-q"], print: (line: string) => printed.push(line), printErr: (line: string) => errors.push(line) });
	for (const library of EYE_LIBRARIES) once(runtime, `use_module(library(${library}))`);
	runtime.FS.writeFile(EYE_FILE, readFileSync(program));
	once(runtime, `load_files('${EYE_FILE}', [])`);
	runtime.FS.writeFile(BUILTINS_FILE, builtins);
	once(runtime, `consult('${BUILTINS_FILE}')`);
	once(runtime, "hold_runtime");
	return { runtime, printed, errors };
}

/** Ends a session: destroys its engine where it is held, resets the runtime and removes the session's files; drops a runtime
 *  whose reset fails. */
function ended({ runtime }: TEye): void {
	try {
		once(runtime, `(is_engine(${ENGINE}) -> engine_destroy(${ENGINE}) ; true)`);
		once(runtime, "reset_runtime");
		for (const file of [SOURCES_FILE, QUERY_FILE]) runtime.FS.unlink(file);
	} catch (err) {
		held = undefined;
		throw err;
	}
}

export default runTask(EyeSessionSchema, async ({ program, builtins, sources, query, explained }, effect) => {
	if (held === undefined) held = startedEye(program, builtins);
	const eye = await held;
	const { runtime, printed, errors } = eye;
	const stepped = (answer: { A?: unknown }) => ({ answer: answer.A, printed: [...printed], errors: [...errors] });
	printed.length = 0;
	errors.length = 0;
	runtime.FS.writeFile(SOURCES_FILE, sources);
	runtime.FS.writeFile(QUERY_FILE, query);
	try {
		once(runtime, `engine_create(${DONE}, user:main(${eyeArguments(explained)}), _, [alias(${ENGINE})])`);
		let answer = once(runtime, `engine_next(${ENGINE}, A)`);
		while (answer.A !== DONE && typeof answer.A === "object" && answer.A !== null && "need" in answer.A) {
			const rows = RowsSchema.parse(await effect({ answer: answer.A }));
			answer = once(runtime, `term_string(Rows, Text), engine_post(${ENGINE}, rows(Rows), A)`, { Text: rows });
		}
		return stepped(answer);
	} finally {
		ended(eye);
	}
});
