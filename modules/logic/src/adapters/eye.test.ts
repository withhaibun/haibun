/**
 * One EYE runtime serves successive sessions: each session's outcome is the one a runtime of its own gives, a session doesn't see
 * what an earlier one stated or left part-way, and a session on the reused runtime takes a fraction of a runtime's start.
 */
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { DataFactory } from "n3";
import { REASONER_BUILTIN, RULE_SET } from "../domains/reasoning.js";
import type { TReasoner } from "../ports.js";
import { eyeReasoner } from "./eye.js";
import { POOL_MODE, piscinaPool } from "@haibun/core/lib/workers/adapters/piscina-pool.js";
import type { IWorkerPool } from "@haibun/core/lib/workers/ports.js";
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
				state = await session.resume(ROWS);
			}
			return { derived: state.derived };
		});
	} catch (err) {
		return { threw: err instanceof Error ? err.message : String(err) };
	}
}

/** How long a test's pool holds an idle worker. */
const TEST_IDLE_MS = 100;
/** A reasoner over a worker pool of its own, whose worker starts a runtime of its own, and the pool, which the test closes. */
async function withFreshRuntime<T>(use: (reasoner: Pick<TReasoner, "session">, pool: IWorkerPool) => Promise<T>): Promise<T> {
	const pool = piscinaPool(TEST_IDLE_MS, POOL_MODE.queued);
	try {
		return await use(eyeReasoner(pool), pool);
	} finally {
		await pool.close();
	}
}
const freshOutcomeOf = (session: TSession) => withFreshRuntime((reasoner) => outcomeOf(reasoner, session));

describe("a reused EYE runtime", () => {
	it("gives each session the outcome a runtime of its own gives, over sessions that fail and throw part-way", { timeout: 120_000 }, async () => {
		await withFreshRuntime(async (reused) => {
			for (const session of SESSIONS) expect(await outcomeOf(reused, session), session.name).toEqual(await freshOutcomeOf(session));
		});
	});

	it("doesn't show a session what an earlier session stated, read or named", { timeout: 60_000 }, async () => {
		await withFreshRuntime(async (reused) => {
			const forward = await outcomeOf(reused, FORWARD);
			await outcomeOf(reused, OTHER);
			expect(await outcomeOf(reused, FORWARD)).toEqual(forward);
			expect(await outcomeOf(reused, ABSENCE)).toEqual({ derived: "<urn:x:a> <urn:x:unheld> true." });
			const read = await outcomeOf(reused, READ);
			await outcomeOf(reused, THROWN);
			expect(await outcomeOf(reused, READ)).toEqual(read);
			expect(await outcomeOf(reused, OTHER), "a blank node a session names starts from the same label").toEqual(await freshOutcomeOf(OTHER));
		});
	});

	it("serves a session in a fraction of a runtime's start", { timeout: 120_000 }, async () => {
		await withFreshRuntime(async (reused) => {
			await outcomeOf(reused, FORWARD);
			const timed = async (outcome: () => Promise<unknown>): Promise<number> => {
				const start = performance.now();
				for (let at = 0; at < 5; at++) await outcome();
				return performance.now() - start;
			};
			const fresh = await timed(() => freshOutcomeOf(FORWARD));
			const onReused = await timed(() => outcomeOf(reused, FORWARD));
			expect(onReused * 3, `5 sessions took ${onReused.toFixed(0)} ms on the reused runtime and ${fresh.toFixed(0)} ms on fresh runtimes`).toBeLessThan(fresh);
		});
	});

	it("runs a session started within a session at once in another worker, and releases that worker once it is idle", { timeout: 60_000 }, async () => {
		await withFreshRuntime(async (reasoner, pool) => {
			// The outer session waits on its read while the nested session runs.
			const outer = await reasoner.session(async (session) => {
				await session.start(READ.sources, READ.query, false);
				const nested = await outcomeOf(reasoner, OTHER);
				const held = pool.threads();
				await session.resume(ROWS);
				return { nested, held };
			});
			expect(outer.nested).toEqual(await freshOutcomeOf(OTHER));
			expect(outer.held, "the outer session's worker and the nested session's").toBe(2);
			await new Promise((idled) => setTimeout(idled, TEST_IDLE_MS * 10));
			expect(pool.threads(), "the pool releases its idle workers").toBe(0);
		});
	});

	it("leaves the process responding to a request while a large session computes in the worker", { timeout: 120_000 }, async () => {
		const LINKS = 80;
		const chain = Array.from({ length: LINKS }, (_, at) => `:n${at} :next :n${at + 1} .`).join("\n");
		const sources = `${PREFIXES}${chain}\n{ ?a :next ?b } => { ?a :reaches ?b } .\n{ ?a :reaches ?b . ?b :next ?c } => { ?a :reaches ?c } .`;
		const server = createServer((_, response) => response.end("responded"));
		await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
		const address = server.address();
		try {
			if (address === null || typeof address === "string") throw new Error("the test's server doesn't state its port");
			let sessionEnded = false;
			const computing = freshOutcomeOf({ name: "a closure of 80 links", sources, query: select(":n0 :reaches ?o") }).finally(() => {
				sessionEnded = true;
			});
			const responded = await (await fetch(`http://127.0.0.1:${address.port}/`)).text();
			expect({ responded, sessionEnded }, "the server responds before the session ends").toEqual({ responded: "responded", sessionEnded: false });
			const closure = await computing;
			expect("derived" in closure ? closure.derived.split("\n") : closure).toHaveLength(LINKS);
		} finally {
			server.close();
		}
	});
});
