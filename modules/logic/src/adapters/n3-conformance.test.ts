/**
 * The engine's readings conform to N3: a proof exports as N3, each proved call as a fact and each node as the rules of its
 * reading, and EYE derives from the export exactly the nodes the engine proved. EYE (v11.24.8, MIT) is a fixture of this
 * test, compiled for the same swipl-wasm runtime, and the shipped runtime doesn't load it.
 */
import { readFileSync } from "node:fs";
import SWIPL from "swipl-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { PROOF_NAMESPACE, type TProofPart } from "../domains/logic.js";
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

/** Proves a term with the outcome each call position states, as the pipeline performs effects. */
function proved(engine: TLogicEngine, top: string, term: string, calls: Record<string, string>): { proof: TProofPart; term: string } {
	for (;;) {
		const attempt = engine.attempt(top, term);
		if ("verdict" in attempt) {
			engine.forget(top);
			return attempt;
		}
		const outcome = {
			call: calls[attempt.path.join(".")],
			open: "opened",
			close: "closed",
			members: "members(['a', 'b'])",
			args: "args([])",
			rule: "rule([call(n3)], [call(n4)])",
		}[attempt.need];
		if (outcome === undefined) throw new Error(`the test doesn't state the outcome of ${attempt.need} at ${attempt.path.join(".")}`);
		engine.record(top, attempt.need, attempt.path, outcome);
	}
}

/** The nodes a proof holds proved, as the triples N3 states them. */
const provedNodes = (part: TProofPart): string[] =>
	"parts" in part && part.parts !== undefined
		? [
				...("verdict" in part && part.verdict === "proved" ? [`<${PROOF_NAMESPACE}p${["", ...part.path].join("_")}> <${PROOF_NAMESPACE}is> <${PROOF_NAMESPACE}proved>.`] : []),
				...part.parts.flatMap(provedNodes),
			]
		: [];

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
		const { proof, term: proofTerm } = proved(engine, "conformance", term, calls);
		const derived = await eyeDerives(engine.n3(PROOF_NAMESPACE, proofTerm));
		expect(derived.sort()).toEqual(provedNodes(proof).sort());
	});
});
