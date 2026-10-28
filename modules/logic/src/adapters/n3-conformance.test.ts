/**
 * The engine's readings conform to N3: a proof exports as N3, each proved call as a fact and each node as the rules of its
 * reading, and EYE derives from the export exactly the nodes the engine proved, beside the facts the export states.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { VERDICT } from "@haibun/core/lib/domains/protocol.js";
import { EFFECT, PROOF_NAMESPACE, READ_PREDICATE, type TReadRequest } from "../domains/logic.js";
import { triplesOf } from "../derivations/n3.js";
import type { TLogicEngine, TReasoner } from "../ports.js";
import { eyeReasoner } from "./eye.js";
import { startSwipl } from "./swipl.js";

/** The query that selects every triple that states a node or a call proved. */
const PROVED_QUERY = `{ ?part <${PROOF_NAMESPACE}is> ?verdict } => { ?part <${PROOF_NAMESPACE}is> ?verdict } .`;
/** A fact of an export: a line that isn't a rule. */
const RULE_OPENING = "{";

/** Runs EYE over N3 text, and returns each triple its query selects, as one line. */
const eyeDerives = (reasoner: TReasoner, n3: string): Promise<string[]> =>
	reasoner.session(async (session) => {
		const state = await session.start(n3, PROVED_QUERY, false);
		if ("need" in state) throw new Error(`the export doesn't read the store, and EYE requested a read of ${state.subject}`);
		return triplesOf(state.derived).map(({ subject, predicate, object }) => `${subject} ${predicate} ${object}.`);
	});

/** The N3 triple that states the node at a position proved, as the export names it. */
const provedTriple = (path: number[]): string => `<${PROOF_NAMESPACE}p${["", ...path].join("_")}> <${PROOF_NAMESPACE}is> <${PROOF_NAMESPACE}proved>.`;

/** The outcome of each effect but a call, which each proof states by position. */
const EFFECTS: Record<string, string> = { open: "opened", close: "closed", rule: "rule([call(n3)], [call(n4)])" };
/** A quantifier reads the members a and b, and a waypoint reads that it doesn't take arguments and isn't stated absent. */
const readOf = (request: TReadRequest): string =>
	`facts([${request.patterns.map((pattern) => (pattern.predicate === READ_PREDICATE.member ? "[['a'], ['b']]" : "[]")).join(", ")}])`;

/** Proves a term with the outcome each call position states, as the pipeline performs effects, and returns the N3 export of
 *  its proof and the triple of each node the engine closed as proved. */
function proved(engine: TLogicEngine, top: string, term: string, calls: Record<string, string>): { n3: string; nodes: string[] } {
	const nodes: string[] = [];
	let outcome = engine.prove(top, term);
	while ("need" in outcome) {
		const { need, path, request } = outcome;
		if (need === EFFECT.close && "verdict" in request && request.verdict === VERDICT.proved) nodes.push(provedTriple(path));
		const performed = need === EFFECT.call ? calls[path.join(".")] : need === EFFECT.read ? readOf(request as TReadRequest) : EFFECTS[need];
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
	let reasoner: TReasoner;
	beforeAll(async () => {
		engine = await startSwipl();
		reasoner = eyeReasoner();
	});

	it.each(PROOFS)("EYE derives the nodes the engine proves: %s", { timeout: 30_000 }, async (_, term, calls) => {
		const { n3, nodes } = proved(engine, "conformance", term, calls);
		const facts = n3.split("\n").filter((line) => line !== "" && !line.startsWith(RULE_OPENING));
		expect((await eyeDerives(reasoner, n3)).sort()).toEqual([...new Set([...facts, ...nodes])].sort());
	});
});
