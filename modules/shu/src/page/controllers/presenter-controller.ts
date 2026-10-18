/** The site's graph presenter, as a view that draws a graph of its own mounts it (`page/pipelines/graph-presenter.ts`). */
import { pageElements, pageLog, pagePresenterMount, pageRegistry } from "../root.js";
import { graphPresenterTag as presenterTagOf, mountGraphPresenter as mountIn } from "../pipelines/graph-presenter.js";
import { heldCatalog } from "../pipelines/held-catalog.js";
import type { TCatalog } from "../derivations/catalog.js";
import type { TGraphPresenter } from "../ports.js";

/** Returns the catalog of the page's registry, as the presenter reads it. */
const presenterCatalog = (): TCatalog => heldCatalog(pageRegistry(), "the graph presenter");

/** Returns the component the site declares as its graph presenter, or undefined where the deployment doesn't declare one. */
export const graphPresenterTag = (): string | undefined => presenterTagOf(presenterCatalog());

/** Returns the presenter `host` holds in `slot`, or undefined where it doesn't hold one. */
export const presenterIn = (host: HTMLElement, slot: string): TGraphPresenter | undefined => pagePresenterMount().presenterIn(host, slot);

/** Mounts the site's graph presenter in `host` at `slot`, with its settings under `scope`. */
export const mountGraphPresenter = (host: HTMLElement, slot: string, scope: string): Promise<TGraphPresenter | undefined> =>
	mountIn(pagePresenterMount(), pageElements(), presenterCatalog, host, slot, scope, pageLog);
