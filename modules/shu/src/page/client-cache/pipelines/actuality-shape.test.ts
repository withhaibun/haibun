// The shape of an actuality, drawn from counts rather than rows: a reader looking at a decade reads what a reader looking at
// an hour does, and an actuality that grows is counted only where it has grown. Every reading states the graph it reads, so
// these read a store made here and don't install a store.
import { describe, it, expect } from "vitest";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { LOG_MESSAGE_LABEL } from "@haibun/core/lib/domains/log-message.js";
import { Access, SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { SEQ_PATH_FIELD } from "@haibun/core/lib/seq-path.js";
import type { TPageDensity } from "../../pipelines/read-records.js";
import { MARK_COLOUR } from "../../derivations/status-mark.js";
import { ofActualityFeature } from "../derivations/actuality-graph.js";
import type { TActualityGraph } from "../ports.js";
import { actualityShape as shapeOver } from "./actuality-shape.js";
import { ACTUALITY_TYPES } from "../derivations/actuality-rows.js";
import { actualityGraphOver, actualityStore } from "../actuality-store.test-fake.js";

/** The shape of an actuality at the level a step reports at, in `divisions`. */
const actualityShape = (graph: TActualityGraph, { divisions }: { divisions: number }) => shapeOver(graph, { minLevel: "info", divisions });

const RUN = "1700000000000-1";
const iso = (n: number): string => new Date(n).toISOString();

/** An actuality of the steps and messages given, and what was counted of it: the store is added to as an actuality adds to itself. */
const anActuality = async (steps: Array<{ at: number; status: string }> = [], said: Array<{ at: number; level: string }> = []) => {
	const store = actualityStore();
	const counted: TPageDensity[] = [];
	const addStep = async (at: number, status: string, i: number) =>
		store.upsertIndividual(SEQ_PATH_LABEL, {
			id: `${RUN}.0.${i}`,
			actuality: RUN,
			stepText: `step ${i}`,
			actionStatus: status,
			level: "info",
			generatedAtTime: iso(at),
			accessLevel: Access.public,
		});
	const addSaid = async (at: number, level: string, i: number) =>
		store.upsertIndividual(LOG_MESSAGE_LABEL, { id: `${RUN}.0.${i}@${i}`, actuality: RUN, message: `said ${i}`, level, generatedAtTime: iso(at), accessLevel: Access.public });
	for (const [i, s] of steps.entries()) await addStep(s.at, s.status, i);
	for (const [i, m] of said.entries()) await addSaid(m.at, m.level, 100 + i);
	const over = actualityGraphOver(store);
	const graph: TActualityGraph = { ...over, density: (query) => (counted.push(query), over.density(query)) };
	let more = steps.length;
	return { graph, store, counted, step: (at: number, status: string) => addStep(at, status, more++) };
};

describe("the shape of an actuality, by division", () => {
	it("returns one mark per division, in the order of the divisions", async () => {
		const { graph } = await anActuality([
			{ at: 1000, status: "passed" },
			{ at: 3000, status: "passed" },
		]);
		const shape = actualityShape(graph, { divisions: 3 });
		await shape.update(3000);
		expect(
			shape.marks.map((m) => m.at),
			"a mark carries the moment its division begins, which is what places it on a rail",
		).toEqual([shape.beginningOf(0), shape.beginningOf(2)]);
	});

	it("draws in the divisions requested whatever actuality's length, since the divisions are the size of what it returns", async () => {
		const anHour = await anActuality([
			{ at: 1000, status: "passed" },
			{ at: 1000 + 3600_000, status: "passed" },
		]);
		const aDecade = await anActuality([
			{ at: 1000, status: "passed" },
			{ at: 1000 + 3600_000 * 24 * 3650, status: "passed" },
		]);
		const hour = actualityShape(anHour.graph, { divisions: 4 });
		const decade = actualityShape(aDecade.graph, { divisions: 4 });
		await hour.update(1000 + 3600_000);
		await decade.update(1000 + 3600_000 * 24 * 3650);
		expect(hour.marks.every((m) => m.at < hour.beginningOf(4))).toBe(true);
		expect(decade.marks.every((m) => m.at < decade.beginningOf(4))).toBe(true);
		expect(aDecade.counted.length, "a decade is counted in as many reads as an hour").toBe(anHour.counted.length);
	});

	it("marks a division holding a failure as a failure, among however many passes", async () => {
		const { graph } = await anActuality([...Array.from({ length: 20 }, (_, i) => ({ at: 1000 + i, status: "passed" })), { at: 1010, status: "failed" }]);
		const shape = actualityShape(graph, { divisions: 1 });
		await shape.update(1020);
		expect(itemAt(shape.marks, 0).color).toBe(MARK_COLOUR.fault);
	});

	it("marks a division by what it holds most of, counting what actuality logged as well as what it did", async () => {
		const { graph } = await anActuality(
			[{ at: 1000, status: "passed" }],
			[
				{ at: 1001, level: "warn" },
				{ at: 1002, level: "warn" },
				{ at: 1003, level: "warn" },
			],
		);
		const shape = actualityShape(graph, { divisions: 1 });
		await shape.update(1003);
		expect(itemAt(shape.marks, 0).color).toBe(MARK_COLOUR.pending);
	});

	it("doesn't mark a division where actuality doesn't hold a record, and doesn't count one either", async () => {
		const { graph, counted } = await anActuality([]);
		const shape = actualityShape(graph, { divisions: 4 });
		await shape.update(2000);
		expect(shape.marks).toEqual([]);
		expect(counted, "an actuality without records doesn't have a shape to count").toEqual([]);
	});

	it("leaves out what the level a reader is shown does not carry", async () => {
		const { graph } = await anActuality(
			[],
			[
				{ at: 1000, level: "debug" },
				{ at: 1001, level: "error" },
			],
		);
		const shape = actualityShape(graph, { divisions: 1 });
		await shape.update(1001);
		expect(shape.marks.length, "the debug message is not shown at this level, the error is").toBe(1);
		expect(itemAt(shape.marks, 0).color).toBe(MARK_COLOUR.fault);
	});

	it("is the shape of one actuality feature, over a store holding more than one", async () => {
		const { graph, store } = await anActuality([
			{ at: 1000, status: "passed" },
			{ at: 3000, status: "passed" },
		]);
		const other = "1700000009000-2";
		for (const at of [1500, 2000, 2500])
			await store.upsertIndividual(SEQ_PATH_LABEL, {
				[SEQ_PATH_FIELD.id]: `${other}.0.${at}`,
				[SEQ_PATH_FIELD.actuality]: other,
				stepText: "another actuality feature's step",
				actionStatus: "failed",
				level: "info",
				generatedAtTime: iso(at),
				accessLevel: Access.public,
			});
		const shape = actualityShape(ofActualityFeature(graph, RUN), { divisions: 3 });
		await shape.update(3000);
		expect(
			shape.marks.map((m) => m.at),
			"the divisions the other actuality feature wrote in don't hold a record of this one",
		).toEqual([shape.beginningOf(0), shape.beginningOf(2)]);
	});

	it("takes counts in turn, so a count requested while another awaits the store counts from what that one wrote", async () => {
		const { graph, counted } = await anActuality([
			{ at: 1000, status: "passed" },
			{ at: 2000, status: "passed" },
			{ at: 3000, status: "failed" },
		]);
		const readsOfWhereActualityBegins = ACTUALITY_TYPES.length * 2;
		let answer = (): void => undefined;
		const answered = new Promise<void>((resolve) => {
			answer = resolve;
		});
		let asked = 0;
		const slowAtFirst: TActualityGraph = { ...graph, query: (query) => (asked++ < readsOfWhereActualityBegins ? answered.then(() => graph.query(query)) : graph.query(query)) };
		const shape = actualityShape(slowAtFirst, { divisions: 4 });
		const earlier = shape.update(2000);
		const later = shape.update(3000);
		await new Promise((ran) => setImmediate(ran));
		answer();
		await Promise.all([earlier, later]);
		for (const query of counted) expect(query.buckets, "a count reads one division or more").toBeGreaterThan(0);
		expect(shape.marks.at(-1)?.color, "the failure the later count reached is marked").toBe(MARK_COLOUR.fault);
	});

	it("counts only what actuality has recorded since the last count", async () => {
		const { graph, counted, step } = await anActuality([
			{ at: 1000, status: "passed" },
			{ at: 1100, status: "passed" },
			{ at: 1200, status: "passed" },
			{ at: 1300, status: "passed" },
		]);
		const shape = actualityShape(graph, { divisions: 4 });
		await shape.update(1300);
		const first = counted.length;
		await step(1350, "passed");
		await shape.update(1350);
		const since = counted.slice(first);
		expect(since.length, "one read per type counted, over the stretch actuality has grown by").toBe(first);
		expect(
			since.every((q) => Date.parse(q.from) > 1000),
			"the divisions already counted are not read again",
		).toBe(true);
	});

	it("doesn't read the store again where actuality has not moved since it was counted", async () => {
		const { graph, counted } = await anActuality([
			{ at: 1000, status: "passed" },
			{ at: 1300, status: "passed" },
		]);
		const shape = actualityShape(graph, { divisions: 4 });
		await shape.update(1300);
		const first = counted.length;
		await shape.update(1300);
		expect(counted.length).toBe(first);
	});

	it("doubles the division when actuality outgrows the grid, adding the counts either side of each new boundary rather than reading them again", async () => {
		const { graph, counted, step } = await anActuality([
			{ at: 1000, status: "failed" },
			{ at: 1100, status: "failed" },
			{ at: 1200, status: "passed" },
			{ at: 1300, status: "passed" },
		]);
		const shape = actualityShape(graph, { divisions: 4 });
		await shape.update(1300);
		const first = counted.length;
		const wide = shape.beginningOf(1) - shape.beginningOf(0);
		await step(1500, "passed");
		await shape.update(1500);
		const since = counted.slice(first);
		expect(
			since.every((q) => Date.parse(q.from) > 1100),
			"the stretch holding the failures is not read again",
		).toBe(true);
		expect(shape.marks.find((m) => m.at === shape.beginningOf(0))?.color, "what the merged divisions held is what the division that replaced them holds").toBe(MARK_COLOUR.fault);
		expect(shape.beginningOf(1) - shape.beginningOf(0), "each division covers twice the stretch it did").toBe(wide * 2);
	});
});
