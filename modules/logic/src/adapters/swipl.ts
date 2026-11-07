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
import { N3_BUILTINS_SOURCE } from "../domains/reasoning.js";

/** The program's file in the runtime's file system, and the file of the N3 built-ins that translated clauses call. */
const [PROGRAM, N3_BUILTINS] = ["haibun.pl", "n3-builtins.pl"];
/** The program's source, which the package exports from its source folder, since the TypeScript build copies only TypeScript. */
const PROGRAM_SOURCE = "@haibun/logic/haibun.pl";
/** The libraries translated clauses read: tabling for a recursive predicate's table. */
const TRANSLATED_LIBRARIES = ["lists", "tabling"];

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
	const resolve = createRequire(import.meta.url).resolve;
	runtime.FS.writeFile(PROGRAM, readFileSync(resolve(PROGRAM_SOURCE), "utf8"));
	once(runtime, `consult('${PROGRAM}')`);
	for (const library of TRANSLATED_LIBRARIES) once(runtime, `use_module(library(${library}))`);
	runtime.FS.writeFile(N3_BUILTINS, readFileSync(resolve(N3_BUILTINS_SOURCE), "utf8"));
	once(runtime, `consult('${N3_BUILTINS}')`);
	return {
		prove: (top, term) => ProofStateSchema.parse(once(runtime, "haibun:prove(Top, Term, Outcome)", { Top: top, Term: term }).Outcome),
		resume: (top, outcome) => ProofStateSchema.parse(once(runtime, "haibun:resume(Top, Outcome, Next)", { Top: top, Outcome: outcome }).Next),
		forget: (top) => {
			once(runtime, "haibun:forget(Top)", { Top: top });
		},
		n3: (namespace, top) => String(once(runtime, "haibun:n3_export(Namespace, Top, Text)", { Namespace: namespace, Top: top }).Text),
		load: ({ module, clauses }) => {
			runtime.FS.writeFile(`${module}.pl`, clauses);
			once(runtime, `consult('${module}.pl')`);
		},
		select: (module, facts) =>
			String(
				once(
					runtime,
					`atom_string(M, Module), forall(member(F, [${facts.join(", ")}]), assertz(M:F)), n3_builtins:n3_answers(M, Text), retractall(M:fact(_, _, _)), abolish_all_tables`,
					{ Module: module },
				).Text,
			),
	};
}
