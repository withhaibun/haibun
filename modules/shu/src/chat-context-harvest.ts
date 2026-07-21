/**
 * Harvest the chat-context view payload on demand: the ACTIVE pane's `summarizeForKihan()` linked data plus a
 * manifest of every open column, so the model sees what the person is looking at and knows what else is on
 * screen. One shared primitive — the chat dispatch and the context-status badge must see the identical envelope.
 *
 * The active pane is found by its reflected `active` attribute, never by the strip's `activeIndex` state: the
 * index is positional and goes stale when a pane earlier in the strip closes, which made the harvest read a
 * neighbouring pane. Views are recognised by the presence of `summarizeForKihan` (duck-typed, not instanceof —
 * the fisheye view lives in a separately-built bundle whose ShuElement class identity differs).
 */

type TSummarizes = Element & { summarizeForKihan(): unknown | null };

const summarizes = (el: Element): el is TSummarizes => typeof (el as Partial<TSummarizes>).summarizeForKihan === "function";

export type TPaneManifestEntry = { name: string; component: string; active: boolean };

/** The manifest block appended to every harvest: an `as:Collection` with one item per open column. The model reads
 *  this to know the workspace's shape beyond the active pane, and can pull another pane's subject through the graph steps. */
export type TPaneManifest = { "@id": "view:panes"; "@type": "as:Collection"; name: string; totalItems: number; items: TPaneManifestEntry[] };

export function harvestChatViewLd(root: ParentNode = document): unknown[] {
	const strip = root.querySelector("shu-column-strip");
	if (!strip) return [];
	const panes = Array.from(strip.querySelectorAll("shu-column-pane"));
	if (panes.length === 0) return [];
	const active = panes.find((p) => p.hasAttribute("active"));
	const blocks: unknown[] = [];
	for (const el of topSummarizers(active)) {
		const summary = el.summarizeForKihan();
		if (summary != null) blocks.push(summary);
	}
	const manifest: TPaneManifest = {
		"@id": "view:panes",
		"@type": "as:Collection",
		name: "every open column in the workspace; the active pane's content is included in this context, and another pane's subject can be fetched through the graph steps by its name or type",
		totalItems: panes.length,
		items: panes.map((p) => ({
			name: p.getAttribute("label") ?? p.getAttribute("column-type") ?? "",
			component: topSummarizers(p)[0]?.tagName.toLowerCase() ?? p.firstElementChild?.tagName.toLowerCase() ?? "",
			active: p === active,
		})),
	};
	blocks.push(manifest);
	return blocks;
}

/** Top-most summarizers in a pane's light DOM: a view may sit inside a wrapper (the query pane's does), and a
 *  composite view (the fisheye host over its scene) summarizes for its whole subtree — nested summarizers are its own. */
function topSummarizers(pane: Element | undefined): TSummarizes[] {
	if (!pane) return [];
	const candidates = Array.from(pane.querySelectorAll("*")).filter(summarizes);
	return candidates.filter((el) => !candidates.some((other) => other !== el && other.contains(el)));
}
