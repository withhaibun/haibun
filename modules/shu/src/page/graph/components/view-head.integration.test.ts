/**
 * The graph's head in a real browser, at the width of a column: its controls stay where they are while what the graph states
 * of itself changes. The counts and the latest step change as records arrive. A browser dispatches a click to the element
 * that holds both the press and the release, so a control that moves between them doesn't receive the click.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import type { TCluster } from "@haibun/core/lib/quad-types.js";
import type { TGraphPresenter } from "../../ports.js";
import { mountPolymorphicPage, quadsNamed, type TMountedPage, type TQuadFed } from "../../../test/polymorphic-page.js";

const VIEW = "shu-polymorphic-graph-view";
/** A column's width, where the head's controls and what the graph states of itself share the head. */
const COLUMN = { width: 425, height: 700 };
const FEW = quadsNamed(["e-1", "e-2"]);
const MANY_IDS = Array.from({ length: 40 }, (_, at) => `e-${at}`);
const MANY = quadsNamed(MANY_IDS);
/** A step whose line is longer than the head is wide, as a feature's lines are. */
const STEP = "s-1";
const STEP_LINE = `save the scene of graph "shu-column-pane[column-type='${VIEW}']" as "connections by kind"`;
const STEPS: TQuadFed[] = [{ subject: STEP, namedGraph: SEQ_PATH_LABEL, predicate: "stepText", object: STEP_LINE, timestamp: 1 }];
const cluster = (type: string, subjects: string[], omittedCount: number, displayLabels: Record<string, string>): TCluster => ({
	type,
	totalCount: subjects.length + omittedCount,
	sampledCount: subjects.length,
	omittedCount,
	sampledSubjects: subjects,
	displayLabels,
});

let mounted: TMountedPage;

beforeAll(async () => {
	mounted = await mountPolymorphicPage({ external: true, box: COLUMN });
}, 90_000);

afterAll(() => mounted?.close());

/** Gives the graph its quads and clusters as its host does, and waits until the graph rests and states `stated` of itself. */
async function show(quads: TQuadFed[], clusters: TCluster[], stated: string): Promise<void> {
	await mounted.page.evaluate(
		({ view, fed, by }) => (document.querySelector(view) as unknown as TGraphPresenter & { setQuads(q: unknown[], c: unknown[]): void }).setQuads(fed, by),
		{ view: VIEW, fed: quads, by: clusters },
	);
	await mounted.atRest();
	await mounted.page.waitForFunction(({ view, text }) => document.querySelector(`${view} #polymorphic-counts`)?.textContent?.includes(text), { view: VIEW, text: stated });
}

/** Where each control of the head is, by its test id, and where the graph below the head starts. */
const placed = (): Promise<Record<string, string>> =>
	mounted.page.evaluate((view) => {
		const at = (el: Element): string => {
			const r = el.getBoundingClientRect();
			return `${r.x},${r.y} ${r.width}x${r.height}`;
		};
		const controls = [...document.querySelectorAll(`${view} .view-controls [data-testid]`)].map((el) => [el.getAttribute("data-testid"), at(el)]);
		const graph = document.querySelector(`${view} .graph-area`);
		if (graph === null) throw new Error(`${view} doesn't render its graph area`);
		return Object.fromEntries([...controls, ["graph", at(graph)]]);
	}, VIEW);

test("keeps every control of the head and the graph below it in place while the counts and the latest step change", { timeout: 90_000 }, async () => {
	await show(FEW, [cluster("Email", ["e-1", "e-2"], 0, {})], "2 nodes");
	const before = await placed();
	const omitted = 12_345;
	const clusters = [cluster("Email", MANY_IDS, omitted, {}), cluster(SEQ_PATH_LABEL, [STEP], 0, { [STEP]: STEP_LINE })];
	await show([...MANY, ...STEPS], clusters, `${omitted} omitted`);
	expect(await mounted.page.locator(`${VIEW} #polymorphic-step`).textContent(), "the graph states its latest step").toBe(STEP_LINE);
	expect(await placed()).toEqual(before);
	expect(mounted.errors()).toEqual([]);
});
