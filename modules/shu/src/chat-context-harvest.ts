/**
 * Harvest the chat-context view payload on demand: the ACTIVE pane's `summarizeForKihan()` linked data plus a
 * manifest of every open column, so the model sees what the person is looking at and knows what else is on
 * screen. One shared primitive: the chat dispatch and the context-status badge must see the identical envelope.
 *
 * The active pane is found by the shared `activePane` signal (its columnKey), the one source of truth the strip also
 * paints from, never by a DOM `active` attribute or a positional index, which could lag or go stale when a pane
 * earlier in the strip closes. Views are recognised by the presence of `summarizeForKihan` (duck-typed, not instanceof:
 * the polymorphic view lives in a separately-built bundle whose ShuElement class identity differs).
 */
import { activePane } from "./signals.js";
import { ViewCollectionSchema, viewCollection, type TLinkedData, type TViewCollection } from "@haibun/core/lib/hypermedia.js";

type TSummarizes = Element & { summarizeForKihan(): TLinkedData | null };

/** A pane's key in the `activePane` signal: its columnKey, or its column-type for the query pane (which has none). */
const paneKeyOf = (pane: Element): string => (pane as HTMLElement).dataset.columnKey ?? pane.getAttribute("column-type") ?? "";

const summarizes = (el: Element): el is TSummarizes => typeof (el as Partial<TSummarizes>).summarizeForKihan === "function";

/**
 * How many members of a view's collection a page carries. A view of a graph of twenty thousand statements serialized
 * megabytes into one step argument to deliver kilobytes of it. What a model's window then holds is the asker's to
 * decide, after this arrives, so a view states its members in the order it wants them read and every view is carried
 * the same way.
 */
export const HARVEST_MEMBERS = 200;

/**
 * A view's summary with its members kept to what a page carries.
 *
 * A view states its members under `items`, and a block stating them is held to the view's collection. The count the view
 * stated stands, so a reader is told how many the view holds rather than how many arrived, and `partOf` names the view
 * they came from. A view stating no members is carried as it stated itself, and a page bounds nothing of it: a view of
 * that shape holds what it projects, as `shu-graph` holds the nodes and edges of one domain chain.
 */
export function harvested(summary: TLinkedData, holds = HARVEST_MEMBERS): TLinkedData {
	if (!Array.isArray((summary as Record<string, unknown>).items)) return summary;
	const collection = ViewCollectionSchema.safeParse(summary);
	if (!collection.success) throw new Error(`a view states its members under "items", so it states the view's collection with them: ${collection.error.message}`);
	const { items, totalItems } = collection.data;
	if (items.length <= holds) return summary;
	return { ...summary, items: items.slice(0, holds), partOf: collection.data["@id"], totalItems };
}

export type TPaneManifestEntry = { name: string; component: string; active: boolean };

/** The manifest block appended to every harvest: one member per open column. The model reads this to know the
 *  workspace's shape beyond the active pane, and can pull another pane's subject through the graph steps. */
export type TPaneManifest = TViewCollection & { items: TPaneManifestEntry[] };

export function harvestChatViewLd(root: ParentNode = document): TLinkedData[] {
	const strip = root.querySelector("shu-column-strip");
	if (!strip) return [];
	// A pane whose view the reader acts on another view through, as the actions bar's, isn't a column of the workspace.
	const panes = Array.from(strip.querySelectorAll("shu-column-pane")).filter((pane) => (pane as Element & { activates?: boolean }).activates !== false);
	if (panes.length === 0) return [];
	const activeKey = activePane.get();
	const active = panes.find((p) => paneKeyOf(p) === activeKey);
	// With panes open, one of them is the pane you are on: the router sets activePane and is its only writer. A key that
	// matches none of them means the signal and the strip have gone out of step, and harvesting anyway would tell a
	// model that nothing is selected while a view is plainly on screen.
	if (!active)
		throw new Error(
			`harvestChatViewLd: activePane is ${JSON.stringify(activeKey)}, which is none of the ${panes.length} open pane(s): [${panes.map((p) => JSON.stringify(paneKeyOf(p))).join(", ")}]. The pane router is the only writer of activePane.`,
		);
	const blocks: TLinkedData[] = [];
	for (const el of topSummarizers(active)) {
		const summary = el.summarizeForKihan();
		if (summary != null) blocks.push(harvested(summary));
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

/** Top-most summarizers in a pane's light DOM: a view may sit inside a wrapper (the query pane's does), and a
 *  composite view (the polymorphic view host over its scene) summarizes for its whole subtree, nested summarizers are its own. */
function topSummarizers(pane: Element | undefined): TSummarizes[] {
	if (!pane) return [];
	const candidates = Array.from(pane.querySelectorAll("*")).filter(summarizes);
	return candidates.filter((el) => !candidates.some((other) => other !== el && other.contains(el)));
}
