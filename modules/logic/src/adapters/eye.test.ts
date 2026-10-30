/**
 * One EYE runtime serves successive sessions: each session's outcome is the one a runtime of its own gives, a session doesn't see
 * what an earlier one stated or left part-way, and a session on the reused runtime takes a fraction of a runtime's start.
 */
import { describe, expect, it, vi } from "vitest";
import { DataFactory } from "n3";
import { REASONER_BUILTIN, RULE_SET } from "../domains/reasoning.js";
import type { TReasoner } from "../ports.js";
import { eyeReasoner } from "./eye.js";
import { ruleLibrary } from "./rule-library.js";

const PREFIXES = `@prefix : <urn:x:> . @prefix h: <urn:haibun:> . @prefix log: <http://www.w3.org/2000/10/swap/log#> .\n`;
/** The rows the host posts for a read, the failure a host throws part-way, and what a session that throws returns. */
const ROWS = [DataFactory.namedNode("urn:x:v1"), DataFactory.namedNode("urn:x:v2")];
const HOST_FAILURE = "the host's read failed";
type TSessionResult = { derived: string } | { threw: string };
/** A session: its sources and query, and whether the host posts rows for its reads or throws at the first. */
type TSession = { name: string; sources: string; query: string; reads?: "post" | "throw" };

const select = (pattern: string): string => `${PREFIXES}{ ${pattern} } => { ${pattern} } .`;
const READ_RULE = `{ (:a :p) <${REASONER_BUILTIN.read}> ?o } => { :a :got ?o } .`;
const FORWARD: TSession = { name: "forward rule", sources: `${PREFIXES}:a :p :b . { ?x :p ?y } => { ?y :q ?x } .`, query: select("?s :q ?o") };
const OTHER: TSession = { name: "other facts", sources: `${PREFIXES}:c :p :d . :c :held true . { ?x :p ?y } => { ?y :q [ :from ?x ] } .`, query: select("?s :q ?o . ?o :from ?f") };
const ABSENCE: TSession = {
	name: "absence of a fact an earlier session stated",
	sources: `${PREFIXES}:a :p :b . { :a :unheld true } <= { (h:found { :c :held ?held } ()) log:collectAllIn ?within } .`,
	query: select(":a :unheld ?o"),
};
const READ: TSession = { name: "read", sources: `${PREFIXES}${READ_RULE}`, query: select(":a :got ?o"), reads: "post" };
const THROWN: TSession = { ...READ, name: "host throws part-way", reads: "throw" };
const SESSIONS: TSession[] = [
	FORWARD,
	OTHER,
	{ ...FORWARD, name: "the forward rule again" },
	ABSENCE,
	{ name: "backward rule", sources: `${PREFIXES}:c :p :d . { ?x :back ?y } <= { ?x :p ?y } .`, query: select(":c :back ?o") },
	READ,
	{ name: "syntax error", sources: `${PREFIXES}:a :p .`, query: select("?s :q ?o") },
	THROWN,
	{ ...READ, name: "read after a session thrown part-way" },
	{
		name: "OWL 2 RL rule set",
		sources: `${ruleLibrary()(RULE_SET.owlRl)}\n${PREFIXES}:Dog <http://www.w3.org/2000/01/rdf-schema#subClassOf> :Animal . :rex a :Dog .`,
		query: select(":rex a ?c"),
	},
	{ ...FORWARD, name: "the forward rule last" },
];

/** Runs a session, posting the rows for each read or throwing at the first, and returns what it derived or threw. */
async function outcomeOf(reasoner: Pick<TReasoner, "session">, { sources, query, reads }: TSession): Promise<TSessionResult> {
	try {
		return await reasoner.session(async (session) => {
			let state = await session.start(sources, query, false);
			while ("need" in state) {
				if (reads !== "post") throw new Error(HOST_FAILURE);
				state = session.resume(ROWS);
			}
			return { derived: state.derived };
		});
	} catch (err) {
		return { threw: err instanceof Error ? err.message : String(err) };
	}
}

describe("a reused EYE runtime", () => {
	it("gives each session the outcome a runtime of its own gives, over sessions that fail and throw part-way", { timeout: 120_000 }, async () => {
		const reused = eyeReasoner();
		for (const session of SESSIONS) expect(await outcomeOf(reused, session), session.name).toEqual(await outcomeOf(eyeReasoner(), session));
	});

	it("doesn't show a session what an earlier session stated, read or named", { timeout: 60_000 }, async () => {
		const reused = eyeReasoner();
		const forward = await outcomeOf(reused, FORWARD);
		await outcomeOf(reused, OTHER);
		expect(await outcomeOf(reused, FORWARD)).toEqual(forward);
		expect(await outcomeOf(reused, ABSENCE)).toEqual({ derived: "<urn:x:a> <urn:x:unheld> true." });
		const read = await outcomeOf(reused, READ);
		await outcomeOf(reused, THROWN);
		expect(await outcomeOf(reused, READ)).toEqual(read);
		expect(await outcomeOf(reused, OTHER), "a blank node a session names starts from the same label").toEqual(await outcomeOf(eyeReasoner(), OTHER));
	});

	it("serves a session in a fraction of a runtime's start", { timeout: 120_000 }, async () => {
		const reused = eyeReasoner();
		await outcomeOf(reused, FORWARD);
		const timed = async (reasonerOf: () => Pick<TReasoner, "session">): Promise<number> => {
			const start = performance.now();
			for (let at = 0; at < 5; at++) await outcomeOf(reasonerOf(), FORWARD);
			return performance.now() - start;
		};
		const fresh = await timed(eyeReasoner);
		const onReused = await timed(() => reused);
		expect(onReused * 3, `5 sessions took ${onReused.toFixed(0)} ms on the reused runtime and ${fresh.toFixed(0)} ms on fresh runtimes`).toBeLessThan(fresh);
	});

	it("runs a session started within a session at once on a runtime of the next depth, and drops that runtime once it is idle", { timeout: 60_000 }, async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			const reasoner = eyeReasoner();
			const outer = await reasoner.session(async (session) => {
				await session.start(FORWARD.sources, FORWARD.query, false);
				const nested = await outcomeOf(reasoner, OTHER);
				return { nested, held: reasoner.runtimes() };
			});
			expect(outer.nested).toEqual(await outcomeOf(eyeReasoner(), OTHER));
			expect(outer.held, "the outer depth's runtime and the nested depth's").toBe(2);
			await vi.runAllTimersAsync();
			expect(reasoner.runtimes(), "the outer depth's runtime alone").toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
