/**
 * The engine's readings conform to N3: a proof exports as N3, each proved call as a fact and each node as the rules of its
 * reading, and EYE derives from the export exactly the nodes the engine proved. EYE (v11.24.8, MIT) is a fixture of this
 * test, compiled for the same swipl-wasm runtime, and the shipped runtime doesn't load it.
 */
import { readFileSync } from "node:fs";
import SWIPL from "swipl-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { VERDICT } from "@haibun/core/lib/domains/protocol.js";
import { EFFECT, PROOF_NAMESPACE } from "../domains/logic.js";
import type { TLogicEngine } from "../ports.js";
import { startSwipl } from "./swipl.js";

/** The libraries EYE reaches through autoload, which the runtime's library holds as .qlf files that autoload doesn't read. */
const EYE_LIBRARIES = ["varnumbers", "when"];
const EYE = new URL("../../fixtures/eye/eye.qlf", import.meta.url);

/** Runs EYE over N3 text in a runtime of its own, and returns the triples it derives. */
async function eyeDerives(n3: string): Promise<string[]> {
	const printed: string[] = [];
	const runtime = await SWIPL({ arguments: ["-q"], print: (line: string) => printed.push(line), printErr: () => undefined });
	for (const library of EYE_LIBRARIES) runtime.prolog.query(`use_module(library(${library}))`).once();
	runtime.FS.writeFile("eye.qlf", readFileSync(EYE));
	runtime.prolog.query("load_files('eye.qlf', [])").once();
	runtime.FS.writeFile("export.n3", n3);
	await runtime.prolog.forEach("user:main(['--nope', '--quiet', '--pass-only-new', 'export.n3'])");
	return printed
		.join("\n")
		.split("\n")
		.filter((line) => line.includes(`${PROOF_NAMESPACE}is>`));
}

/** The N3 triple that states the node at a position proved, as the export names it. */
const provedTriple = (path: number[]): string => `<${PROOF_NAMESPACE}p${["", ...path].join("_")}> <${PROOF_NAMESPACE}is> <${PROOF_NAMESPACE}proved>.`;

/** The outcome of each effect but a call, which each proof states by position. */
const EFFECTS: Record<string, string> = { open: "opened", close: "closed", members: "members(['a', 'b'])", args: "args([])", rule: "rule([call(n3)], [call(n4)])" };

/** Proves a term with the outcome each call position states, as the pipeline performs effects, and returns the N3 export of
 *  its proof and the triple of each node the engine closed as proved. */
function proved(engine: TLogicEngine, top: string, term: string, calls: Record<string, string>): { n3: string; nodes: string[] } {
	const nodes: string[] = [];
	let outcome = engine.prove(top, term);
	while ("need" in outcome) {
		const { need, path, request } = outcome;
		if (need === EFFECT.close && "verdict" in request && request.verdict === VERDICT.proved) nodes.push(provedTriple(path));
		const performed = need === EFFECT.call ? calls[path.join(".")] : EFFECTS[need];
		if (performed === undefined) throw new Error(`the test doesn't state the outcome of ${need} at ${path.join(".")}`);
		outcome = engine.resume(top, performed);
	}
	const n3 = engine.n3(PROOF_NAMESPACE, top);
	engine.forget(top);
	return { n3, nodes };
}

/** Terms of each reading, with the outcome of each call by its position. */
const PROOFS: [string, string, Record<string, string>][] = [
	["negation of a refuted call", "not(n1, [call(n2)])", { "1": "failed" }],
	["negation of a proved call", "not(n1, [call(n2)])", { "1": "passed" }],
	["double negation", "not(n1, [not(n2, [call(n3)])])", { "1.1": "passed" }],
	["implication with a proved condition", "where(n1, [call(n2)], [call(n3)])", { "1": "passed", "2": "passed" }],
	["implication with a refuted condition", "where(n1, [call(n2)], [call(n3)])", { "1": "failed" }],
	["disjunction", "any_of(n1, [[call(n2)], [call(n3)]])", { "1": "failed", "2": "passed" }],
	["existence", "some(n1, [call(n2)])", { "1": "failed", "2": "passed" }],
	["universal over proved members", "every(n1, [call(n2)])", { "1": "passed", "2": "passed" }],
	["universal over a refuted member", "every(n1, [call(n2)])", { "1": "passed", "2": "failed" }],
	["maybe", "maybe(n1, [call(n2)])", { "1": "failed" }],
	["ensure that runs its activity", "ensure(n1, [apply(n2, w)])", { "1.1": "failed", "1.2": "passed", "1.3": "passed" }],
];

describe("the engine's readings in N3", () => {
	let engine: TLogicEngine;
	beforeAll(async () => {
		engine = await startSwipl();
	});

	it.each(PROOFS)("EYE derives the nodes the engine proves: %s", { timeout: 30_000 }, async (_, term, calls) => {
		const { n3, nodes } = proved(engine, "conformance", term, calls);
		expect((await eyeDerives(n3)).sort()).toEqual(nodes.sort());
	});
});
