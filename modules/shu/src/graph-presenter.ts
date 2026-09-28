/**
 * The site's graph presenter, which a view embeds to draw a graph of its own: the component the site declares as
 * presenting "graph" (`ui.presents`), so an embedding view doesn't name a particular one. Mounted with `data-external`, it
 * draws only what its host gives it, the quads of the host's graph and the node the host selects, and keeps its
 * settings under the host's scope rather than the main graph's.
 */
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import type { TLinkedData } from "@haibun/core/lib/hypermedia.js";
import { getUiPresenting } from "./rels-cache.js";
import { ensureUiComponentLoaded } from "./external-components.js";

/** A node a reader opened in a presenter, reported to its host as `SHU_EVENT.GRAPH_NODE_CLICK`, which the host opens
 *  as what the node names. */
export type TPresenterNodeClick = { nodeId: string };

/** What a host asks of the presenter it embeds. */
export type TGraphPresenter = HTMLElement & {
	setQuads(quads: TQuad[], clusters?: TCluster[]): void;
	/** The node the host is on, which the graph marks as active; null where the host isn't on a node. */
	selectNode(id: string | null): void;
	/** Light these nodes and dim the rest of the graph; null ends the preview. */
	previewNodes(ids: string[] | null): void;
	/** What the presenter shows, as the chat context reads a view. */
	summarizeForKihan(): TLinkedData | null;
};

/** The component the site declares as its graph, or undefined where a deployment doesn't declare one. */
export function graphPresenterTag(): string | undefined {
	const component = getUiPresenting("graph")?.ui.component;
	return typeof component === "string" ? component : undefined;
}

/** The presenter a host holds in a slot, if it holds one. */
export function presenterIn(host: HTMLElement, slot: string): TGraphPresenter | undefined {
	return host.querySelector<TGraphPresenter>(`:scope > [slot="${slot}"]`) ?? undefined;
}

/**
 * Mount the site's graph presenter as a light-DOM child of `host`, shown where the host's template places
 * `<slot name=${slot}>`: its scene finds its camera through the document, which a shadow root hides. Its settings are
 * kept under `scope`. Resolves undefined where the site doesn't declare a presenter, or where the slot already holds one.
 */
export async function mountGraphPresenter(host: HTMLElement, slot: string, scope: string): Promise<TGraphPresenter | undefined> {
	const tag = graphPresenterTag();
	if (!tag) return undefined;
	if (!customElements.get(tag)) await ensureUiComponentLoaded(tag);
	if (presenterIn(host, slot)) return undefined;
	const presenter = document.createElement(tag) as TGraphPresenter;
	presenter.slot = slot;
	presenter.setAttribute("data-external", "");
	presenter.dataset.persistScope = scope;
	host.appendChild(presenter);
	return presenter;
}
