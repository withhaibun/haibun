/**
 * Mounts the site's graph presenter in a view that draws a graph of its own. The presenter is the component the site
 * declares as presenting "graph" (`ui.presents`), so an embedding view doesn't name a particular component. A presenter
 * mounted with `data-external` draws only what its host gives it. The host gives it the quads of the host's graph and the
 * node the host selects. The presenter keeps its settings under the host's scope instead of the main graph's.
 */
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import type { TLinkedData } from "@haibun/core/lib/hypermedia.js";
import { getUiPresenting } from "./rels-cache.js";
import { ensureUiComponentLoaded } from "./external-components.js";

/** A node a reader opened in a presenter. The presenter reports it to its host as `SHU_EVENT.GRAPH_NODE_CLICK`, and
 *  the host opens the resource the node names. */
export type TPresenterNodeClick = { nodeId: string };

/** The methods a host calls on the presenter it embeds. */
export type TGraphPresenter = HTMLElement & {
	setQuads(quads: TQuad[], clusters?: TCluster[]): void;
	/** Marks the host's current node as active in the graph. `null` means the host isn't on a node. */
	selectNode(id: string | null): void;
	/** Highlights these nodes and dims the rest of the graph. `null` ends the preview. */
	previewNodes(ids: string[] | null): void;
	/** Returns a summary of what the presenter shows, in the form the chat context reads from each view. */
	summarizeForKihan(): TLinkedData | null;
};

/** Returns the component the site declares as its graph presenter, or undefined where a deployment doesn't declare one. */
export function graphPresenterTag(): string | undefined {
	const component = getUiPresenting("graph")?.ui.component;
	return typeof component === "string" ? component : undefined;
}

/** Returns the presenter a host holds in a slot, or undefined where the host doesn't hold one. */
export function presenterIn(host: HTMLElement, slot: string): TGraphPresenter | undefined {
	return host.querySelector<TGraphPresenter>(`:scope > [slot="${slot}"]`) ?? undefined;
}

/**
 * Mounts the site's graph presenter as a light-DOM child of `host`. The host's template shows it at `<slot name=${slot}>`.
 * The presenter's scene finds its camera through the document, and a shadow root would hide the camera from that lookup.
 * The presenter keeps its settings under `scope`. Resolves undefined where the site doesn't declare a presenter or where
 * the slot already holds one.
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
