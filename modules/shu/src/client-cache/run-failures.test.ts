// The failures of a run, read as records: what the bar marks as a fault is what this lists, and a run of any length
// costs the same to list. Every reading states the graph it reads, so these read a store made here and install nothing.
import { describe, it, expect } from "vitest";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { LOG_MESSAGE_LABEL } from "@haibun/core/lib/log-message.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { runGraphOf, type TRunGraph } from "./run-graph.js";
import { runFailures } from "./run-failures.js";

const RUN = "1700000000000-1";
const iso = (n: number): string => new Date(n).toISOString();

/** A run of the steps and messages given. */
const aRun = async (steps: Array<{ at: number; status: string }> = [], said: Array<{ at: number; level: string }> = []): Promise<TRunGraph> => {
	const store = new QuadStore();
	for (const [i, s] of steps.entries()) {
		await store.upsertIndividual(SEQ_PATH_LABEL, { id: `${RUN}.0.${i}`, execution: RUN, stepText: `step ${i}`, actionStatus: s.status, level: "info", generatedAtTime: iso(s.at), ...(s.status === "failed" ? { error: `step ${i} would not run` } : {}) });
	}
	for (const [i, m] of said.entries()) {
		await store.upsertIndividual(LOG_MESSAGE_LABEL, { id: `${RUN}.0.${i}@${i}`, execution: RUN, message: `said ${i}`, level: m.level, generatedAtTime: iso(m.at) });
	}
	return runGraphOf(store);
};

describe("the failures of a run, as records", () => {
	it("lists a step that failed and a message reporting an error, and nothing that passed", async () => {
		const graph = await aRun(
			[
				{ at: 1000, status: "passed" },
				{ at: 2000, status: "failed" },
			],
			[
				{ at: 3000, level: "info" },
				{ at: 4000, level: "error" },
			],
		);
		expect((await runFailures(graph)).map((row) => row.text)).toEqual(["said 1", "step 1"]);
	});

	it("says why a step failed, so a reader reads the failure rather than the step alone", async () => {
		const graph = await aRun([{ at: 2000, status: "failed" }]);
		expect((await runFailures(graph))[0]).toMatchObject({ kind: "step", status: "failed", error: "step 0 would not run", at: 2000 });
	});

	it("lists the newest failures at the cap, so a run holding more than a reader reads is still one read", async () => {
		const graph = await aRun(Array.from({ length: 8 }, (_, i) => ({ at: 1000 + i * 1000, status: "failed" })));
		expect((await runFailures(graph, { limit: 3 })).map((row) => row.text)).toEqual(["step 7", "step 6", "step 5"]);
	});

	it("lists nothing for a run that failed nothing", async () => {
		const graph = await aRun([{ at: 1000, status: "passed" }], [{ at: 2000, level: "warn" }]);
		expect(await runFailures(graph)).toEqual([]);
	});

	it("asks nothing of a graph that carries neither type", async () => {
		const asked: string[] = [];
		const graph: TRunGraph = { query: async (q) => (asked.push(String(q.label)), { vertices: [], total: 0 }), density: async () => ({ buckets: [] }), declares: () => false };
		expect(await runFailures(graph)).toEqual([]);
		expect(asked).toEqual([]);
	});
});
