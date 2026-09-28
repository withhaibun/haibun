/**
 * A graph a view embeds to draw its own data (`data-external`), in a real browser: it draws what its host gives it and
 * doesn't read from the store, not even when the reader hides a type; it marks the node its host selects and lights
 * the nodes its host previews; and a node the reader opens is reported to the host, which knows what its nodes name,
 * rather than opened as a record.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import { SHU_EVENT } from "../../consts.js";
import { mountPolymorphicPage, type TMountedPage } from "./polymorphic-page.test-fake.js";

const EMAILS = ["e-1", "e-2", "e-3"];
const PEOPLE = ["p-1", "p-2"];
const quadsOf = (type: string, ids: string[]) => ids.map((id) => ({ subject: id, namedGraph: type, predicate: "name", object: id, timestamp: 0 }));
const QUADS = [...quadsOf("Email", EMAILS), ...quadsOf("Person", PEOPLE)];
const VIEW = "shu-polymorphic-graph-view";

type TEmbedded = {
	setQuads(quads: unknown[]): void;
	selectNode(id: string | null): void;
	previewNodes(ids: string[] | null): void;
	openNode(id: string): boolean;
	refetchSnapshot(...args: unknown[]): unknown;
	inspect(): { nodes: number; highlighted: number; sample: Array<{ id: string; opacity: number | null }> };
};

let mounted: TMountedPage;

beforeAll(async () => {
	mounted = await mountPolymorphicPage({ external: true });
}, 90_000);

afterAll(() => mounted?.close());

/** Wait until the view draws `count` nodes, at rest. */
async function draws(count: number): Promise<void> {
	await mounted.page.waitForFunction(({ view, n }) => (document.querySelector(view) as unknown as TEmbedded).inspect().nodes === n, { view: VIEW, n: count }, { timeout: 30_000 });
	await mounted.settle();
}

test("draws what its host gives it, and hides a type the reader hides without reading the store", { timeout: 60_000 }, async () => {
	await mounted.page.evaluate(
		({ view, quads }) => {
			const embedded = document.querySelector(view) as unknown as TEmbedded;
			const probe = window as unknown as { storeReads: number };
			probe.storeReads = 0;
			const read = embedded.refetchSnapshot.bind(embedded);
			embedded.refetchSnapshot = (...args: unknown[]) => {
				probe.storeReads++;
				return read(...args);
			};
			embedded.setQuads(quads);
		},
		{ view: VIEW, quads: QUADS },
	);
	await draws(QUADS.length);
	await mounted.page.evaluate(
		(view) =>
			(document.querySelector(`${view} shu-graph-filter`) as unknown as { setTypeVisibility(types: string[], visible: boolean): void }).setTypeVisibility(["Person"], false),
		VIEW,
	);
	await draws(EMAILS.length);
	expect(await mounted.page.evaluate(() => (window as unknown as { storeReads: number }).storeReads)).toBe(0);
	expect(mounted.errors()).toEqual([]);
});

test("marks the node its host selects, lights the nodes its host previews, and reports a node the reader opens", { timeout: 60_000 }, async () => {
	await mounted.page.evaluate((view) => (document.querySelector(view) as unknown as TEmbedded).selectNode("e-1"), VIEW);
	await mounted.page.waitForFunction((view) => (document.querySelector(view) as unknown as TEmbedded).inspect().highlighted === 1, VIEW, { timeout: 10_000 });

	const lit = (): Promise<string[]> =>
		mounted.page.evaluate(
			(view) =>
				(document.querySelector(view) as unknown as TEmbedded)
					.inspect()
					.sample.filter((s) => (s.opacity ?? 1) > 0.9)
					.map((s) => s.id),
			VIEW,
		);
	await mounted.page.evaluate((view) => (document.querySelector(view) as unknown as TEmbedded).previewNodes(["e-2"]), VIEW);
	expect(await lit()).toEqual(["e-2"]);
	await mounted.page.evaluate((view) => (document.querySelector(view) as unknown as TEmbedded).previewNodes(null), VIEW);
	expect(await lit()).toContain("e-1");

	const reported = await mounted.page.evaluate(
		({ view, clicked, opened }) => {
			const heard = { clicked: [] as string[], opened: 0 };
			document.addEventListener(clicked, (e) => heard.clicked.push((e as CustomEvent<{ nodeId: string }>).detail.nodeId));
			document.addEventListener(opened, () => heard.opened++);
			(document.querySelector(view) as unknown as TEmbedded).openNode("e-3");
			return heard;
		},
		{ view: VIEW, clicked: SHU_EVENT.GRAPH_NODE_CLICK, opened: SHU_EVENT.PANE_OPEN },
	);
	expect(reported).toEqual({ clicked: ["e-3"], opened: 0 });
});
