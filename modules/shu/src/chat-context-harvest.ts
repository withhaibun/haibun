/**
 * Harvests a turn's view context on demand. The harvest holds the active pane's `summarizeForKihan()` linked data and a
 * manifest of every open column. The model's context then holds the view the person is looking at and the other columns
 * on screen. The chat calls the harvest when it starts a turn.
 *
 * The harvester finds the active pane by the shared `activePane` signal, which holds the pane's columnKey. The strip
 * renders its active pane from the same signal. The harvester doesn't use a DOM `active` attribute or a positional index,
 * which can lag or become stale when a pane earlier in the strip closes. The harvester recognises a view by its
 * `summarizeForKihan` method and not by `instanceof`. The polymorphic view is built into a separate bundle, which defines
 * its own ShuElement class.
 */
import { activePane } from "./page/root.js";
import { PAGE_TERMS, ViewCollectionSchema, viewCollection, type TLinkedData, type TViewCollection } from "@haibun/core/lib/hypermedia.js";

type TSummarizes = Element & { summarizeForKihan(): TLinkedData | null };

/** A pane's key in the `activePane` signal: its columnKey, or its column-type for the query pane, which doesn't have a columnKey. */
const paneKeyOf = (pane: Element): string => (pane as HTMLElement).dataset.columnKey ?? pane.getAttribute("column-type") ?? "";

const summarizes = (el: Element): el is TSummarizes => typeof (el as Partial<TSummarizes>).summarizeForKihan === "function";

/**
 * The most members of a view's collection that a page carries. It bounds the payload size, not what a model's window holds.
 * Without the bound, a view of a graph of twenty thousand statements serializes megabytes into one step argument, and a
 * model's window holds kilobytes of it. The turn selects what its window holds of the members that arrive. It states the
 * members the window held out and the call that reads them. The view's count and address accompany the members that
 * arrive, so a reader can read the members the page leaves out by paging the view.
 */
export const HARVEST_MEMBERS = 200;

/**
 * Returns a view's summary with at most `holds` members.
 *
 * A view states its members under `items`. A summary that states `items` must conform to `ViewCollectionSchema`, else
 * this function throws. A summary within the bound is returned unchanged. A bounded summary keeps the view's stated count,
 * so a reader reads how many members the view holds and not how many arrived. Where the view doesn't state a count, the
 * bounded summary states the number of members the view holds. `partOf` names the view the members came from, since the
 * page that carries them doesn't have an address of its own. A summary without `items` is returned unchanged and isn't
 * bounded. A view of that shape holds what it projects, as `shu-graph` holds the nodes and edges of one domain chain.
 */
export function harvested(summary: TLinkedData, holds = HARVEST_MEMBERS): TLinkedData {
	if (!Array.isArray(summary.items)) return summary;
	const collection = ViewCollectionSchema.safeParse(summary);
	if (!collection.success)
		throw new Error(`a view's summary states "items" but doesn't conform to ViewCollectionSchema: ${collection.error.message}. Return a view collection from summarizeForKihan.`);
	const { items, totalItems } = collection.data;
	if (items.length <= holds) return summary;
	return { ...summary, items: items.slice(0, holds), [PAGE_TERMS.partOf]: collection.data["@id"], totalItems: totalItems ?? items.length };
}

type TPaneManifestEntry = { name: string; component: string; active: boolean };

/** The manifest block appended to every harvest, with one member per open column. A model reads the workspace's columns
 *  beyond the active pane from it, and its tool calls can read another pane's subject through the graph steps. */
type TPaneManifest = TViewCollection & { items: TPaneManifestEntry[] };

export function harvestChatViewLd(root: ParentNode = document): TLinkedData[] {
	const strip = root.querySelector("shu-column-strip");
	if (!strip) return [];
	// A pane whose `activates` is false isn't a column of the workspace. The reader acts on other views through its view,
	// as through the actions bar's view.
	const allPanes = Array.from(strip.querySelectorAll("shu-column-pane"));
	const panes = allPanes.filter((pane) => (pane as Element & { activates?: boolean }).activates !== false);
	if (panes.length === 0) return [];
	const activeKey = activePane.get();
	// The active pane is the pane the router named. It can be a column of the workspace, or a pane the manifest doesn't
	// count as a column, such as the actions bar's pane. Either pane is on screen, so the harvest reads its view.
	const active = allPanes.find((p) => paneKeyOf(p) === activeKey);
	// With panes open, one of them is the active pane. The router is the only writer of activePane. A key that doesn't
	// match an open pane means the signal and the strip are out of sync. A harvest with that key would produce a prompt
	// stating that the reader hasn't selected a view while a view is on screen.
	if (!active)
		throw new Error(
			`harvestChatViewLd: activePane is ${JSON.stringify(activeKey)}, which isn't one of the ${panes.length} open pane(s): [${panes.map((p) => JSON.stringify(paneKeyOf(p))).join(", ")}]. The pane router is the only writer of activePane. Check where the router sets it.`,
		);
	const blocks: TLinkedData[] = [];
	for (const el of topSummarizers(active)) {
		const summary = el.summarizeForKihan();
		if (summary == null) continue;
		try {
			blocks.push(harvested(summary));
		} catch (err) {
			// A summary that ViewCollectionSchema rejects is a fault in its view. The error names the view's tag, so a
			// developer can find the view.
			throw new Error(`${el.tagName.toLowerCase()}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	const manifest = viewCollection({
		id: "view:panes",
		name: "every open column in the workspace; the active pane's content is included in this context, and another pane's subject can be fetched through the graph steps by its name or type",
		items: panes.map((p) => ({
			name: p.getAttribute("label") ?? p.getAttribute("column-type") ?? "",
			component: topSummarizers(p)[0]?.tagName.toLowerCase() ?? p.firstElementChild?.tagName.toLowerCase() ?? "",
			active: p === active,
		})),
	}) as TPaneManifest;
	blocks.push(manifest);
	return blocks;
}

/** Returns the top-most summarizers in a pane's light DOM. A wrapper can contain a view, as the query pane's wrapper does.
 *  A composite view summarizes its whole subtree, so the summarizers nested in it are left out. The polymorphic view host
 *  is a composite view over its scene. */
function topSummarizers(pane: Element | undefined): TSummarizes[] {
	if (!pane) return [];
	const candidates = Array.from(pane.querySelectorAll("*")).filter(summarizes);
	return candidates.filter((el) => !candidates.some((other) => other !== el && other.contains(el)));
}
