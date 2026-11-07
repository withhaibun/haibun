/**
 * The translation of N3 rule sets into the engine's clauses, and their conformance with EYE. The translation accepts the rule sets
 * whose rules it reads and refuses the others, naming each rule it can't translate. The conformance test records every session the
 * containment and claim cases run on EYE, replays each through the clauses translated from its sources and query, and compares the
 * triples each selects. Each check's time on EYE and on the translated clauses is recorded as an annotation of its test.
 */
import { describe, expect, it } from "vitest";
import type { Quad, Term } from "@rdfjs/types";
import { permissionOf } from "@haibun/core/lib/domains/actions.js";
import { logicEngine, reasoner } from "../root.js";
import { RULE_SET } from "../domains/reasoning.js";
import type { TReasoner, TReasonerSession } from "../ports.js";
import { containment } from "./containment.js";
import { instanceChecked, retrievalChecked, subsumptionChecked } from "./claims.js";
import { translatedChecks } from "./translated.js";
import { proofOf } from "../derivations/proof.js";
import { quadsOf } from "../derivations/n3.js";
import { GRAMMAR, NOW, UNDER } from "../test/containment-cases.js";
import { NOTE, PERSON, STEP, scopeWith } from "../test/claim-scope.js";

/** A session EYE ran: its sources, its query, whether it explained, and what EYE derived. */
type TSession = { sources: string; query: string; explained: boolean; derived: string; ms: number };

/** Returns a reasoner over EYE that records each session that ends with a derivation. */
function recording(sessions: TSession[]): TReasoner {
	const base = reasoner();
	return {
		...base,
		session: (run) =>
			base.session((held) => {
				const at = performance.now();
				const recorded: Omit<TSession, "derived" | "ms"> = { sources: "", query: "", explained: false };
				const ended = <S extends Awaited<ReturnType<TReasonerSession["start"]>>>(state: S): S => {
					if ("derived" in state) sessions.push({ ...recorded, derived: state.derived, ms: performance.now() - at });
					return state;
				};
				return run({
					start: async (sources, query, explained) => {
						Object.assign(recorded, { sources, query, explained });
						return ended(await held.start(sources, query, explained));
					},
					resume: async (rows) => ended(await held.resume(rows)),
				});
			}),
	};
}

/** A triple as both sides are compared: each term's type and value, with a blank node by its type alone, since each side labels its own. */
const termKey = (term: Term): string => (term.termType === "BlankNode" ? term.termType : `${term.termType}|${term.value}`);
const triplesOf = (quads: readonly Quad[]): string[] => [...new Set(quads.map(({ subject, predicate, object }) => [subject, predicate, object].map(termKey).join(" ")))].sort();
/** The triples EYE's session selected: an explained session's proof gives them, and an unexplained one derives them. */
const selectedByEye = ({ derived, explained }: TSession): string[] => triplesOf(explained ? proofOf(derived).gives : quadsOf(derived));
const median = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;

describe("the translation of N3 rule sets into the engine's clauses", () => {
	const checks = logicEngine().then((engine) => translatedChecks(reasoner(), engine));
	const rules = reasoner().rules;

	it("translates the containment, lint and OWL 2 RL rule sets with their queries", { timeout: 60_000 }, async () => {
		const check = await checks;
		for (const [set, query] of [
			[RULE_SET.containment, RULE_SET.containmentQuery],
			[RULE_SET.lint, RULE_SET.lintQuery],
			[RULE_SET.owlRl, RULE_SET.disjointnessQuery],
		] as const)
			await expect(check(rules(set), rules(query), ""), `${set} with ${query}`).resolves.toBeInstanceOf(Array);
	});

	it("refuses a rule set it can't translate, naming each rule and the reason", { timeout: 60_000 }, async () => {
		const check = await checks;
		await expect(check(rules(RULE_SET.goals), rules(RULE_SET.goalsQuery), "")).rejects.toThrow(/the rule .* its head depends on itself through negation or aggregation/);
		await expect(check(rules(RULE_SET.waypoints), rules(RULE_SET.goalsQuery), "")).rejects.toThrow(/the rule .* calls the built-in <urn:haibun:effect>/);
	});

	it("selects the triples EYE selects in each session of the containment and claim cases", { timeout: 300_000 }, async ({ annotate }) => {
		const sessions: TSession[] = [];
		const eye = recording(sessions);
		for (const [held, required] of GRAMMAR) await containment(eye, { actions: [required] }, { actions: held });
		for (const [held, required, target] of UNDER) await containment(eye, { actions: [required], target, usedAt: new Date(NOW).toISOString() }, permissionOf(held));
		await instanceChecked(await scopeWith(eye), { persistedAs: NOTE, id: "n1" }, STEP);
		await instanceChecked(await scopeWith(eye), { persistedAs: NOTE, id: "n1" }, PERSON);
		await subsumptionChecked(await scopeWith(eye), NOTE, STEP);
		await retrievalChecked(await scopeWith(eye), STEP);
		const check = await checks;
		const timed: number[] = [];
		for (const session of sessions) {
			await check(session.sources, session.query, session.sources);
			const at = performance.now();
			const selected = triplesOf(await check(session.sources, session.query, session.sources));
			timed.push(performance.now() - at);
			expect(selected, `the session over ${session.query.slice(0, 120)}`).toEqual(selectedByEye(session));
		}
		expect(sessions.length, "the containment and claim cases ran their sessions").toBeGreaterThan(GRAMMAR.length + UNDER.length);
		await annotate(`${sessions.length} sessions; median per check: EYE ${median(sessions.map(({ ms }) => ms)).toFixed(2)} ms, translated clauses ${median(timed).toFixed(2)} ms`);
	});
});
