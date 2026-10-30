/**
 * The logic engine's adapter: one SWI-Prolog runtime through swipl-wasm 8.2.3, which consults the engine's program once.
 * The runtime starts with autoload off, so a library the program calls without importing it fails at consult. Each query
 * runs until the proof completes or reaches an effect, without awaiting, so the proofs of several callers interleave at each
 * effect.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import SWIPL from "swipl-wasm";
import { DIFFERENT_BUILDS, ProofStateSchema } from "../domains/logic.js";
import type { TLogicEngine } from "../ports.js";

/** The program's file in the runtime's file system. */
const PROGRAM = "haibun.pl";
/** The program's source, which the package exports from its source folder, since the TypeScript build copies only TypeScript. */
const PROGRAM_SOURCE = "@haibun/logic/haibun.pl";

type TRuntime = Awaited<ReturnType<typeof SWIPL>>;

/** Runs a goal once and returns its bindings. Throws with the goal and the runtime's result where the goal doesn't succeed. */
function once(runtime: TRuntime, goal: string, input?: Record<string, unknown>): Record<string, unknown> {
	const answer = runtime.prolog.query(goal, input).once() as Record<string, unknown> | null;
	if (answer === null || answer.success !== true) {
		const cause = answer?.error;
		const error = cause === undefined ? "" : `: ${typeof cause === "string" ? cause : JSON.stringify(cause)}`;
		throw new Error(`The query \`${goal}\` failed in the step program${error}. ${DIFFERENT_BUILDS}`);
	}
	return answer;
}

/** Starts a runtime and consults the engine's program in it. */
export async function startSwipl(): Promise<TLogicEngine> {
	const runtime = await SWIPL({ arguments: ["-q"] });
	once(runtime, "set_prolog_flag(autoload, false)");
	runtime.FS.writeFile(PROGRAM, readFileSync(createRequire(import.meta.url).resolve(PROGRAM_SOURCE), "utf8"));
	once(runtime, `consult('${PROGRAM}')`);
	return {
		prove: (top, term) => ProofStateSchema.parse(once(runtime, "haibun:prove(Top, Term, Outcome)", { Top: top, Term: term }).Outcome),
		resume: (top, outcome) => ProofStateSchema.parse(once(runtime, "haibun:resume(Top, Outcome, Next)", { Top: top, Outcome: outcome }).Next),
		forget: (top) => {
			once(runtime, "haibun:forget(Top)", { Top: top });
		},
		n3: (namespace, top) => String(once(runtime, "haibun:n3_export(Namespace, Top, Text)", { Namespace: namespace, Top: top }).Text),
	};
}
