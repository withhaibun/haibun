// The engine's query cost on a large actuality, in the shape of the reasoner spike's Q6: about 1,000 and 10,000 facts of
// step records (six facts a record), proved as `every x in records is S` where each member is a built-in call. One query
// starts the proof and each effect resumes it, so the cost of each member's call stays the same as the members grow. Run it
// after the module builds: `npm run bench`.
import { startSwipl } from "../build/adapters/swipl.js";

const FACTS_PER_RECORD = 6;
/** Every 37th record's call fails, as the spike's actuality states every 37th step failed. */
const FAILED_EVERY = 37;
const round = (ms) => Math.round(ms * 1000) / 1000;

const started = performance.now();
const engine = await startSwipl();
const startupMs = round(performance.now() - started);

/** Proves `every` over `members` records with each call's outcome, and returns its queries and timings. */
function proveEvery(top, members, outcomeOf) {
	const performed = { open: () => "opened", close: () => "closed", members: () => `members([${members.map((m) => `'${m}'`).join(", ")}])`, call: outcomeOf };
	const callMs = [];
	let queries = 1;
	const began = performance.now();
	let outcome = engine.prove(top, "every(n1, [call(n2)])");
	while ("need" in outcome) {
		const { need } = outcome;
		const answer = performed[need](outcome.path);
		const at = performance.now();
		outcome = engine.resume(top, answer);
		if (need === "call") callMs.push(performance.now() - at);
		queries += 1;
	}
	const totalMs = performance.now() - began;
	engine.forget(top);
	callMs.sort((a, b) => a - b);
	const at = (q) => round(callMs[Math.min(callMs.length - 1, Math.floor(q * callMs.length))]);
	return { verdict: outcome.verdict, queries, totalMs: round(totalMs), callMedianMs: at(0.5), callP95Ms: at(0.95), callMaxMs: at(1) };
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
