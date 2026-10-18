/**
 * Mounts the site's graph presenter in a view that draws a graph of its own. The presenter is the component the site
 * declares as presenting "graph" (`ui.presents`), so an embedding view doesn't name a component. A presenter mounted with
 * `data-external` draws only what its host gives it: the quads of the host's graph and the node the host selects. It keeps
 * its settings under the host's scope, apart from the main graph's.
 */
import { uiPresenting, type TCatalog } from "../derivations/catalog.js";
import { loadDeclaredComponent } from "./declared-component.js";
import type { TClientLog, TElements, TGraphPresenter, TPresenterMount } from "../ports.js";

/** Returns the component `catalog` declares as the site's graph presenter, or undefined where the deployment doesn't declare one. */
export function graphPresenterTag(catalog: TCatalog): string | undefined {
	const presenting = uiPresenting(catalog, "graph");
	if (presenting === undefined) return undefined;
	const { component } = presenting.ui;
	if (typeof component !== "string") throw new Error(`the concern that presents "graph" names its component as ${typeof component}, where a tag is a string`);
	return component;
}

/** Mounts the site's graph presenter as a light-DOM child of `host`, shown at `<slot name=${slot}>`. The presenter's scene
 *  finds its camera through the document, which a shadow root hides. The presenter keeps its settings under `scope`.
 *  Resolves undefined where the site doesn't declare a presenter, or where the slot holds one. */
export async function mountGraphPresenter(
	mount: TPresenterMount,
	elements: TElements,
	catalog: () => TCatalog,
	host: HTMLElement,
	slot: string,
	scope: string,
	log: TClientLog,
): Promise<TGraphPresenter | undefined> {
	const tag = graphPresenterTag(catalog());
	if (tag === undefined) return undefined;
	await loadDeclaredComponent(elements, catalog, tag, log);
	if (mount.presenterIn(host, slot) !== undefined) return undefined;
	return mount.mount(host, slot, tag, scope);
}
