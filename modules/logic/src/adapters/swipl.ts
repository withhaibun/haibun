/**
 * The logic engine's adapter: one SWI-Prolog runtime through swipl-wasm 8.2.3, which consults the engine's program once.
 * The runtime starts with autoload off, so a library the program calls without importing it fails at consult. Each query
 * runs to completion without awaiting, so the proofs of several callers interleave at each effect.
 */
import { readFileSync } from "node:fs";
import SWIPL from "swipl-wasm";
import { AttemptSchema } from "../domains/logic.js";
import type { TLogicEngine } from "../ports.js";

/** The program's file in the runtime's file system. */
const PROGRAM = "haibun.pl";

type TRuntime = Awaited<ReturnType<typeof SWIPL>>;

/** Runs a goal once and returns its bindings. Throws with the goal and the runtime's result where the goal doesn't succeed. */
function once(runtime: TRuntime, goal: string, input?: Record<string, unknown>): Record<string, unknown> {
	const answer = runtime.prolog.query(goal, input).once() as Record<string, unknown> | null;
	if (answer === null || answer.success !== true) throw new Error(`the logic engine didn't prove ${goal}: ${JSON.stringify(answer)}`);
	return answer;
}

/** Starts a runtime and consults the engine's program in it. */
export async function startSwipl(): Promise<TLogicEngine> {
	const runtime = await SWIPL({ arguments: ["-q"] });
	once(runtime, "set_prolog_flag(autoload, false)");
	runtime.FS.writeFile(PROGRAM, readFileSync(new URL(`./${PROGRAM}`, import.meta.url), "utf8"));
	once(runtime, `consult('${PROGRAM}')`);
	return {
		attempt: (top, term) => AttemptSchema.parse(once(runtime, "haibun:attempt(Top, Term, Outcome)", { Top: top, Term: term }).Outcome),
		record: (top, kind, path, outcome) => {
			once(runtime, "haibun:record(Top, Kind, Path, Outcome)", { Top: top, Kind: kind, Path: [...path], Outcome: outcome });
		},
		forget: (top) => {
			once(runtime, "haibun:forget(Top)", { Top: top });
		},
		n3: (namespace, proofTerm) => String(once(runtime, "haibun:n3_export(Namespace, Proof, Text)", { Namespace: namespace, Proof: proofTerm }).Text),
	};
}
