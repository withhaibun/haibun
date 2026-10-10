/** The site's graph presenter, as a view that draws a graph of its own mounts it (`page/pipelines/graph-presenter.ts`). */
import { pageElements, pagePresenterMount } from "../root.js";
import { mountGraphPresenter as mountIn } from "../pipelines/graph-presenter.js";
import type { TGraphPresenter } from "../ports.js";

export { graphPresenterTag } from "../pipelines/graph-presenter.js";

/** Returns the presenter `host` holds in `slot`, or undefined where it doesn't hold one. */
export const presenterIn = (host: HTMLElement, slot: string): TGraphPresenter | undefined => pagePresenterMount().presenterIn(host, slot);

/** Mounts the site's graph presenter in `host` at `slot`, with its settings under `scope`. */
export const mountGraphPresenter = (host: HTMLElement, slot: string, scope: string): Promise<TGraphPresenter | undefined> => mountIn(pagePresenterMount(), pageElements(), host, slot, scope);
