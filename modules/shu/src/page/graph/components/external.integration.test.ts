/**
 * A graph a view embeds to draw its own data (`data-external`), in a real browser: it draws what its host gives it and
 * doesn't read from the store, not even when the reader hides a type; it marks the node its host selects and lights
 * the nodes its host previews; and a node the reader opens is reported to the host, which holds what its nodes name,
 * rather than opened as a record. Each is read as the graph's reading states it.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import { SHU_EVENT } from "../../../domains/elements.js";
import { SHU_TEST_IDS } from "../../../domains/test-ids.js";
import type { TGraphPresenter } from "../../ports.js";
import { mountPolymorphicPage, type TMountedPage } from "../../../test/polymorphic-page.js";

const EMAILS = ["e-1", "e-2", "e-3"];
const PEOPLE = ["p-1", "p-2"];
const quadsOf = (type: string, ids: string[]) => ids.map((id) => ({ subject: id, namedGraph: type, predicate: "name", object: id, timestamp: 0 }));
const QUADS = [...quadsOf("Email", EMAILS), ...quadsOf("Person", PEOPLE)];
const VIEW = "shu-polymorphic-graph-view";

let mounted: TMountedPage;

beforeAll(async () => {
	mounted = await mountPolymorphicPage({ external: true });
}, 90_000);

afterAll(() => mounted?.close());

/** The host's side of the embedded graph: what it calls on the view. */
const host = <A>(fn: (embedded: TGraphPresenter, arg: A) => void, arg: A) =>
	mounted.page.evaluate(`(${fn})(document.querySelector(${JSON.stringify(VIEW)}), ${JSON.stringify(arg)})`);

/** The nodes the reading doesn't state dimmed. */
const lit = async (): Promise<string[]> => (await mounted.reading()).filter((entry) => !entry.dimmed).map((entry) => entry.id);

test("draws what its host gives it, and hides a type the reader hides without reading the store", { timeout: 60_000 }, async () => {
	const asked = await mounted.dispatched();
	await host((embedded, quads) => embedded.setQuads(quads), QUADS);
	await mounted.draws(QUADS.length);
	await mounted.atRest();
	await mounted.page.evaluate(
		(view) =>
			(document.querySelector(`${view} shu-graph-filter`) as unknown as { setTypeVisibility(types: string[], visible: boolean): void }).setTypeVisibility(["Person"], false),
		VIEW,
	);
	await mounted.draws(EMAILS.length);
	await mounted.atRest();
	expect(await mounted.dispatched(), "the calls the page made of its site").toEqual(asked);
	expect(mounted.errors()).toEqual([]);
});

test("marks the node its host selects, lights the nodes its host previews, and reports a node the reader opens", { timeout: 60_000 }, async () => {
	await host((embedded, id) => embedded.selectNode(id), "e-1");
	expect((await mounted.reading()).filter((entry) => entry.active).map((entry) => entry.id)).toEqual(["e-1"]);

	await host((embedded, ids) => embedded.previewNodes(ids), ["e-2"]);
	expect(await lit()).toEqual(["e-2"]);
	await host((embedded, ids) => embedded.previewNodes(ids), null);
	expect(await lit()).toContain("e-1");

	const reported = await mounted.page.evaluate(
		({ entry, clicked, opened }) => {
			const heard = { clicked: [] as string[], opened: 0 };
			document.addEventListener(clicked, (e) => heard.clicked.push((e as CustomEvent<{ nodeId: string }>).detail.nodeId));
			document.addEventListener(opened, () => heard.opened++);
			document.querySelector<HTMLElement>(entry)?.click();
			return heard;
		},
		{ entry: `${VIEW} [data-testid="${SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y}"] [data-node-id="e-3"]`, clicked: SHU_EVENT.GRAPH_NODE_CLICK, opened: SHU_EVENT.PANE_OPEN },
	);
	expect(reported).toEqual({ clicked: ["e-3"], opened: 0 });
});
