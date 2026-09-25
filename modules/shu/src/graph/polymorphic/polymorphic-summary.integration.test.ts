/**
 * What the graph tells a model it shows, in a real browser: how many records the store holds of each type the graph read
 * and how many the view draws, so a type the view draws in part, or hides, is not read as a type with no records.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import { mountPolymorphicPage, type TMountedPage } from "./polymorphic-page.test-fake.js";

const [DRAWN, HIDDEN] = ["Email", "LogMessage"];
const quad = (subject: string, namedGraph: string) => ({ subject, namedGraph, predicate: "name", object: subject, timestamp: 0 });
const cluster = (type: string, subjects: string[], totalCount: number) => ({
	type,
	totalCount,
	sampledCount: subjects.length,
	omittedCount: totalCount - subjects.length,
	sampledSubjects: subjects,
	displayLabels: Object.fromEntries(subjects.map((s) => [s, s])),
});

let mounted: TMountedPage;

beforeAll(async () => {
	mounted = await mountPolymorphicPage();
}, 90_000);

afterAll(() => mounted?.close());

test("states each type's records held and drawn, a hidden type drawing none", async () => {
	const quads = [quad("e-1", DRAWN), quad("e-2", DRAWN), quad("l-1", HIDDEN)];
	const summary = await mounted.page.evaluate(
		({ quads, clusters, hidden }) => {
			const el = document.querySelector("shu-polymorphic-graph-view") as unknown as { scene: { setModel(model: unknown): void; summarizeForKihan(): unknown } };
			el.scene.setModel({ quads, visibleQuads: quads, clusters, knownClusters: new Map(), hiddenGraphs: [hidden], hiddenPredicates: [], perTypeLimit: 2, timeCursor: null });
			return el.scene.summarizeForKihan() as { typesHeld: unknown[]; items: Array<{ namedGraph: string }> };
		},
		{ quads, clusters: [cluster(DRAWN, ["e-1", "e-2"], 40), cluster(HIDDEN, ["l-1"], 7)], hidden: HIDDEN },
	);
	expect(summary.typesHeld).toEqual([
		{ type: DRAWN, held: 40, drawn: 2 },
		{ type: HIDDEN, held: 7, drawn: 0 },
	]);
	expect(summary.items.every((item) => item.namedGraph === DRAWN), "the hidden type's statements are not among what the view draws").toBe(true);
});
