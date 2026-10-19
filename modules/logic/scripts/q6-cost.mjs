// The engine's query cost on a large actuality, in the shape of the reasoner spike's Q6: about 1,000 and 10,000 facts of
// step records (six facts a record), proved as `every x in records is S` where each member is a built-in call. A proof
// queries the engine once per effect, and each query replays the outcomes recorded so far. Run it after the module builds:
// `node scripts/q6-cost.mjs`.
import { startSwipl } from "../build/adapters/swipl.js";

const FACTS_PER_RECORD = 6;
/** Every 37th record's call fails, as the spike's actuality states every 37th step failed. */
const FAILED_EVERY = 37;
const round = (ms) => Math.round(ms * 10) / 10;

const started = performance.now();
const engine = await startSwipl();
const startupMs = round(performance.now() - started);

/** Proves `every` over `members` records with each call's outcome, and returns the queries it made and its timings. */
function proveEvery(top, members, outcomeOf) {
	let queries = 0;
	let slowestMs = 0;
	const began = performance.now();
	for (;;) {
		const at = performance.now();
		const attempt = engine.attempt(top, "every(n1, [call(n2)])");
		slowestMs = Math.max(slowestMs, performance.now() - at);
		queries += 1;
		if ("verdict" in attempt) {
			engine.forget(top);
			return { verdict: attempt.verdict, queries, totalMs: round(performance.now() - began), slowestQueryMs: round(slowestMs) };
		}
		const outcome = { open: "opened", close: "closed", members: `members([${members.map((m) => `'${m}'`).join(", ")}])`, call: outcomeOf(attempt.path) }[attempt.need];
		engine.record(top, attempt.need, attempt.path, outcome);
	}
}

const result = { startupMs, perSize: {} };
for (const facts of [1000, 10000]) {
	const members = Array.from({ length: Math.round(facts / FACTS_PER_RECORD) }, (_, i) => `r${i}`);
	const proved = proveEvery(`all-${facts}`, members, () => "passed");
	// The call at path [i] is the i-th member's, from 1; a refuted member ends the universal at the first that fails.
	const refuted = proveEvery(`failed-${facts}`, members, ([position]) => (position % FAILED_EVERY === 0 ? "failed" : "passed"));
	result.perSize[facts] = { records: members.length, proved, refutedAtFirstFailure: refuted };
}
console.log(JSON.stringify(result, null, 2));
